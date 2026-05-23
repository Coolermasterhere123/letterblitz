"use client";
import { useState, useRef, useEffect } from "react";

type Props = {
  canBuzz: boolean;
  isMyTurn: boolean;
  isMuted: boolean;
  myColor: string;
  onBuzz: () => void;
  onSubmit: (answer: string) => void;
};

export default function PlayerInput({ canBuzz, isMyTurn, isMuted, myColor, onBuzz, onSubmit }: Props) {
  const [answer, setAnswer] = useState("");
  const [pressing, setPressing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isMyTurn) setTimeout(() => inputRef.current?.focus(), 80);
    else setAnswer("");
  }, [isMyTurn]);

  const handleBuzz = () => {
    if (!canBuzz || isMuted) return;
    setPressing(true);
    onBuzz();
    setTimeout(() => setPressing(false), 180);
  };

  const handleSubmit = () => {
    if (!answer.trim()) return;
    onSubmit(answer.trim());
    setAnswer("");
  };

  const buzzLabel = () => {
    if (isMuted) return "🔇 MUTED THIS WORD";
    if (isMyTurn) return "TYPE YOUR ANSWER!";
    if (canBuzz) return "⚡ BUZZ IN";
    return "WAIT…";
  };

  return (
    <div style={{ width:"100%", maxWidth:420, display:"flex", flexDirection:"column", gap:10 }}>
      {/* Answer input — only when it's your turn */}
      {isMyTurn && (
        <div style={{ display:"flex", gap:10, animation:"flash-in 0.2s ease" }}>
          <input
            ref={inputRef}
            className="inp"
            placeholder="Type the word…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key==="Enter" && handleSubmit()}
            style={{ flex:1, letterSpacing:"0.15em", textTransform:"uppercase" }}
            autoComplete="off" autoCorrect="off" spellCheck={false}
          />
          <button
            className="btn btn-green"
            onClick={handleSubmit}
            disabled={!answer.trim()}
            style={{ width:"auto", padding:"13px 20px", fontSize:"1.3rem" }}
          >✓</button>
        </div>
      )}

      {/* Buzz button */}
      <button
        onPointerDown={handleBuzz}
        disabled={!canBuzz || isMuted}
        style={{
          width:"100%", height:80,
          fontFamily:"var(--font-d)", fontSize: isMuted ? "1.1rem" : "1.8rem",
          letterSpacing:"0.08em", borderRadius:8,
          cursor: (canBuzz && !isMuted) ? "pointer" : "not-allowed",
          background: isMuted ? "#1c1c2e" : canBuzz ? myColor : "#1c1c2e",
          color: isMuted ? "#FF3CAC60" : canBuzz ? "#000" : "#404060",
          boxShadow: isMuted
            ? "0 0 20px #FF3CAC20, inset 0 0 20px #FF3CAC10"
            : canBuzz
              ? `0 0 30px ${myColor}80, 0 6px 0 ${myColor}60`
              : "0 4px 0 #111",
          transform: pressing ? "translateY(5px)" : "translateY(0)",
          transition:"transform 0.08s, box-shadow 0.1s, background 0.2s",
          border: isMuted ? "1px solid #FF3CAC30" : "none",
        }}
      >
        {buzzLabel()}
      </button>
    </div>
  );
}
