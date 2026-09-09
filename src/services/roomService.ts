import {
  ref,
  set,
  get,
  update,
  onValue,
  onChildAdded,
  remove,
  onDisconnect,
  serverTimestamp,
} from 'firebase/database';
import { db, isFirebaseConfigured } from './firebase';

export interface PredictionResult {
  className: string;
  probability: number;
}

export interface Player {
  name: string;
  current_drawing: string;
}

export type GamePhase = 'ADMIN_LOBBY' | 'GAME_ROUND' | 'ROUND_REVEAL' | 'FINAL_RESULTS';

export interface GameUpdate {
  phase: GamePhase;
  round: number;
  word: string;
  winnerName?: string;
  winnerScore?: number;
  winnerImage?: string;
  predictions?: PredictionResult[];
  /** Per-player dataset resemblance, ranked best first. */
  results?: PlayerResult[];
  /** Real dataset example sketches for the round's category. */
  samples?: string[];
  leaderboard?: Array<{ name: string; score: number }>;
}

export interface PlayerResult {
  name: string;
  /** 0..1 resemblance to the closest real Quick, Draw! dataset drawing */
  match: number;
}

type SubmissionHandler = (
  playerName: string,
  predictions: PredictionResult[],
  image?: string
) => void;

interface AdminHandlers {
  onPlayers: (players: Player[]) => void;
  onSubmission: SubmissionHandler;
}

const CHANNEL_NAME = 'doodle-duel-game';

/**
 * Room realtime service with two transports:
 *
 * 1. Firebase Realtime Database — used when .env keys are present.
 *    Works across devices/networks (phones, laptops) and survives reloads.
 *    `onDisconnect` removes players automatically if a tab closes.
 *
 * 2. BroadcastChannel — automatic fallback when Firebase is not configured.
 *    Keeps same-browser multi-tab play working during local development.
 */
class BroadcastTransport {
  private channel: BroadcastChannel | null = null;
  private players = new Map<string, Player>();

  private ensureChannel() {
    if (!this.channel) {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
    }
    return this.channel;
  }

  async createRoom(code: string) {
    this.players.clear();
    // Mirror the room into localStorage so other tabs can validate the code
    localStorage.setItem(`doodle_room_${code}`, JSON.stringify({ createdAt: Date.now() }));
  }

  async roomExists(code: string) {
    return Promise.resolve(localStorage.getItem(`doodle_room_${code}`) !== null);
  }

  async joinRoom(code: string, player: Player) {
    // Remember the join so a refreshed admin tab can re-collect players
    sessionStorage.setItem('doodle_player_session', JSON.stringify({ roomCode: code, player }));
    this.ensureChannel().postMessage({ kind: 'join', roomCode: code, player });
  }

  async publishSubmission(
    code: string,
    playerName: string,
    predictions: PredictionResult[],
    image?: string
  ) {
    this.ensureChannel().postMessage({
      kind: 'submission',
      roomCode: code,
      playerName,
      predictions,
      image,
    });
  }

  async publishGame(code: string, gameUpdate: GameUpdate) {
    this.ensureChannel().postMessage({ kind: 'game', roomCode: code, update: gameUpdate });
  }

  subscribeAdmin(code: string, handlers: AdminHandlers) {
    const channel = this.ensureChannel();
    const postPlayers = () => handlers.onPlayers(Array.from(this.players.values()));

    // addEventListener (not onmessage) so multiple subscriptions can coexist
    // and hot-reload doesn't orphan the only handler.
    const listener = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.roomCode !== code) return;

      if (msg.kind === 'join') {
        this.players.set(msg.player.name, msg.player);
        postPlayers();
      } else if (msg.kind === 'submission') {
        handlers.onSubmission(msg.playerName, msg.predictions, msg.image);
      }
    };

    channel.addEventListener('message', listener);
    postPlayers();
    // Ask player tabs to re-announce themselves (covers admin tab refresh)
    channel.postMessage({ kind: 'admin_ping', roomCode: code });

    return () => {
      channel.removeEventListener('message', listener);
    };
  }

  subscribePlayer(code: string, onGame: (update: GameUpdate) => void) {
    const channel = this.ensureChannel();
    const listener = (event: MessageEvent) => {
      const msg = event.data;
      // A (possibly refreshed) admin tab asked us to re-announce our join
      if (msg?.kind === 'admin_ping' && msg.roomCode === code) {
        const raw = sessionStorage.getItem('doodle_player_session');
        if (raw) {
          try {
            const session = JSON.parse(raw) as { roomCode: string; player: Player };
            if (session.roomCode === code) {
              channel.postMessage({ kind: 'join', roomCode: code, player: session.player });
            }
          } catch {
            /* ignore malformed session */
          }
        }
      }
      if (msg?.kind === 'game' && msg.roomCode === code) {
        onGame(msg.update);
      }
    };
    channel.addEventListener('message', listener);
    return () => channel.removeEventListener('message', listener);
  }
}

class FirebaseTransport {
  private roomRef(code: string) {
    return ref(db!, `rooms/${code}`);
  }

  async createRoom(code: string) {
    // If the room already exists (admin refreshed the tab), keep players intact
    const snap = await get(this.roomRef(code));
    if (snap.exists()) return;
    await set(this.roomRef(code), {
      createdAt: serverTimestamp(),
      game: { phase: 'ADMIN_LOBBY', round: 0, word: '' },
    });
  }

  async roomExists(code: string) {
    const snap = await get(this.roomRef(code));
    return snap.exists();
  }

  async joinRoom(code: string, player: Player) {
    const playerRef = ref(db!, `rooms/${code}/players/${player.name}`);
    await set(playerRef, player);
    // Auto-remove the player when the tab closes / connection drops
    await onDisconnect(playerRef).remove();
  }

  async publishSubmission(
    code: string,
    playerName: string,
    predictions: PredictionResult[],
    image?: string
  ) {
    // Drawing data URLs live in a dedicated node so they can be large.
    const payload: Record<string, unknown> = {
      [`submissions/${playerName}`]: predictions,
      [`players/${playerName}/current_drawing`]: 'submitted',
    };
    if (image) {
      payload[`drawings/${playerName}`] = image;
    }
    await update(this.roomRef(code), payload);
  }

  async publishGame(code: string, gameUpdate: GameUpdate) {
    await update(this.roomRef(code), { game: gameUpdate });
    // Reveal has been shown — clear submissions for the next round
    if (gameUpdate.phase === 'ROUND_REVEAL') {
      await remove(ref(db!, `rooms/${code}/submissions`));
      await remove(ref(db!, `rooms/${code}/drawings`));
    }
  }

  subscribeAdmin(code: string, handlers: AdminHandlers) {
    const playersUnsub = onValue(ref(db!, `rooms/${code}/players`), snap => {
      const players: Player[] = [];
      snap.forEach(child => {
        const val = child.val();
        players.push({ name: child.key ?? '', current_drawing: val?.current_drawing ?? '' });
      });
      handlers.onPlayers(players);
    });

    const submissionsUnsub = onChildAdded(
      ref(db!, `rooms/${code}/submissions`),
      async childSnap => {
        let image: string | undefined;
        try {
          const imgSnap = await get(ref(db!, `rooms/${code}/drawings/${childSnap.key ?? ''}`));
          if (imgSnap.exists()) image = imgSnap.val() as string;
        } catch {
          /* drawing image is optional */
        }
        handlers.onSubmission(childSnap.key ?? '', childSnap.val() as PredictionResult[], image);
      }
    );

    return () => {
      playersUnsub();
      submissionsUnsub();
    };
  }

  subscribePlayer(code: string, onGame: (update: GameUpdate) => void) {
    const unsub = onValue(ref(db!, `rooms/${code}/game`), snap => {
      const val = snap.val() as GameUpdate | null;
      if (val?.phase) onGame(val);
    });
    return unsub;
  }
}

const broadcastTransport = new BroadcastTransport();
const firebaseTransport = new FirebaseTransport();

interface RoomTransport {
  createRoom(code: string): Promise<void>;
  roomExists(code: string): Promise<boolean>;
  joinRoom(code: string, player: Player): Promise<void>;
  publishSubmission(
    code: string,
    playerName: string,
    predictions: PredictionResult[],
    image?: string
  ): Promise<void>;
  publishGame(code: string, update: GameUpdate): Promise<void>;
  subscribeAdmin(code: string, handlers: AdminHandlers): () => void;
  subscribePlayer(code: string, onGame: (update: GameUpdate) => void): () => void;
}

const transport: RoomTransport = isFirebaseConfigured ? firebaseTransport : broadcastTransport;

export const roomService = {
  createRoom: (code: string) => transport.createRoom(code),
  roomExists: (code: string) => transport.roomExists(code),
  joinRoom: (code: string, player: Player) => transport.joinRoom(code, player),
  publishSubmission: (code: string, player: string, preds: PredictionResult[], image?: string) =>
    transport.publishSubmission(code, player, preds, image),
  publishGame: (code: string, update: GameUpdate) => transport.publishGame(code, update),
  subscribeAdmin: (code: string, handlers: AdminHandlers) => transport.subscribeAdmin(code, handlers),
  subscribePlayer: (code: string, onGame: (update: GameUpdate) => void) =>
    transport.subscribePlayer(code, onGame),
};