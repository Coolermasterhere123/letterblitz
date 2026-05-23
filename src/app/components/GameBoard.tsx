"use client";
import { useEffect, useRef, useState } from "react";
import type { GameState, ResultEvent } from "@/lib/gameTypes";
import { LEVEL_NAMES } from "@/lib/gameTypes";

const COLOR_GLOWS: Record<string, string> = {
  "#FF3CAC": "0 0 20px #FF3CAC70, 0 0 50px #FF3CAC30",
  "#00F5FF": "0 0 20px #00F5FF70, 0 0 50px #00F5FF30",
  "#FFE03C": "0 0 20px #FFE03C70, 0 0 50px #FFE03C30",
  "#39FF14": "0 0 20px #39FF1470, 0 0 50px #39FF1430",
};

type Props = { state: GameState; myId: string; countdown: number | null; };

export default function GameBoard({ state, myId, countdown }: Props) {
  const { phase, revealedLetters, totalLetters, players, round, maxRounds, buzzedPlayerId, lastResult, level } = state;
  const buzzedPlayer = players.find((p) => p.id === buzzedPlayerId);
  const [latestIdx, setLatestIdx] = useState(-1);
  const [wrongFlash, setWrongFlash] = useState(false);

  useEffect(() => {
    const idx = revealedLetters.length - 1;
    setLatestIdx(idx);
    const t = setTimeout(() => setLatestIdx(-2), 350);
    return () => clearTimeout(t);
  }, [revealedLetters.length]);

  // Flash wrong result
  useEffect(() => {
    if (lastResult?.type === "wrong") {
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 600);
    }
  }, [lastResult]);

  const roundsInLevel = 3;
  const roundInLevel = ((round - 1) % roundsInLevel) + 1;

  return (
    <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 8 }}>

      {/* Level + round bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{
          fontFamily: "var(--font-d)", fontSize: "0.7rem", letterSpacing: "0.15em",
          color: getLevelColor(level), textShadow: `0 0 10px ${getLevelColor(level)}80`,
        }}>
          {LEVEL_NAMES[level]}
        </div>
        <div style={{ fontSize: "0.7rem", letterSpacing: "0.1em", color: "#5050a0" }}>
          {roundInLevel}/{roundsInLevel}
        </div>
      </div>

      {/* Letter arena */}
      <div style={{
        position: "relative", height: "30vh",
        background: "var(--bg2)", border: `1px solid ${getLevelColor(level)}40`,
        borderRadius: 10, overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: wrongFlash ? `0 0 40px #FF3CAC60` : "none",
        transition: "box-shadow 0.2s",
      }}>
        {/* Corner brackets */}
        {[{t:8,l:8},{t:8,r:8},{b:8,l:8},{b:8,r:8}].map((c,i) => (
          <div key={i} style={{
            position:"absolute", top:c.t, bottom:c.b, left:c.l, right:c.r,
            width:18, height:18,
            borderTop: i<2 ? `2px solid ${getLevelColor(level)}` : "none",
            borderBottom: i>=2 ? `2px solid ${getLevelColor(level)}` : "none",
            borderLeft: i%2===0 ? `2px solid ${getLevelColor(level)}` : "none",
            borderRight: i%2===1 ? `2px solid ${getLevelColor(level)}` : "none",
            opacity: 0.6,
          }}/>
        ))}

        {/* Countdown overlay */}
        {countdown !== null && (
          <div style={{ position:"absolute", inset:0, zIndex:10, background:"rgba(10,10,15,0.8)",
            display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:8 }}>
            {/* Show level name on countdown start */}
            {countdown >= 2 && (
              <div style={{ fontFamily:"var(--font-d)", fontSize:"0.9rem", letterSpacing:"0.2em",
                color: getLevelColor(level), textShadow:`0 0 20px ${getLevelColor(level)}` }}>
                {LEVEL_NAMES[level]}
              </div>
            )}
            <span key={countdown} style={{
              fontFamily:"var(--font-d)", fontSize:"7rem",
              color:"var(--yellow)", textShadow:"0 0 30px #FFE03C80",
              animation:"count-pulse 0.85s ease forwards",
            }}>{countdown}</span>
          </div>
        )}

        {/* Result overlay */}
        {phase === "result" && lastResult && <ResultOverlay result={lastResult} />}

        {/* Wrong flash banner (stays visible during dropping) */}
        {phase === "dropping" && lastResult?.type === "wrong" && (
          <div style={{
            position:"absolute", top:0, left:0, right:0,
            background:"rgba(255,60,172,0.15)", borderBottom:"1px solid #FF3CAC50",
            padding:"6px", textAlign:"center",
            fontSize:"0.7rem", color:"var(--pink)", letterSpacing:"0.08em",
          }}>
            ✗ {lastResult.playerName} got it wrong! Others can buzz in…
          </div>
        )}

        {/* Letters */}
        <div style={{ display:"flex", flexWrap:"wrap", gap:"8px 6px", justifyContent:"center", padding:16 }}>
          {revealedLetters.map((letter, i) => (
            <LetterTile key={i} letter={letter} isLatest={i===latestIdx} levelColor={getLevelColor(level)} />
          ))}
          {(phase==="dropping"||phase==="buzzed") &&
            Array.from({ length: totalLetters - revealedLetters.length }).map((_,i) => (
              <div key={`ph-${i}`} style={{
                width:44, height:52, border:"1px solid #22223a", borderRadius:4, background:"var(--bg)",
              }}/>
            ))}
        </div>

        {phase==="countdown" && revealedLetters.length===0 && countdown===null && (
          <span style={{ fontFamily:"var(--font-b)", fontSize:"0.85rem", letterSpacing:"0.2em", color:"#404060" }}>
            GET READY…
          </span>
        )}
      </div>

      {/* Buzzed banner */}
      {phase==="buzzed" && buzzedPlayer && (
        <div style={{
          padding:"10px 16px", textAlign:"center",
          background:`${buzzedPlayer.color}18`, border:`2px solid ${buzzedPlayer.color}`,
          borderRadius:7, boxShadow:COLOR_GLOWS[buzzedPlayer.color],
          animation:"buzz-shake 0.35s ease",
        }}>
          <span style={{ fontFamily:"var(--font-b)", fontWeight:700, fontSize:"1rem",
            letterSpacing:"0.12em", color:buzzedPlayer.color, textShadow:COLOR_GLOWS[buzzedPlayer.color] }}>
            ⚡ {buzzedPlayer.name.toUpperCase()} BUZZED IN!
          </span>
        </div>
      )}

      {/* Player scoreboard — always visible */}
      <div style={{ display:"flex", gap:6 }}>
        {players.map((p) => (
          <div key={p.id} style={{
            flex:1, padding:"8px 4px", textAlign:"center",
            background: p.id===myId ? `${p.color}15` : "var(--bg2)",
            border:`${p.id===myId?2:1}px solid ${p.id===myId?p.color:"#22223a"}`,
            borderRadius:7,
            boxShadow: p.id===myId ? `0 0 14px ${p.color}30` : "none",
            opacity: p.muted ? 0.45 : 1,
            transition:"opacity 0.3s",
          }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:p.color,
              boxShadow:COLOR_GLOWS[p.color], margin:"0 auto 4px" }}/>
            <div style={{ fontFamily:"var(--font-b)", fontWeight:700, fontSize:"0.65rem",
              color:p.color, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              letterSpacing:"0.03em" }}>
              {p.name}
            </div>
            <div style={{ fontFamily:"var(--font-d)", fontSize:"1.3rem",
              color:p.color, textShadow:COLOR_GLOWS[p.color] }}>
              {p.score}
            </div>
            {p.muted && (
              <div style={{ fontSize:"0.55rem", color:"var(--pink)", letterSpacing:"0.05em", marginTop:2 }}>
                MUTED
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function getLevelColor(level: number): string {
  const colors: Record<number,string> = { 1:"#39FF14", 2:"#00F5FF", 3:"#FFE03C", 4:"#FF3CAC" };
  return colors[level] ?? "#FF3CAC";
}

function LetterTile({ letter, isLatest, levelColor }: { letter:string; isLatest:boolean; levelColor:string }) {
  return (
    <div style={{
      width:44, height:52, display:"flex", alignItems:"center", justifyContent:"center",
      background: isLatest ? levelColor : "var(--bg3)",
      border:`2px solid ${isLatest ? levelColor : "#2a2a44"}`,
      borderRadius:4,
      boxShadow: isLatest ? `0 0 20px ${levelColor}80` : "none",
      animation: isLatest ? "letter-pop 0.3s cubic-bezier(0.34,1.56,0.64,1)" : "none",
      transition:"background 0.5s, border-color 0.5s",
    }}>
      <span style={{ fontFamily:"var(--font-d)", fontSize:"1.55rem", color: isLatest ? "#000" : "var(--text)" }}>
        {letter}
      </span>
    </div>
  );
}

function ResultOverlay({ result }: { result: ResultEvent }) {
  const isCorrect = result.type === "correct";
  return (
    <div style={{
      position:"absolute", inset:0, zIndex:10,
      background:"rgba(10,10,15,0.9)",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center", gap:8,
      animation: isCorrect ? "flash-in 0.2s ease" : "buzz-shake 0.35s ease",
    }}>
      <span style={{ fontFamily:"var(--font-d)", fontSize:"1.1rem",
        color: isCorrect ? "var(--green)" : "var(--pink)",
        textShadow: isCorrect ? "0 0 20px #39FF1480" : "0 0 20px #FF3CAC80" }}>
        {isCorrect ? "✓ CORRECT!" : result.type==="timeout" ? "⏱ TIME UP!" : "✗ WRONG!"}
      </span>
      <span style={{ fontFamily:"var(--font-d)", fontSize:"2rem", color:result.playerColor ?? "var(--text)" }}>
        {result.word}
      </span>
      {isCorrect && (
        <>
          <span style={{ fontFamily:"var(--font-d)", fontSize:"1.5rem", color:"var(--yellow)", textShadow:"0 0 20px #FFE03C80" }}>
            +{result.points} PTS
          </span>
          {(result.bonus??0)>0 && (
            <span style={{ fontSize:"0.75rem", color:"var(--cyan)", letterSpacing:"0.08em" }}>
              +{result.bonus} speed bonus!
            </span>
          )}
        </>
      )}
      {!isCorrect && result.message && (
        <span style={{ fontSize:"0.8rem", color:"#6060a0", letterSpacing:"0.06em", textAlign:"center", padding:"0 16px" }}>
          {result.message}
        </span>
      )}
    </div>
  );
}
