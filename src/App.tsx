import React from 'react';

// Types
interface Player {
  name: string;
  current_drawing: string;
}

interface PlayerResult {
  name: string;
  match: number;
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
  samples?: string[];
  leaderboard?: Array<{ name: string; score: number }>;
}

interface AppProps {
  view: 'ENTRY' | 'ADMIN_LOBBY' | 'PLAYER_LOBBY' | 'GAME_ROUND' | 'ROUND_REVEAL' | 'FINAL_RESULTS';
  roomCode: string;
  players: Player[];
  username: string;
  roomState: RoomState;
  role: 'ADMIN' | 'PLAYER';
  hasSubmitted: boolean;
  localTimer: number;
  QUESTION_PROMPTS: string[];
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  setUsername: (username: string) => void;
  _initializeAdminRoom: () => void;
  _registerPlayerProfile: () => void;
  roomCodeInput?: string;
  setRoomCodeInput?: (code: string) => void;
  startDrawing: (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => void;
  drawVector: (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => void;
  stopDrawing: () => void;
  _autoSubmitCanvasDrawing: () => void;
  _advanceToNextGameRound: () => void;
}

export default function App({
  view,
  roomCode,
  players,
  username,
  roomState,
  role,
  hasSubmitted,
  localTimer,
  canvasRef,
  setUsername,
  _initializeAdminRoom,
  _registerPlayerProfile,
  roomCodeInput = '',
  setRoomCodeInput = () => {},
  startDrawing,
  drawVector,
  stopDrawing,
  _autoSubmitCanvasDrawing,
  _advanceToNextGameRound,
}: AppProps) {

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans flex flex-col justify-between p-6">
      
      {/* 🏷️ GLOBAL GAME HEADER BAR */}
      <header className="flex justify-between items-center border-b-2 border-yellow-400/30 pb-6">
        <div className="flex items-center gap-3">
          <span className="text-5xl animate-bounce">✏️</span>
          <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-yellow-500 to-orange-500 bg-clip-text text-transparent" style={{ fontFamily: "'Indie Flower', cursive" }}>
            DoodleDuel AI
          </h1>
        </div>
        {view !== 'ENTRY' && roomCode && (
          <div className="flex items-center gap-3">
            {role === 'PLAYER' && <span className="text-sm font-black text-slate-700">🎨 {username}</span>}
            <div className="px-4 py-2 bg-yellow-400/20 border-2 border-yellow-500 rounded-full text-xs font-bold text-yellow-700 tracking-widest">
              🔗 ROOM: <span className="text-yellow-600 font-mono ml-2">{roomCode}</span>
            </div>
          </div>
        )}
      </header>

      {/* 🚪 PHASE 1: SPLIT SCREEN ROUTING ENTRY PANEL */}
      {view === 'ENTRY' && (
        <main className="max-w-2xl mx-auto w-full my-auto flex flex-col gap-8 px-4">
          <div className="text-center space-y-4">
            <div className="text-7xl animate-bounce mb-4">✏️</div>
            <h2 className="text-5xl font-black mb-2" style={{ color: '#f7b801', fontFamily: "'Indie Flower', cursive" }}>
              DoodleDuel AI
            </h2>
            <p className="text-gray-600 text-lg font-semibold">Let AI guess what you draw! 🤖</p>
            <p className="text-gray-500 text-sm">Multiplayer drawing challenge</p>
          </div>

          <div className="flex flex-col gap-4">
            {/* Admin Host Route */}
            <button 
              onClick={_initializeAdminRoom}
              className="group w-full bg-gradient-to-br from-yellow-400 to-orange-400 hover:shadow-lg hover:shadow-yellow-400/50 p-6 rounded-3xl transition-all border-2 border-yellow-500/50 hover:border-yellow-600"
            >
              <div className="flex justify-between items-center">
                <div className="text-left">
                  <div className="text-lg text-white font-bold tracking-wide">📺 Host Game (Admin)</div>
                  <div className="text-xs text-yellow-800 font-semibold mt-1">Generate Room Code & manage players</div>
                </div>
                <span className="text-4xl group-hover:scale-110 transition">🎬</span>
              </div>
            </button>

            <div className="relative flex py-6 items-center">
              <div className="flex-grow border-t-2 border-yellow-400/30"></div>
              <span className="flex-shrink mx-4 uppercase tracking-widest text-gray-600 text-xs font-bold">or Join as Player</span>
              <div className="flex-grow border-t-2 border-yellow-400/30"></div>
            </div>

            {/* Player Intake Fields Container */}
            <div className="bg-gradient-to-br from-yellow-50 to-orange-50 p-6 rounded-3xl border-2 border-yellow-300/50 flex flex-col gap-4 shadow-sm">
              <input 
                type="text" 
                placeholder="Your unique username (max 20 chars)" 
                value={username}
                onChange={e => setUsername(e.target.value)}
                maxLength={20}
                className="w-full bg-white border-2 border-yellow-400 px-4 py-3 rounded-xl text-slate-800 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-300/50 transition-all font-semibold"
              />

              <input 
                type="text" 
                placeholder="Enter 6-character Room Code (ask host)" 
                value={roomCodeInput}
                onChange={e => setRoomCodeInput(e.target.value.toUpperCase())}
                maxLength={6}
                className="w-full bg-white border-2 border-yellow-400 px-4 py-3 rounded-xl text-slate-800 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-300/50 transition-all font-semibold uppercase tracking-widest"
              />

              <button 
                onClick={_registerPlayerProfile}
                disabled={!username.trim() || !roomCodeInput.trim()}
                className="w-full bg-gradient-to-br from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-xl transition-all hover:shadow-lg hover:shadow-green-400/50 active:scale-95 text-lg"
              >
                🚀 Enter Battle Room
              </button>
            </div>
          </div>
        </main>
      )}

      {/* 📺 PHASE 2A: ADMIN HOUSING REAL-TIME ROOM LOBBY */}
      {view === 'ADMIN_LOBBY' && (
        <main className="max-w-2xl mx-auto w-full my-auto flex flex-col gap-8 text-center px-4">
          <div className="space-y-3">
            <div className="inline-block bg-gradient-to-r from-yellow-400 to-orange-400 text-white px-4 py-2 rounded-full text-xs font-black tracking-wider">
              ADMIN MODE
            </div>
            <h2 className="text-4xl font-black" style={{ color: '#f7b801', fontFamily: "'Indie Flower', cursive" }}>
              {roomCode}
            </h2>
            <p className="text-gray-600 font-semibold">Share this code with players to join the duel!</p>
          </div>

          <div className="bg-gradient-to-br from-yellow-50 to-orange-50 p-8 rounded-3xl border-2 border-yellow-300/50 space-y-4">
            <h3 className="text-left text-xs font-black text-yellow-700 tracking-wider uppercase mb-4">
              🎭 Connected Challengers ({players.length})
            </h3>
            {players.length === 0 ? (
              <div className="text-gray-500 text-sm py-8 animate-pulse font-semibold">
                ⏳ Waiting for artists to join...
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {players.map((p, idx) => (
                  <div key={idx} className="bg-white border-2 border-yellow-400 px-4 py-3 rounded-xl hover:border-orange-500 transition">
                    <div className="text-2xl">🎨</div>
                    <div className="text-sm font-bold text-slate-700 mt-1 truncate">{p.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button 
            onClick={_advanceToNextGameRound}
            disabled={players.length === 0}
            className="bg-gradient-to-br from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-3 px-8 rounded-xl transition-all hover:shadow-lg hover:shadow-green-400/50 active:scale-95 text-lg mx-auto"
          >
            🎬 Start DoodleDuel Match!
          </button>
        </main>
      )}

      {/* 📱 PHASE 2B: PLAYER WAITING HUD LOBBY ROOM CONTAINER */}
      {view === 'PLAYER_LOBBY' && (
        <main className="max-w-sm mx-auto w-full my-auto text-center flex flex-col gap-6 px-4">
          <div className="text-7xl animate-float">✏️</div>
          <h2 className="text-3xl font-black" style={{ color: '#f7b801', fontFamily: "'Indie Flower', cursive" }}>Welcome, {username}! 👋</h2>
          <p className="text-gray-600 text-sm leading-relaxed font-semibold">
            Look up at the main projector screen. The battle match will start the moment the host launches it!
          </p>
          <div className="bg-gradient-to-br from-yellow-100 to-orange-100 px-6 py-4 rounded-2xl border-2 border-yellow-400 space-y-2 animate-pulse-glow shadow-md">
            <div className="text-xs font-black text-yellow-700 tracking-wide">● WAITING FOR HOST</div>
            <div className="text-xs text-yellow-600 font-semibold">Match starting soon...</div>
          </div>
        </main>
      )}

      {/* 🐈 PHASE 3: LIVE ACTIVE 20S DRAWING ROUND */}
      {view === 'GAME_ROUND' && (
        <main className="max-w-lg mx-auto w-full my-auto flex flex-col gap-6 px-4">
          <div className="text-center space-y-2">
            <div className="inline-block bg-gradient-to-r from-yellow-400 to-orange-400 text-white px-4 py-2 rounded-full text-xs font-black tracking-wider">
              ROUND {Number(roomState?.current_round ?? 0) + 1}
            </div>
            <h2 className="text-3xl font-black" style={{ color: '#f7b801', fontFamily: "'Indie Flower', cursive" }}>
              Draw: <span className="underline decoration-yellow-500">{roomState?.current_word}</span>
            </h2>
            {role === 'ADMIN' && (
              <p className="text-gray-600 text-sm font-semibold">Watch your artists create 👀</p>
            )}
          </div>

          {role === 'PLAYER' ? (
            <div className="flex flex-col gap-4">
              <div className="relative group">
                <canvas 
                  ref={canvasRef}
                  width={340}
                  height={340}
                  onMouseDown={startDrawing}
                  onMouseMove={drawVector}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={drawVector}
                  onTouchEnd={stopDrawing}
                  className="w-full aspect-square bg-white rounded-2xl border-2 border-yellow-400 shadow-lg touch-none cursor-crosshair hover:border-orange-500 transition-all"
                />
                {hasSubmitted && (
                  <div className="absolute inset-0 bg-white/95 rounded-2xl flex flex-col justify-center items-center font-bold text-sm text-green-600 backdrop-blur-sm border-2 border-green-400">
                    <span className="text-3xl">✔</span>
                    <span className="mt-2">SKETCH SUBMITTED</span>
                    <span className="text-xs text-gray-500 font-normal mt-2">Awaiting other artists...</span>
                  </div>
                )}
              </div>

              <button
                onClick={_autoSubmitCanvasDrawing}
                disabled={hasSubmitted}
                className="bg-gradient-to-br from-green-400 to-emerald-500 hover:from-green-500 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-xl transition-all hover:shadow-lg hover:shadow-green-400/50 active:scale-95 w-full"
              >
                🔒 Lock In Drawing
              </button>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-yellow-50 to-orange-50 p-8 rounded-3xl border-2 border-yellow-300/50 text-center flex flex-col gap-4">
              <div className="text-6xl font-black" style={{ color: '#f7b801' }}>{localTimer}s</div>
              <div className="text-sm font-bold text-gray-700">
                🎯 Submissions: <span className="text-yellow-600">{players.filter(p => p.current_drawing !== "").length} / {players.length}</span> Artists Locked In
              </div>
              <div className="w-full bg-gray-200 h-3 rounded-full overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-yellow-400 to-orange-400 h-full transition-all duration-300"
                  style={{ width: `${(players.filter(p => p.current_drawing !== "").length / players.length) * 100}%` }}
                />
              </div>
            </div>
          )}
        </main>
      )}

      {/* 🧑‍🎨 PHASE 4: THE SHOWCASE - WINNER VS AI PREDICTIONS */}
      {view === 'ROUND_REVEAL' && (
        <main className="max-w-4xl mx-auto w-full my-auto flex flex-col gap-6 px-4">
          <div className="text-center space-y-3">
            <div className="inline-block bg-gradient-to-r from-yellow-400 to-orange-400 text-white px-4 py-2 rounded-full text-xs font-black tracking-wider">
              ROUND {Number(roomState?.current_round ?? 0) + 1} COMPLETE
            </div>
            <h2 className="text-3xl font-black" style={{ color: '#f7b801', fontFamily: "'Indie Flower', cursive" }}>AI Recognition Results 🤖</h2>
            <div className="text-xl font-black text-slate-800">Prompt: {roomState?.current_word}</div>
            <p className="text-gray-600 font-semibold">What did the neural network predict?</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Winner Card — shows the artist's actual sketch, like Quick, Draw! */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-400 p-6 rounded-3xl hover:border-green-600 hover:shadow-lg hover:shadow-green-400/50 transition">
              <div className="inline-block bg-gradient-to-r from-green-400 to-emerald-500 text-white px-3 py-1 rounded-full text-xs font-black mb-4">
                👑 TOP PREDICTION
              </div>
              {roomState?.winner_img ? (
                <img
                  src={roomState.winner_img}
                  alt={`${roomState?.winner_name}'s drawing`}
                  className="w-full max-w-xs mx-auto rounded-2xl border-2 border-green-300 bg-white mb-4"
                />
              ) : (
                <div className="w-full max-w-xs mx-auto h-40 rounded-2xl border-2 border-dashed border-green-300 bg-white mb-4 flex items-center justify-center text-gray-400 text-sm">
                  Sketch not available
                </div>
              )}
              <div className="text-3xl font-black text-gray-800 text-center">
                🏆 {roomState?.winner_name}
              </div>
            </div>

            {/* Player scores, DoodleNet labels, and real Quick Draw references */}
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border-2 border-purple-400 p-6 rounded-3xl hover:border-purple-600 hover:shadow-lg hover:shadow-purple-400/50 transition">
              <div className="inline-block bg-gradient-to-r from-purple-400 to-indigo-500 text-white px-3 py-1 rounded-full text-xs font-black mb-4">
                📊 PLAYER SCORES
              </div>
              <div className="space-y-3">
                {roomState?.results && roomState.results.length > 0 ? (
                  roomState.results.map((res, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-white border border-purple-200 p-3 rounded-lg">
                      <span className="text-sm font-bold text-gray-700 truncate">
                        {idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : idx === 2 ? '🥉 ' : ''}
                        {res.name}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="bg-gradient-to-r from-purple-400 to-indigo-500 h-full"
                            style={{ width: `${res.match * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold text-purple-600 w-12 text-right">
                          {(res.match * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-gray-600 text-sm text-center py-4 font-semibold">
                    No drawings to compare this round
                  </div>
                )}
              </div>

              {roomState?.top_predictions && roomState.top_predictions.length > 0 && (
                <div className="mt-5 pt-4 border-t border-purple-200">
                    <div className="text-[10px] font-black text-purple-500 tracking-wider uppercase mb-2">
                      DoodleNet guesses for the winning drawing
                  </div>
                  <div className="space-y-2">
                    {roomState.top_predictions.map((prediction, idx) => (
                      <div key={`${prediction.className}-${idx}`} className="flex items-center gap-3 text-sm">
                        <span className="w-5 text-xs font-black text-purple-500">{idx + 1}.</span>
                        <span className="flex-1 font-bold text-gray-700 capitalize">{prediction.className}</span>
                        <span className="text-xs font-bold text-purple-600">
                          {(prediction.probability * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Real dataset examples for this round's category */}
              {roomState?.samples && roomState.samples.length > 0 && (
                <div className="mt-5 pt-4 border-t border-purple-200">
                  <div className="text-[10px] font-black text-purple-500 tracking-wider uppercase mb-2">
                    Quick, Draw! reference drawings for "{roomState?.current_word}"
                  </div>
                  <div className="flex gap-3 justify-center">
                    {roomState.samples.map((src, idx) => (
                      <img
                        key={idx}
                        src={src}
                        alt={`Dataset example ${idx + 1}`}
                        className="w-24 h-24 rounded-xl border-2 border-purple-200 bg-white object-contain"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Navigation */}
          <div className="flex flex-col gap-4 pt-6 border-t-2 border-yellow-400/30">
            <div className="text-xs font-bold text-gray-600 tracking-wider text-center">
              🚀 POWERED BY GOOGLE'S QUICK DRAW NEURAL NETWORKS
            </div>
            {role === 'ADMIN' && (
              <button 
                onClick={_advanceToNextGameRound}
                className="bg-gradient-to-br from-yellow-400 to-orange-400 hover:from-yellow-500 hover:to-orange-500 text-white font-black py-3 px-6 rounded-xl transition-all hover:shadow-lg hover:shadow-yellow-400/50 active:scale-95 w-full text-lg"
              >
                {roomState?.current_round + 1 >= 5 ? "🏆 See Final Winners" : "Next Round ➡️"}
              </button>
            )}
          </div>
        </main>
      )}

      {view === 'FINAL_RESULTS' && (
        <main className="max-w-2xl mx-auto w-full my-auto flex flex-col gap-6 px-4 text-center">
          <div>
            <div className="text-7xl mb-3">🏆</div>
            <h2 className="text-4xl font-black text-orange-500" style={{ fontFamily: "'Indie Flower', cursive" }}>
              DoodleDuel Champions!
            </h2>
            <p className="text-gray-600 font-semibold mt-2">Five rounds complete. What a finish!</p>
          </div>
          <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-3xl p-6 space-y-3">
            {roomState?.leaderboard?.map((player, index) => (
              <div key={player.name} className="flex items-center justify-between bg-white border-2 border-yellow-200 rounded-xl px-4 py-3">
                <span className="font-black text-slate-700">{index + 1}. {index === 0 ? '👑 ' : ''}{player.name}</span>
                <span className="font-black text-orange-500">{(player.score * 100).toFixed(0)} pts</span>
              </div>
            ))}
          </div>
          <div className="text-lg font-black text-green-600">🎉 Congratulations to every artist! 🎉</div>
        </main>
      )}
    </div>
  );
}
