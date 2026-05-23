"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import GameBoard from "./components/GameBoard";
import PlayerInput from "./components/PlayerInput";
import type { GameState, Player } from "@/lib/gameTypes";
import { INITIAL_STATE, LEVEL_NAMES } from "@/lib/gameTypes";
import { COUNTRIES } from "@/lib/countries";
import { SOUNDS, playSound, preloadSounds, type SoundId } from "@/lib/sounds";

function uid() { return Math.random().toString(36).slice(2, 10); }

async function api(action: string, body: object = {}): Promise<any> {
  try {
    const res = await fetch("/api/word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) return {};
    return res.json();
  } catch { return {}; }
}

async function apiGet(params: string): Promise<any> {
  try {
    const res = await fetch(`/api/word?${params}`);
    if (!res.ok) return {};
    return res.json();
  } catch { return {}; }
}

async function registerPlayer(playerId: string, name: string, country: string, countryFlag: string, sound: string) {
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", playerId, name, country, countryFlag, sound, score: 0 }),
    });
  } catch {}
}

const DROP_BASE_MS = 2800;  // starts at 2.8s between letters
const DROP_MIN_MS = 1400;   // never faster than 1.4s even at high rounds

export default function Page() {
  const [screen, setScreen] = useState<"signin"|"home"|"lobby"|"game"|"over"|"rematch"|"closed"|"queue">("signin");
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [myId] = useState(uid);

  // Profile
  const [myName, setMyName] = useState("");
  const [myCountry, setMyCountry] = useState(COUNTRIES[57]);
  const [mySound, setMySound] = useState<SoundId>("quack");
  const [countrySearch, setCountrySearch] = useState("");

  const [joinCode, setJoinCode] = useState("");
  const [homeMode, setHomeMode] = useState<"menu"|"create"|"join">("menu");
  const [countdown, setCountdown] = useState<number|null>(null);
  const [gameOver, setGameOver] = useState<Player[]>([]);
  const [error, setError] = useState("");
  const [resultsTimer, setResultsTimer] = useState(30);
  const [myVote, setMyVote] = useState<boolean|null>(null);
  const [queuedRoom, setQueuedRoom] = useState<string>("");
  const [queuePosition, setQueuePosition] = useState<number>(0);
  const queuePollRef = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);

  const roomCodeRef = useRef("");
  const phaseRef = useRef<string>("lobby");
  const roundRef = useRef<number>(1);
  const isHostRef = useRef(false);
  const countdownActiveRef = useRef(false);
  const advancingRef = useRef(false);
  const mySoundRef = useRef<SoundId>("quack");
  const pollRef = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const dropRef = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const resultRef = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const resultsTimerRef = useRef<ReturnType<typeof setInterval>|undefined>(undefined);

  useEffect(() => { mySoundRef.current = mySound; }, [mySound]);

  const syncState = (s: GameState) => {
    setState(s);
    phaseRef.current = s.phase;
    roundRef.current = s.round;
    if (s.roomCode) roomCodeRef.current = s.roomCode;
  };

  const myPlayer = state.players.find((p) => p.id === myId);
  const isHost = myPlayer?.isHost ?? false;
  const myColor = myPlayer?.color ?? "#FF3CAC";
  const isMuted = myPlayer?.muted ?? false;
  const canBuzz = state.phase === "dropping" && !myPlayer?.muted;
  const isMyTurn = state.phase === "buzzed" && state.buzzedPlayerId === myId;

  useEffect(() => { isHostRef.current = isHost; }, [isHost]);

  const stopAll = useCallback(() => {
    clearTimeout(pollRef.current);
    clearTimeout(dropRef.current);
    clearTimeout(resultRef.current);
    clearInterval(resultsTimerRef.current);
    clearTimeout(queuePollRef.current);
  }, []);

  const runCountdown = useCallback((from: number) => {
    if (countdownActiveRef.current) return;
    countdownActiveRef.current = true;
    setCountdown(from);
    let n = from;
    const tick = () => {
      n--;
      if (n <= 0) { setCountdown(null); countdownActiveRef.current = false; return; }
      setCountdown(n);
      setTimeout(tick, 1200);
    };
    setTimeout(tick, 1200);
  }, []);

  const startDropLoopRef = useRef<(code: string, round: number) => void>(() => {});

  const advanceRound = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    clearTimeout(resultRef.current);
    clearTimeout(dropRef.current);
    const code = roomCodeRef.current;
    if (!code) { advancingRef.current = false; return; }
    const d = await api("next-round", { roomCode: code });
    advancingRef.current = false;
    if (!d.state) return;
    syncState(d.state);
    if (d.state.phase === "gameover") {
      stopAll();
      const sorted = [...d.state.players].sort((a, b) => b.score - a.score);
      setGameOver(sorted);
      setScreen("over");
      startResultsTimer(code);
    } else {
      countdownActiveRef.current = false;
      runCountdown(3);
      setTimeout(() => startDropLoopRef.current(code, d.state.round), 4200);
    }
  }, [stopAll, runCountdown]);

  const startResultsTimer = (code: string) => {
    setResultsTimer(30);
    clearInterval(resultsTimerRef.current);
    let t = 30;
    resultsTimerRef.current = setInterval(() => {
      t--;
      setResultsTimer(t);
      if (t <= 0) {
        clearInterval(resultsTimerRef.current);
        // Auto-force to rematch screen after 30s
        api("force-rematch", { roomCode: code }).then((d) => {
          if (d.state) { syncState(d.state); setScreen("rematch"); }
        });
      }
    }, 1000);
  };

  const startDropLoop = useCallback((code: string, round: number) => {
    clearTimeout(dropRef.current);
    clearTimeout(resultRef.current);
    advancingRef.current = false;
    const delay = Math.max(DROP_MIN_MS, DROP_BASE_MS - (round - 1) * 15);
    const drop = async () => {
      const phase = phaseRef.current;
      if (phase !== "dropping" && phase !== "countdown") return;
      const data = await api("drop-letter", { roomCode: code });
      if (!data.state) { dropRef.current = setTimeout(drop, delay); return; }
      syncState(data.state);
      if (data.done) {
        resultRef.current = setTimeout(async () => {
          if (phaseRef.current === "dropping") await advanceRound();
        }, 7000);
      } else {
        dropRef.current = setTimeout(drop, delay);
      }
    };
    dropRef.current = setTimeout(drop, delay);
  }, [advanceRound]);

  useEffect(() => { startDropLoopRef.current = startDropLoop; }, [startDropLoop]);

  const startPolling = useCallback((code: string) => {
    clearTimeout(pollRef.current);
    let lastPhase = phaseRef.current;
    let lastBuzzedId: string | null = null;
    let failCount = 0;

    const poll = async () => {
      const data = await apiGet(`action=room-state&code=${code}`);
      if (data.state) {
        failCount = 0;
        const s: GameState = data.state;

        // Play buzz sound when someone buzzes in
        if (s.phase === "buzzed" && s.buzzedPlayerId && s.buzzedPlayerId !== lastBuzzedId) {
          lastBuzzedId = s.buzzedPlayerId;
          const buzzer = s.players.find(p => p.id === s.buzzedPlayerId);
          if (buzzer) playSound((buzzer.sound as SoundId) || "quack");
        }
        if (s.phase !== "buzzed") lastBuzzedId = null;

        if (!isHostRef.current) {
          syncState(s);
        } else {
          setState(prev => ({ ...prev, players: s.players, lastResult: s.lastResult }));
          phaseRef.current = s.phase;
          roundRef.current = s.round;
        }

        // Room closed — only 1 player left
        if (s.phase === "closed") {
          stopAll();
          setScreen("closed");
          return;
        }

        if (s.phase === "gameover" && lastPhase !== "gameover") {
          stopAll();
          const sorted = [...s.players].sort((a, b) => b.score - a.score);
          setGameOver(sorted);
          setScreen("over");
          startResultsTimer(code);
          lastPhase = s.phase;
          pollRef.current = setTimeout(poll, 800);
          return;
        }

        if (s.phase === "rematch" && lastPhase !== "rematch") {
          clearInterval(resultsTimerRef.current);
          setScreen("rematch");
          setMyVote(null);
        }

        if (s.phase === "lobby" && lastPhase === "rematch") {
          setScreen("lobby");
          setMyVote(null);
        }

        if (["countdown","dropping","buzzed","result"].includes(s.phase)) setScreen("game");

        if (!isHostRef.current && s.phase === "countdown" && lastPhase !== "countdown") {
          countdownActiveRef.current = false;
          runCountdown(3);
        }

        if (isHostRef.current && s.phase === "result" && lastPhase !== "result") {
          clearTimeout(resultRef.current);
          advancingRef.current = false;
          resultRef.current = setTimeout(() => advanceRound(), 5000);
        }

        if (isHostRef.current && s.phase === "dropping" && lastPhase === "buzzed") {
          clearTimeout(dropRef.current);
          clearTimeout(resultRef.current);
          setTimeout(() => {
            if (phaseRef.current === "dropping") startDropLoopRef.current(code, s.round);
          }, 500);
        }

        lastPhase = s.phase;
      } else {
        failCount++;
      }
      const nextDelay = Math.min(600 * Math.pow(1.5, Math.min(failCount, 4)), 3000);
      pollRef.current = setTimeout(poll, nextDelay);
    };
    poll();
  }, [stopAll, runCountdown, advanceRound]);

  const handleSignIn = async () => {
    if (!myName.trim()) return;
    preloadSounds(); // start loading audio files in background
    await registerPlayer(myId, myName.trim(), myCountry.name, myCountry.flag, mySound);
    setScreen("home");
  };

  const createRoom = async () => {
    setError("");
    const data = await api("create-room", { playerId: myId, playerName: myName.trim(), countryFlag: myCountry.flag, sound: mySound });
    if (data.error) { setError(data.error); return; }
    if (!data.state) { setError("Server error — try again"); return; }
    syncState(data.state);
    isHostRef.current = true;
    setScreen("lobby");
    startPolling(data.state.roomCode);
  };

  const joinRoom = async (codeOverride?: string) => {
    const code = (codeOverride ?? joinCode).trim().toUpperCase();
    if (!code) return;
    setError("");
    const data = await api("join-room", { playerId: myId, playerName: myName.trim(), countryFlag: myCountry.flag, sound: mySound, roomCode: code });
    if (data.error) { setError(data.error); return; }
    if (!data.state) { setError("Server error — try again"); return; }
    syncState(data.state);
    setScreen("lobby");
    startPolling(code);
  };

  const startGame = async () => {
    const code = roomCodeRef.current;
    const data = await api("start-game", { roomCode: code, playerId: myId });
    if (data.error) { setError(data.error); return; }
    if (!data.state) return;
    syncState(data.state);
    setScreen("game");
    countdownActiveRef.current = false;
    advancingRef.current = false;
    runCountdown(3);
    setTimeout(() => startDropLoop(code, data.state.round), 4200);
  };

  const handleLeave = async () => {
    stopAll();
    await api("leave", { roomCode: roomCodeRef.current, playerId: myId });
    setScreen("home");
    setHomeMode("menu");
    setState(INITIAL_STATE);
    roomCodeRef.current = "";
    isHostRef.current = false;
  };

  const handleOkResults = async () => {
    const data = await api("ok-results", { roomCode: roomCodeRef.current, playerId: myId });
    if (data.state) {
      syncState(data.state);
      if (data.state.phase === "rematch") {
        clearInterval(resultsTimerRef.current);
        setScreen("rematch");
        setMyVote(null);
      }
    }
  };

  const handleVoteRematch = async (vote: boolean) => {
    setMyVote(vote);
    const data = await api("vote-rematch", { roomCode: roomCodeRef.current, playerId: myId, vote });
    if (data.state) {
      syncState(data.state);
      if (data.state.phase === "lobby") {
        setScreen("lobby");
        setMyVote(null);
      }
    }
    if (!vote) {
      // Player said no — go home
      await handleLeave();
    }
  };

  const handleBuzz = async () => {
    if (phaseRef.current !== "dropping") return;
    clearTimeout(dropRef.current);
    playSound(mySoundRef.current);
    const data = await api("buzz", { roomCode: roomCodeRef.current, playerId: myId });
    if (data.state) syncState(data.state);
    else { if (isHostRef.current) startDropLoopRef.current(roomCodeRef.current, roundRef.current); }
  };

  const handleSubmit = async (answer: string) => {
    const code = roomCodeRef.current;
    const data = await api("answer", { roomCode: code, playerId: myId, answer });
    if (!data.state) return;
    syncState(data.state);
    if (data.state.phase === "gameover") {
      stopAll();
      const sorted = [...data.state.players].sort((a, b) => b.score - a.score);
      setGameOver(sorted);
      setScreen("over");
      startResultsTimer(code);
      return;
    }
    if (data.state.phase === "result" && isHostRef.current) {
      clearTimeout(resultRef.current);
      advancingRef.current = false;
      resultRef.current = setTimeout(() => advanceRound(), 5000);
    }
  };

  const handleQueueJoin = async (roomCode: string) => {
    const data = await api("queue-join", { roomCode, playerId: myId, playerName: myName, countryFlag: myCountry.flag, sound: mySound });
    if (data.ok) {
      setQueuedRoom(roomCode);
      setQueuePosition(data.position);
      setScreen("queue");
      // Poll queue status until the game ends and we get admitted
      const pollQueue = async () => {
        const status = await api("queue-status", { roomCode, playerId: myId });
        if (!status.phase) { setScreen("home"); return; } // room gone
        setQueuePosition(status.position);
        // Game finished — try to join as regular player now
        if (["lobby","rematch"].includes(status.phase)) {
          // Attempt actual join
          const joinData = await api("join-room", { playerId: myId, playerName: myName, countryFlag: myCountry.flag, sound: mySound, roomCode });
          if (joinData.state) {
            syncState(joinData.state);
            setScreen("lobby");
            startPolling(roomCode);
            return;
          }
        }
        queuePollRef.current = setTimeout(pollQueue, 3000);
      };
      pollQueue();
    }
  };

  const handleQueueLeave = async () => {
    clearTimeout(queuePollRef.current);
    if (queuedRoom) await api("queue-leave", { roomCode: queuedRoom, playerId: myId });
    setQueuedRoom("");
    setScreen("home");
  };

  useEffect(() => () => stopAll(), [stopAll]);

  const filteredCountries = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase())
  );

  return (
    <>
      <div className="bg-grid" />
      {screen === "signin" && (
        <div className="screen" style={{ gap: 0 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <div style={{ fontFamily: "var(--font-d)", fontSize: "clamp(2.4rem,10vw,4rem)", color: "var(--pink)", textShadow: "0 0 30px #FF3CAC80", lineHeight: 1 }}>LETTER</div>
            <div style={{ fontFamily: "var(--font-d)", fontSize: "clamp(2.4rem,10vw,4rem)", color: "var(--cyan)", textShadow: "0 0 30px #00F5FF80", lineHeight: 1 }}>BLITZ</div>
          </div>

          <div className="card" style={{ maxWidth: 380 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Name */}
              <div>
                <Label>YOUR FIRST NAME</Label>
                <input className="inp" style={{ marginTop: 6 }} placeholder="Enter your name"
                  value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={16} autoFocus />
              </div>

              {/* Country */}
              <div>
                <Label>YOUR COUNTRY</Label>
                <input className="inp" style={{ marginTop: 6 }} placeholder="Search country…"
                  value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)} />
                <div style={{
                  marginTop: 6, maxHeight: 140, overflowY: "auto",
                  background: "var(--bg)", border: "1px solid #22223a", borderRadius: 5,
                }}>
                  {filteredCountries.map(c => (
                    <div key={c.code} onClick={() => { setMyCountry(c); setCountrySearch(""); }}
                      style={{
                        padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                        background: myCountry.code === c.code ? "var(--bg3)" : "transparent",
                        borderLeft: myCountry.code === c.code ? "3px solid var(--cyan)" : "3px solid transparent",
                        fontSize: "0.9rem",
                      }}>
                      <span style={{ fontSize: "1.3rem" }}>{c.flag}</span>
                      <span style={{ color: myCountry.code === c.code ? "var(--cyan)" : "var(--text)" }}>{c.name}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: "0.85rem", color: "var(--cyan)", letterSpacing: "0.05em" }}>
                  Selected: {myCountry.flag} {myCountry.name}
                </div>
              </div>

              {/* Buzz sound */}
              <div>
                <Label>YOUR BUZZ SOUND</Label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                  {SOUNDS.map(s => (
                    <button key={s.id}
                      onClick={() => { setMySound(s.id); playSound(s.id); }}
                      style={{
                        padding: "10px 8px", borderRadius: 6, cursor: "pointer",
                        background: mySound === s.id ? "var(--bg3)" : "var(--bg2)",
                        border: `2px solid ${mySound === s.id ? "var(--cyan)" : "#22223a"}`,
                        color: mySound === s.id ? "var(--cyan)" : "var(--text)",
                        boxShadow: mySound === s.id ? "var(--glow-cyan)" : "none",
                        display: "flex", alignItems: "center", gap: 6,
                        fontFamily: "var(--font-b)", fontWeight: 600, fontSize: "0.85rem",
                        letterSpacing: "0.05em",
                      }}>
                      <span style={{ fontSize: "1.1rem" }}>{s.emoji}</span>
                      {s.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: "0.7rem", color: "#404060", marginTop: 6, textAlign: "center" }}>
                  Tap to preview · This plays when you buzz in
                </div>
              </div>

              <button className="btn btn-pink" style={{ fontSize: "1.1rem", padding: "15px", marginTop: 4 }}
                onClick={handleSignIn} disabled={!myName.trim()}>
                LET'S PLAY →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HOME ── */}
      {screen === "home" && (
        <HomeScreen
          myName={myName} myCountry={myCountry} mySound={mySound}
          homeMode={homeMode} setHomeMode={setHomeMode}
          joinCode={joinCode} setJoinCode={setJoinCode}
          error={error}
          onCreate={createRoom} onJoin={joinRoom}
          onQueueJoin={handleQueueJoin}
          onEditProfile={() => setScreen("signin")}
          myId={myId}
        />
      )}

      {/* ── LOBBY ── */}
      {screen === "lobby" && (
        <LobbyScreen state={state} myId={myId} isHost={isHost} onStart={startGame} error={error} onLeave={handleLeave} />
      )}

      {/* ── GAME ── */}
      {screen === "game" && (
        <div className="screen" style={{ gap: 10 }}>
          <GameBoard state={state} myId={myId} countdown={countdown} />
          <PlayerInput canBuzz={canBuzz} isMyTurn={isMyTurn} isMuted={isMuted}
            myColor={myColor} onBuzz={handleBuzz} onSubmit={handleSubmit} />
          <button onClick={handleLeave} style={{ position:"fixed", top:12, right:12, background:"transparent", border:"1px solid #2a2a44", color:"#404060", borderRadius:4, padding:"4px 10px", fontSize:"0.7rem", cursor:"pointer", letterSpacing:"0.08em" }}>LEAVE</button>
        </div>
      )}

      {/* ── GAME OVER ── */}
      {screen === "over" && (
        <GameOverScreen players={gameOver} myId={myId} timer={resultsTimer}
          myPlayer={state.players.find(p => p.id === myId)}
          onOk={handleOkResults} onLeave={handleLeave} />
      )}

      {/* ── REMATCH ── */}
      {screen === "rematch" && (
        <RematchScreen state={state} myId={myId} myVote={myVote} onVote={handleVoteRematch} />
      )}

      {/* ── ROOM CLOSED ── */}
      {screen === "closed" && (
        <div className="screen" style={{ gap: 20, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: "2rem", color: "var(--pink)", textShadow: "0 0 20px #FF3CAC80" }}>ROOM CLOSED</div>
          <div style={{ color: "#5050a0", fontSize: "0.9rem", letterSpacing: "0.1em" }}>The other player left the game.</div>
          <button className="btn btn-pink" style={{ maxWidth: 300 }} onClick={() => { setScreen("home"); setHomeMode("menu"); setState(INITIAL_STATE); roomCodeRef.current = ""; }}>Back to Home</button>
        </div>
      )}

      {/* ── QUEUE ── */}
      {screen === "queue" && (
        <div className="screen" style={{ gap: 20, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-d)", fontSize: "1.8rem", color: "var(--cyan)", textShadow: "0 0 20px #00F5FF80" }}>IN THE QUEUE</div>
          <div style={{ fontSize: "0.8rem", letterSpacing: "0.1em", color: "#5050a0" }}>Room: <span style={{ color: "var(--cyan)" }}>{queuedRoom}</span></div>
          <div style={{ fontFamily: "var(--font-d)", fontSize: "3rem", color: "var(--yellow)", textShadow: "0 0 20px #FFE03C80" }}>#{queuePosition}</div>
          <div style={{ fontSize: "0.85rem", color: "#5050a0", letterSpacing: "0.1em" }}>Waiting for current game to finish…</div>
          <div style={{ animation: "glow-pulse 2s infinite", fontSize: "0.75rem", color: "var(--pink)" }}>You'll be admitted automatically</div>
          <button className="btn btn-dim" style={{ maxWidth: 300 }} onClick={handleQueueLeave}>← Leave Queue</button>
        </div>
      )}
    </>
  );
}

// ─── Home Screen ─────────────────────────────────────────────────────────────
function HomeScreen({ myName, myCountry, mySound, homeMode, setHomeMode, joinCode, setJoinCode, error, onCreate, onJoin, onQueueJoin, onEditProfile, myId }: any) {
  const [rooms, setRooms] = useState<any[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const refreshRef = useRef<ReturnType<typeof setInterval>|undefined>(undefined);

  const fetchRooms = async () => {
    try {
      const res = await fetch("/api/word?action=list-rooms");
      const data = await res.json();
      setRooms(data.rooms ?? []);
    } catch {}
    setLoadingRooms(false);
  };

  useEffect(() => {
    fetchRooms();
    refreshRef.current = setInterval(fetchRooms, 5000);
    return () => clearInterval(refreshRef.current);
  }, []);

  const phaseLabel = (phase: string, round: number, maxRounds: number) => {
    if (phase === "lobby") return "In Lobby";
    if (phase === "gameover" || phase === "rematch") return "Game Over";
    return `Round ${round}/${maxRounds}`;
  };

  const levelColor = (level: number) => {
    const colors: Record<number,string> = { 1:"#39FF14", 2:"#00F5FF", 3:"#FFE03C", 4:"#FF3CAC" };
    return colors[level] ?? "#FF3CAC";
  };

  return (
    <div className="screen" style={{ gap: 0, overflowY: "auto", paddingBottom: 20 }}>
      {/* Profile bar */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: "clamp(2rem,9vw,3.5rem)", color: "var(--pink)", textShadow: "0 0 30px #FF3CAC80", lineHeight: 1 }}>LETTER</div>
        <div style={{ fontFamily: "var(--font-d)", fontSize: "clamp(2rem,9vw,3.5rem)", color: "var(--cyan)", textShadow: "0 0 30px #00F5FF80", lineHeight: 1 }}>BLITZ</div>
        <div style={{ marginTop: 8, fontSize: "1rem" }}>
          {myCountry.flag} <span style={{ color: "var(--cyan)", fontWeight: 700 }}>{myName}</span>
          <span style={{ marginLeft: 10, fontSize: "0.75rem", color: "var(--cyan)", cursor: "pointer" }} onClick={onEditProfile}>✏ Edit</span>
        </div>
        <div style={{ fontSize: "0.7rem", color: "#5050a0", marginTop: 2, letterSpacing: "0.08em" }}>
          Buzz: {SOUNDS.find((s: any) => s.id === mySound)?.emoji} {SOUNDS.find((s: any) => s.id === mySound)?.label}
        </div>
      </div>

      {/* Action buttons */}
      <div className="card" style={{ marginBottom: 16 }}>
        {homeMode === "menu" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="btn btn-pink" style={{ fontSize: "1.1rem", padding: "15px" }} onClick={() => { setHomeMode("create"); onCreate(); }}>⚡ Create New Room</button>
            <button className="btn btn-cyan" style={{ fontSize: "0.95rem" }} onClick={() => setHomeMode("join")}>🔑 Join by Code</button>
          </div>
        )}
        {homeMode === "create" && (
          <div style={{ textAlign: "center", padding: "16px", color: "var(--cyan)", letterSpacing: "0.1em", fontSize: "0.9rem", animation: "glow-pulse 2s infinite" }}>
            Creating room…
          </div>
        )}
        {homeMode === "join" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Label>ROOM CODE</Label>
            <input className="inp" placeholder="5-LETTER CODE" value={joinCode}
              onChange={(e: any) => setJoinCode(e.target.value.toUpperCase())} maxLength={5}
              style={{ textAlign: "center", letterSpacing: "0.3em", fontSize: "1.4rem" }} autoFocus />
            {error && <Err>{error}</Err>}
            <button className="btn btn-green" onClick={() => onJoin(joinCode)} disabled={joinCode.length < 4}>Join Game</button>
            <button className="btn btn-dim" style={{ fontSize: "0.85rem", padding: "10px" }} onClick={() => setHomeMode("menu")}>← Back</button>
          </div>
        )}
      </div>

      {/* Live rooms */}
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: "0.75rem", letterSpacing: "0.2em", color: "#5050a0" }}>LIVE ROOMS</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.65rem", color: "#404060" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 6px #39FF14", animation: "glow-pulse 2s infinite" }}/>
            Auto-refresh every 5s
          </div>
        </div>

        {loadingRooms && (
          <div style={{ textAlign: "center", color: "#5050a0", padding: "20px", fontSize: "0.85rem", animation: "glow-pulse 2s infinite" }}>
            Scanning for rooms…
          </div>
        )}

        {!loadingRooms && rooms.length === 0 && (
          <div style={{ textAlign: "center", color: "#404060", padding: "20px", fontSize: "0.85rem", border: "1px dashed #22223a", borderRadius: 8 }}>
            No active rooms right now.<br />
            <span style={{ fontSize: "0.75rem" }}>Create one and invite friends!</span>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rooms.map((room: any) => {
            const isPlaying = !["lobby"].includes(room.phase);
            const isFull = room.isFull;
            const canJoinNow = !isPlaying && !isFull;
            const canQueue = isPlaying && !isFull;
            const alreadyQueued = (room.queue ?? []).some((q: any) => q.id === myId);

            return (
              <div key={room.code} style={{
                background: "var(--bg2)", border: `1px solid ${isPlaying ? "#2a2a44" : "var(--cyan)"}`,
                borderRadius: 8, padding: "14px 16px",
                boxShadow: canJoinNow ? "0 0 16px #00F5FF20" : "none",
              }}>
                {/* Room header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontFamily: "var(--font-d)", fontSize: "1rem", letterSpacing: "0.2em", color: "var(--cyan)" }}>{room.code}</div>
                    {isPlaying && (
                      <div style={{ fontSize: "0.6rem", letterSpacing: "0.1em", color: levelColor(room.level), border: `1px solid ${levelColor(room.level)}`, padding: "2px 6px", borderRadius: 3 }}>
                        LV{room.level}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: isPlaying ? "var(--yellow)" : "var(--green)", letterSpacing: "0.08em" }}>
                    {isPlaying ? `⚡ ${phaseLabel(room.phase, room.round, room.maxRounds)}` : "🟢 OPEN"}
                  </div>
                </div>

                {/* Players */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {room.players.map((p: any, i: number) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px",
                      background: `${p.color}15`, border: `1px solid ${p.color}`, borderRadius: 20,
                      fontSize: "0.75rem", color: p.color }}>
                      <span>{p.countryFlag || "🌍"}</span>
                      <span>{p.name}</span>
                    </div>
                  ))}
                  {Array.from({ length: 4 - room.playerCount }).map((_, i) => (
                    <div key={`empty-${i}`} style={{ padding: "4px 8px", border: "1px dashed #22223a", borderRadius: 20, fontSize: "0.7rem", color: "#2a2a44" }}>
                      open
                    </div>
                  ))}
                </div>

                {/* Queue info */}
                {(room.queue?.length ?? 0) > 0 && (
                  <div style={{ fontSize: "0.65rem", color: "#5050a0", marginBottom: 8, letterSpacing: "0.05em" }}>
                    {room.queue.length} player{room.queue.length !== 1 ? "s" : ""} in queue
                  </div>
                )}

                {/* Action */}
                {canJoinNow && (
                  <button className="btn btn-cyan" style={{ fontSize: "0.85rem", padding: "10px" }}
                    onClick={() => onJoin(room.code)}>
                    Join Now →
                  </button>
                )}
                {canQueue && !alreadyQueued && (
                  <button className="btn btn-dim" style={{ fontSize: "0.85rem", padding: "10px", border: "1px solid #5050a0", color: "#8080c0" }}
                    onClick={() => onQueueJoin(room.code)}>
                    📋 Join Queue (#{(room.queue?.length ?? 0) + 1})
                  </button>
                )}
                {canQueue && alreadyQueued && (
                  <div style={{ fontSize: "0.75rem", color: "var(--cyan)", letterSpacing: "0.08em", padding: "8px 0" }}>
                    ✓ You're in the queue
                  </div>
                )}
                {isFull && !isPlaying && (
                  <div style={{ fontSize: "0.75rem", color: "#404060" }}>Room is full</div>
                )}
                {isFull && isPlaying && (
                  <div style={{ fontSize: "0.75rem", color: "#404060" }}>Full · watching only</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────────
const SLOT_LABELS = ["HOST","P2","P3","P4"];
const COLOR_GLOWS: Record<string,string> = {
  "#FF3CAC":"0 0 16px #FF3CAC50","#00F5FF":"0 0 16px #00F5FF50",
  "#FFE03C":"0 0 16px #FFE03C50","#39FF14":"0 0 16px #39FF1450",
};

function LobbyScreen({ state, myId, isHost, onStart, error, onLeave }: any) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(state.roomCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); };
  return (
    <div className="screen" style={{ gap: 0 }}>
      <button onClick={onLeave} style={{ position:"fixed", top:12, right:12, background:"transparent", border:"1px solid #2a2a44", color:"#404060", borderRadius:4, padding:"4px 10px", fontSize:"0.7rem", cursor:"pointer", letterSpacing:"0.08em" }}>LEAVE</button>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: "1.8rem", color: "var(--pink)", textShadow: "0 0 20px #FF3CAC60" }}>LETTER BLITZ</div>
        <div style={{ fontSize: "0.7rem", letterSpacing: "0.2em", color: "#5050a0", marginTop: 6 }}>ROOM CODE</div>
        <div onClick={copy} style={{ fontFamily: "var(--font-d)", fontSize: "3rem", letterSpacing: "0.3em", color: "var(--cyan)", textShadow: "0 0 20px #00F5FF80", cursor: "pointer" }}>
          {state.roomCode}
        </div>
        <div style={{ fontSize: "0.7rem", color: copied ? "var(--green)" : "#404060" }}>
          {copied ? "✓ Copied!" : "Tap code to copy · Share with friends"}
        </div>
      </div>
      <div style={{ width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {[0,1,2,3].map((i) => {
          const p: Player|undefined = state.players[i];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
              background: p ? "var(--bg3)" : "var(--bg2)",
              border: `${p && p.id===myId ? 2 : 1}px solid ${p ? p.color : "#22223a"}`,
              borderRadius: 7, boxShadow: p ? COLOR_GLOWS[p.color] : "none" }}>
              {p ? <span style={{ fontSize: "1.4rem" }}>{p.countryFlag || "🌍"}</span>
                 : <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#22223a" }}/>}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.95rem", color: p ? p.color : "#404060" }}>{p ? p.name : "Waiting…"}</div>
                <div style={{ fontSize: "0.65rem", color: "#404060", marginTop: 1 }}>
                  {SLOT_LABELS[i]}{p?.id===myId ? " · YOU" : ""}
                  {p && ` · ${SOUNDS.find(s=>s.id===p.sound)?.emoji ?? "🔔"}`}
                </div>
              </div>
              {p?.id===myId && <div style={{ fontSize: "0.65rem", color: "var(--green)", border: "1px solid var(--green)", padding: "3px 7px", borderRadius: 3 }}>READY</div>}
            </div>
          );
        })}
      </div>
      {error && <Err style={{ marginBottom: 12 }}>{error}</Err>}
      {isHost ? (
        <button className={`btn ${state.players.length>=2 ? "btn-pink" : "btn-dim"}`}
          style={{ maxWidth: 400, fontSize: "1.2rem", padding: "18px" }}
          onClick={onStart} disabled={state.players.length < 2}>
          {state.players.length >= 2 ? "⚡ START GAME" : `Need ${2-state.players.length} more player${2-state.players.length!==1?"s":""}`}
        </button>
      ) : (
        <div style={{ color: "#5050a0", fontSize: "0.85rem", animation: "glow-pulse 2s infinite" }}>Waiting for host to start…</div>
      )}
    </div>
  );
}

// ─── Game Over ────────────────────────────────────────────────────────────────
const MEDALS = ["🥇","🥈","🥉","4️⃣"];

function GameOverScreen({ players, myId, timer, myPlayer, onOk, onLeave }: any) {
  const alreadyOk = myPlayer?.okResults ?? false;
  const okCount = players.filter((p: Player) => p.okResults).length;

  return (
    <div className="screen" style={{ gap: 0 }}>
      {/* Timer bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 4, background: "#1a1a2a" }}>
        <div style={{ height: "100%", background: timer > 10 ? "var(--cyan)" : "var(--pink)",
          width: `${(timer/30)*100}%`, transition: "width 1s linear, background 0.5s",
          boxShadow: timer > 10 ? "var(--glow-cyan)" : "var(--glow-pink)" }}/>
      </div>

      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: "var(--font-d)", fontSize: "2rem", color: "var(--yellow)", textShadow: "0 0 30px #FFE03C80", animation: "glow-pulse 2s infinite" }}>GAME OVER</div>
        {players[0] && <div style={{ marginTop: 6, fontSize: "1rem", color: players[0].color }}>{players[0].countryFlag} {players[0].name} WINS!</div>}
        <div style={{ fontSize: "0.7rem", color: "#5050a0", marginTop: 6, letterSpacing: "0.1em" }}>
          Results close in {timer}s · {okCount}/{players.length} ready
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: 390, display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {players.map((p: Player, i: number) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
            background: i===0 ? `${p.color}18` : "var(--bg2)",
            border: `${i===0?2:1}px solid ${i===0?p.color:"#22223a"}`,
            borderRadius: 8, boxShadow: i===0 ? `0 0 28px ${p.color}35` : "none" }}>
            <div style={{ fontSize: "1.3rem" }}>{MEDALS[i]}</div>
            <span style={{ fontSize: "1.2rem" }}>{p.countryFlag || "🌍"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: p.color }}>{p.name}</div>
              <div style={{ fontSize: "0.6rem", color: "#404060" }}>{p.colorName}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              <div style={{ fontFamily: "var(--font-d)", fontSize: i===0?"1.7rem":"1.3rem", color: p.color, textShadow: COLOR_GLOWS[p.color] }}>{p.score}</div>
              {p.okResults && <div style={{ fontSize: "0.6rem", color: "var(--green)", letterSpacing: "0.08em" }}>✓ READY</div>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ width: "100%", maxWidth: 390, display: "flex", gap: 10 }}>
        {!alreadyOk ? (
          <button className="btn btn-green" style={{ flex: 1, fontSize: "1rem", padding: "14px" }} onClick={onOk}>
            ✓ OK — Next
          </button>
        ) : (
          <div style={{ flex: 1, textAlign: "center", color: "var(--green)", fontSize: "0.85rem", padding: "14px", animation: "glow-pulse 2s infinite", letterSpacing: "0.1em" }}>
            Waiting for others…
          </div>
        )}
        <button className="btn btn-dim" style={{ flex: 0, padding: "14px 18px", fontSize: "0.85rem" }} onClick={onLeave}>Leave</button>
      </div>
    </div>
  );
}

// ─── Rematch Screen ───────────────────────────────────────────────────────────
function RematchScreen({ state, myId, myVote, onVote }: any) {
  const players: Player[] = state.players;
  const votedYes = players.filter((p: Player) => p.readyForRematch).length;

  return (
    <div className="screen" style={{ gap: 0, textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-d)", fontSize: "2rem", color: "var(--cyan)", textShadow: "0 0 20px #00F5FF80", marginBottom: 8 }}>
        PLAY AGAIN?
      </div>
      <div style={{ fontSize: "0.8rem", color: "#5050a0", letterSpacing: "0.1em", marginBottom: 24 }}>
        Need all {players.length} players to agree
      </div>

      {/* Player vote status */}
      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {players.map((p: Player) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
            background: "var(--bg2)", border: `1px solid ${p.color}`, borderRadius: 7,
            boxShadow: p.readyForRematch ? COLOR_GLOWS[p.color] : "none",
            opacity: p.readyForRematch === false && !p.okResults ? 0.4 : 1 }}>
            <span style={{ fontSize: "1.3rem" }}>{p.countryFlag || "🌍"}</span>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontWeight: 700, color: p.color, fontSize: "0.95rem" }}>{p.name}</div>
            </div>
            <div style={{ fontSize: "1rem" }}>
              {p.readyForRematch ? "✅" : myVote !== null && p.id === myId ? "❌" : "⏳"}
            </div>
          </div>
        ))}
      </div>

      {myVote === null ? (
        <div style={{ width: "100%", maxWidth: 360, display: "flex", gap: 12 }}>
          <button className="btn btn-green" style={{ flex: 1, fontSize: "1.1rem", padding: "16px" }} onClick={() => onVote(true)}>
            ✅ Play Again!
          </button>
          <button className="btn btn-dim" style={{ flex: 1, fontSize: "1rem", padding: "16px" }} onClick={() => onVote(false)}>
            ❌ No Thanks
          </button>
        </div>
      ) : myVote === true ? (
        <div style={{ color: "var(--green)", fontSize: "0.9rem", letterSpacing: "0.1em", animation: "glow-pulse 2s infinite" }}>
          Waiting for others… ({votedYes}/{players.length} ready)
        </div>
      ) : null}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "0.72rem", letterSpacing: "0.18em", color: "#5050a0" }}>{children}</div>;
}
function Err({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ color: "var(--pink)", fontSize: "0.82rem", textAlign: "center", ...style }}>{children}</div>;
}
