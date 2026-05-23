"use client";
import { useState } from "react";
import { isBTAvailable, connectAsClient } from "@/utils/bluetooth";
import type { BTMessage } from "@/utils/bluetooth";

type Props = {
  onMessage: (msg: BTMessage) => void;
  onConnected: (helpers: { sendBuzz: Function; sendAnswer: Function; disconnect: Function }) => void;
};

export default function BluetoothConnect({ onMessage, onConnected }: Props) {
  const [status, setStatus] = useState<"idle" | "scanning" | "connected" | "error">("idle");
  const [error, setError] = useState("");

  const available = isBTAvailable();

  const handleConnect = async () => {
    setStatus("scanning");
    setError("");
    try {
      const helpers = await connectAsClient(onMessage);
      setStatus("connected");
      onConnected(helpers);
    } catch (err: any) {
      setStatus("error");
      setError(err.message ?? "Bluetooth connection failed");
    }
  };

  if (!available) {
    return (
      <div style={{ textAlign: "center", color: "#6060a0", fontSize: "0.8rem", letterSpacing: "0.08em", lineHeight: 1.7 }}>
        ⚠️ Web Bluetooth not available
        <br />
        Use Chrome/Edge on Android or desktop
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {status !== "connected" ? (
        <button
          className="btn btn-cyan"
          onClick={handleConnect}
          disabled={status === "scanning"}
          style={{ fontSize: "0.9rem" }}
        >
          {status === "scanning" ? "🔍 Scanning..." : "📡 Connect via Bluetooth"}
        </button>
      ) : (
        <div style={{ textAlign: "center", color: "var(--cyan)", fontSize: "0.85rem", letterSpacing: "0.1em", animation: "glow-pulse 2s infinite" }}>
          📡 BLUETOOTH CONNECTED
        </div>
      )}
      {error && (
        <div style={{ color: "var(--pink)", fontSize: "0.8rem", textAlign: "center" }}>{error}</div>
      )}
      <div style={{ fontSize: "0.7rem", color: "#404060", textAlign: "center", letterSpacing: "0.05em" }}>
        Bluetooth connects you directly to the host device
      </div>
    </div>
  );
}
