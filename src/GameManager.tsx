import { useRef, useState, useEffect } from 'react';
import App from './App';
import { QuickDrawAPI } from './services/quickDrawAPI';
import {
  roomService,
  type GameUpdate,
  type PlayerResult,
  type PredictionResult,
} from './services/roomService';

type ViewType =
  | 'ENTRY'
  | 'ADMIN_LOBBY'
  | 'PLAYER_LOBBY'
  | 'GAME_ROUND'
  | 'ROUND_REVEAL'
  | 'FINAL_RESULTS';

interface Player {
  name: string;
  current_drawing: string;
}

interface RoomState {
  current_round: number;
  current_word: string;
  winner_name: string;
  winner_img?: string;
  artist_img?: string;
  winner_score: number;
  top_predictions?: Array<{ className: string; probability: number }>;
  results?: PlayerResult[];
  leaderboard?: Array<{ name: string; score: number }>;
}

const QUESTION_PROMPTS = [
  'Snowman',
  'Rabbit',
  'Cell phone',
  'Fan',
  'Tree',
];

const shufflePrompts = () => [...QUESTION_PROMPTS].sort(() => Math.random() - 0.5).slice(0, 5);

const ROUND_SECONDS = 20;

/** Shared sketch cache — lets any tab on this origin recover sketches even
 * if the realtime payload drops the image data. */
const sketchKey = (roomCode: string, playerName: string) =>
  `doodle_sketch_${roomCode}_${playerName}`;

export function GameManager() {
  // Game State
  const [view, setView] = useState<ViewType>('ENTRY');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [username, setUsername] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roundPrompts, setRoundPrompts] = useState(() => shufflePrompts());
  const [role, setRole] = useState<'ADMIN' | 'PLAYER'>('PLAYER');
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [localTimer, setLocalTimer] = useState(ROUND_SECONDS);
  const [isDrawing, setIsDrawing] = useState(false);

  // Canvas Ref
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Room State
  const [roomState, setRoomState] = useState<RoomState>({
    current_round: 0,
    current_word: QUESTION_PROMPTS[0],
    winner_name: '',
    winner_score: 0,
  });

  // Realtime sync refs
  const submissionsRef = useRef(new Map<string, PredictionResult[]>());
  const drawingsRef = useRef(new Map<string, string>());
  const adminUnsubRef = useRef<(() => void) | null>(null);
  const playerUnsubRef = useRef<(() => void) | null>(null);
  const roomCodeRef = useRef(roomCode);
  const roleRef = useRef(role);
  const leaderboardRef = useRef(new Map<string, number>());

  useEffect(() => {
    roomCodeRef.current = roomCode;
    roleRef.current = role;
  }, [roomCode, role]);

  // Cleanup subscriptions on unmount
  useEffect(
    () => () => {
      adminUnsubRef.current?.();
      playerUnsubRef.current?.();
    },
    []
  );

  // Warm up the DoodleNet model in the background so the first
  // submission doesn't wait on the ~5MB download.
  useEffect(() => {
    QuickDrawAPI.preload();
  }, []);

  // Paint a white background whenever a new round starts (or the canvas first
  // mounts). Keyed on the round number — the view stays GAME_ROUND between
  // rounds, so view alone wouldn't clear the previous sketch.
  useEffect(() => {
    if (view !== 'GAME_ROUND') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [view, roomState.current_round]);

  // Generate random room code
  const generateRoomCode = () => {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  };

  // Apply a game-state update coming from the admin tab/device
  const applyGameUpdate = (update: GameUpdate) => {
    if (update.phase === 'GAME_ROUND') {
      setRoomState(prev => ({ ...prev, current_round: update.round, current_word: update.word }));
      setLocalTimer(ROUND_SECONDS);
      setHasSubmitted(false);
      clearCanvas();
      setView('GAME_ROUND');
    } else if (update.phase === 'ROUND_REVEAL') {
      // Recover the sketch from the shared cache if it was dropped in transit
      let winnerImg = update.winnerImage;
      if (!winnerImg && update.winnerName) {
        try {
          winnerImg =
            localStorage.getItem(sketchKey(roomCodeRef.current, update.winnerName)) ?? undefined;
        } catch {
          /* ignore */
        }
      }
      setRoomState(prev => ({
        ...prev,
        winner_name: update.winnerName ?? '',
        winner_score: update.winnerScore ?? 0,
        winner_img: winnerImg,
        top_predictions: update.predictions ?? [],
        results: update.results ?? [],
        samples: update.samples ?? [],
      }));
      setView('ROUND_REVEAL');
    } else if (update.phase === 'FINAL_RESULTS') {
      setRoomState(prev => ({ ...prev, leaderboard: update.leaderboard ?? [] }));
      setView('FINAL_RESULTS');
    } else {
      // ADMIN_LOBBY — tournament finished / reset
      setHasSubmitted(false);
      setView('PLAYER_LOBBY');
    }
  };

  // Initialize Admin Room
  const _initializeAdminRoom = async () => {
    const code = generateRoomCode();
    const prompts = shufflePrompts();
    adminUnsubRef.current?.();
    submissionsRef.current.clear();
    leaderboardRef.current.clear();
    setRoundPrompts(prompts);

    setRoomCode(code);
    setRole('ADMIN');
    setView('ADMIN_LOBBY');
    setPlayers([]);

    await roomService.createRoom(code);
    adminUnsubRef.current = roomService.subscribeAdmin(code, {
      onPlayers: list => setPlayers(list),
      onSubmission: (playerName, predictions, image) => {
        submissionsRef.current.set(playerName, predictions);
        if (image) {
          drawingsRef.current.set(playerName, image);
        } else {
          // Recover the sketch from the shared localStorage cache
          const cached = localStorage.getItem(sketchKey(code, playerName));
          if (cached) drawingsRef.current.set(playerName, cached);
        }
        setPlayers(prev =>
          prev.map(p => (p.name === playerName ? { ...p, current_drawing: 'submitted' } : p))
        );
      },
    });
  };

  // Register Player Profile
  const _registerPlayerProfile = async () => {
    if (!username.trim() || !roomCodeInput.trim()) return;

    // Validate room code format (6 characters)
    if (roomCodeInput.length !== 6) {
      alert('❌ Room code must be 6 characters long!');
      return;
    }

    // Validate the code against rooms published by the admin
    const exists = await roomService.roomExists(roomCodeInput);
    if (!exists) {
      alert('❌ Room not found! Double-check the code shown on the host screen.');
      return;
    }

    const name = username.trim();
    setRole('PLAYER');
    setRoomCode(roomCodeInput);
    setView('PLAYER_LOBBY');

    // Listen for game-phase updates from the admin tab/device
    playerUnsubRef.current?.();
    playerUnsubRef.current = roomService.subscribePlayer(roomCodeInput, applyGameUpdate);

    // Announce the join (admin lobby updates live, with onDisconnect cleanup)
    await roomService.joinRoom(roomCodeInput, { name, current_drawing: '' });

    setRoomCodeInput(''); // Clear after joining
  };

  // Drawing functions
  const getCanvasContext = () => {
    return canvasRef.current?.getContext('2d');
  };

  /**
   * Map a pointer/touch event to canvas pixel coordinates.
   * The canvas is rendered at CSS size (w-full) but has a fixed internal
   * resolution, so raw clientX/clientY must be scaled — otherwise strokes
   * land outside the canvas and nothing appears.
   */
  const getCanvasPoint = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const source = 'touches' in e ? e.touches[0] : e;
    if (!source) return null;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (canvas && ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (hasSubmitted) return;

    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    const point = getCanvasPoint(e);
    if (!canvas || !ctx || !point) return;

    setIsDrawing(true);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  };

  const drawVector = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing || hasSubmitted) return;

    const ctx = getCanvasContext();
    const point = getCanvasPoint(e);
    if (!ctx || !point) return;

    // Strokes need enough weight to survive DoodleNet's 28x28 downscaling,
    // without feeling bulky to draw with (~2.5% of canvas width).
    ctx.strokeStyle = '#111827'; // near-black — ideal for DoodleNet recognition
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;

    const ctx = getCanvasContext();
    if (ctx) {
      ctx.closePath();
    }
    setIsDrawing(false);
  };

  // Auto submit canvas drawing
  const _autoSubmitCanvasDrawing = async () => {
    if (!canvasRef.current || hasSubmitted) return;

    setHasSubmitted(true);

    // Capture the sketch so the reveal can show what the artist drew.
    // Cached under room+player key so the admin tab can recover it even if
    // the realtime payload drops the image (fixes "Sketch not available").
    let imageDataUrl: string | undefined;
    try {
      imageDataUrl = QuickDrawAPI.exportDrawing(canvasRef.current);
      localStorage.setItem(sketchKey(roomCodeRef.current, username.trim()), imageDataUrl);
    } catch {
      /* image capture is best-effort */
    }

    // Get DoodleNet predictions for the drawing
    try {
      const predictions = await QuickDrawAPI.predictDrawing(canvasRef.current);
      console.log('Drawing submitted with predictions:', predictions);

      // Send predictions + sketch to the admin (Firebase RTDB or cross-tab fallback)
      await roomService.publishSubmission(
        roomCodeRef.current,
        username.trim(),
        predictions,
        imageDataUrl
      );
    } catch (error) {
      console.error('Error processing drawing:', error);
    }
  };

  // Advance to next game round (admin only)
  const _advanceToNextGameRound = () => {
    if (role !== 'ADMIN') return;

    if (view === 'ADMIN_LOBBY') {
      // Start the match — transition everyone to GAME_ROUND
      const round = 0;
      const word = roundPrompts[round];
      submissionsRef.current.clear();
      drawingsRef.current.clear();
      // Warm the Quick, Draw! dataset sample for this category in advance
      QuickDrawAPI.preloadDataset(word);
      setRoomState(prev => ({ ...prev, current_round: round, current_word: word }));
      setLocalTimer(ROUND_SECONDS);
      setHasSubmitted(false);
      setPlayers(prev => prev.map(p => ({ ...p, current_drawing: '' })));
      setView('GAME_ROUND');
      void roomService.publishGame(roomCode, { phase: 'GAME_ROUND', round, word });
    } else if (view === 'ROUND_REVEAL') {
      if (roomState.current_round + 1 >= roundPrompts.length) {
        const leaderboard = Array.from(leaderboardRef.current.entries())
          .map(([name, score]) => ({ name, score }))
          .sort((a, b) => b.score - a.score);
        setRoomState(prev => ({ ...prev, leaderboard }));
        setView('FINAL_RESULTS');
        void roomService.publishGame(roomCode, {
          phase: 'FINAL_RESULTS',
          round: roomState.current_round,
          word: roomState.current_word,
          leaderboard,
        });
      } else {
        // Next round
        const nextRound = roomState.current_round + 1;
        const word = roundPrompts[nextRound];
        submissionsRef.current.clear();
        drawingsRef.current.clear();
        // Warm the dataset sample for the upcoming category
        QuickDrawAPI.preloadDataset(word);
        setRoomState(prev => ({ ...prev, current_round: nextRound, current_word: word }));
        setLocalTimer(ROUND_SECONDS);
        setHasSubmitted(false);
        setPlayers(prev => prev.map(p => ({ ...p, current_drawing: '' })));
        setView('GAME_ROUND');
        clearCanvas();
        void roomService.publishGame(roomCode, { phase: 'GAME_ROUND', round: nextRound, word });
      }
    }
  };

  // Countdown tick while a round is live
  useEffect(() => {
    if (view !== 'GAME_ROUND' || localTimer <= 0) return;

    const timer = setInterval(() => {
      setLocalTimer(prev => Math.max(prev - 1, 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [view, localTimer]);

  // When time is up, the admin scores every submission against the prompt
  // (best matching DoodleNet class wins) and reveals results everywhere.
  useEffect(() => {
    if (view !== 'GAME_ROUND' || localTimer > 0 || role !== 'ADMIN') return;

    let cancelled = false;
    const word = roomState.current_word;
    const submissions = Array.from(submissionsRef.current.entries());

    // Prefer the in-memory sketch; fall back to the shared localStorage cache
    const resolveImage = (name: string): string | undefined =>
      drawingsRef.current.get(name) ??
      (() => {
        try {
          return localStorage.getItem(sketchKey(roomCodeRef.current, name)) ?? undefined;
        } catch {
          return undefined;
        }
      })();

    // Rank every submission against real Quick Draw examples before selecting
    // the winner. This prevents an unrecognised but visually accurate sketch
    // from losing through a random zero-confidence tie.
    void (async () => {
      let results: PlayerResult[] = [];
      let samples: string[] = [];
      const promptScores = new Map<string, number>();
      const datasetScores = new Map<string, number>();
      try {
        const scored = await Promise.all(
          submissions.map(async ([name, predictions]) => {
            const img = resolveImage(name);
            promptScores.set(name, QuickDrawAPI.scoreAgainstPrompt(predictions, word));
            const match = img ? await QuickDrawAPI.scoreAgainstDataset(img, word) : null;
            if (match !== null) datasetScores.set(name, match);
            return { name, match } as PlayerResult;
          })
        );
        results = scored
          .filter(r => r.match >= 0)
          .sort((a, b) => b.match - a.match);

        samples = await QuickDrawAPI.getDatasetSamples(word);
      } catch (error) {
        console.error('Dataset ranking failed:', error);
      }

      const winnerName = submissions.length
        ? submissions
            .map(([name]) => name)
            .sort((a, b) => {
              const scoreA = datasetScores.get(a) ?? promptScores.get(a) ?? 0;
              const scoreB = datasetScores.get(b) ?? promptScores.get(b) ?? 0;
              return scoreB - scoreA || (Math.random() < 0.5 ? -1 : 1);
            })[0]
        : players[0]?.name ?? 'Unknown';
      const winnerScore = datasetScores.get(winnerName) ?? promptScores.get(winnerName) ?? 0;
      const topPredictions = submissionsRef.current.get(winnerName)?.slice(0, 3) ?? [];
      const winnerImage = resolveImage(winnerName);

      // Add this round's score to the tournament scoreboard.
      for (const player of players) {
        const score = datasetScores.get(player.name) ?? promptScores.get(player.name) ?? 0;
        leaderboardRef.current.set(
          player.name,
          (leaderboardRef.current.get(player.name) ?? 0) + score
        );
      }

      if (cancelled) return;

      const finalImage = resolveImage(winnerName);
      setRoomState(prev => ({
        ...prev,
        winner_name: winnerName,
        winner_score: winnerScore,
        winner_img: finalImage ?? winnerImage,
        results,
        samples,
      }));
      setView('ROUND_REVEAL');

      void roomService.publishGame(roomCodeRef.current, {
        phase: 'ROUND_REVEAL',
        round: roomState.current_round,
        word,
        winnerName,
        winnerScore,
        winnerImage: finalImage ?? winnerImage,
        predictions: topPredictions,
        results,
        samples,
      });
    })();
  }, [view, localTimer, role, players, roomState]);

  return (
    <App
      view={view}
      roomCode={roomCode}
      players={players}
      username={username}
      roomState={roomState}
      role={role}
      hasSubmitted={hasSubmitted}
      localTimer={localTimer}
      QUESTION_PROMPTS={QUESTION_PROMPTS}
      canvasRef={canvasRef}
      setUsername={setUsername}
      _initializeAdminRoom={_initializeAdminRoom}
      _registerPlayerProfile={_registerPlayerProfile}
      roomCodeInput={roomCodeInput}
      setRoomCodeInput={setRoomCodeInput}
      startDrawing={startDrawing}
      drawVector={drawVector}
      stopDrawing={stopDrawing}
      _autoSubmitCanvasDrawing={_autoSubmitCanvasDrawing}
      _advanceToNextGameRound={_advanceToNextGameRound}
    />
  );
}