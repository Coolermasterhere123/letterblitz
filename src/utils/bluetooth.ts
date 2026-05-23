// LetterBlitz Bluetooth Multiplayer
// Uses Web Bluetooth API + BLE GATT to sync game state between devices.
// One device is HOST (peripheral), others are CLIENTS (centrals).
//
// IMPORTANT: Web Bluetooth requires HTTPS and a user gesture to trigger.
// It works in Chrome/Edge on Android, desktop Chrome/Edge.
// NOT supported in Firefox or Safari.

export const BT_SERVICE_UUID = "0000fff0-0000-1000-8000-00805f9b34fb";
export const BT_CHAR_GAME_UUID = "0000fff1-0000-1000-8000-00805f9b34fb"; // host → clients: game state
export const BT_CHAR_BUZZ_UUID = "0000fff2-0000-1000-8000-00805f9b34fb"; // client → host: buzz/answer

export type BTMessage =
  | { type: "state"; payload: import("@/lib/gameTypes").GameState }
  | { type: "letter"; letter: string; index: number; revealed: string[] }
  | { type: "buzz"; playerId: string; playerName: string }
  | { type: "answer"; playerId: string; answer: string }
  | { type: "correct"; playerName: string; word: string; points: number }
  | { type: "wrong"; playerName: string; word: string }
  | { type: "countdown"; value: number }
  | { type: "gameover"; players: import("@/lib/gameTypes").Player[] };

// Encode object → ArrayBuffer for BLE characteristic write
export function encode(msg: BTMessage): ArrayBuffer {
  const str = JSON.stringify(msg);
  const encoded = new TextEncoder().encode(str);
  return encoded.buffer.slice(0) as ArrayBuffer;
}

// Decode Uint8Array → BTMessage
export function decode(buffer: DataView | ArrayBuffer): BTMessage | null {
  try {
    const bytes = buffer instanceof DataView ? buffer.buffer : buffer;
    const str = new TextDecoder().decode(bytes);
    return JSON.parse(str) as BTMessage;
  } catch {
    return null;
  }
}

// Check if Web Bluetooth is available in this browser
export function isBTAvailable(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

// ─── CLIENT: scan & connect to a host device ─────────────────────────────────
export async function connectAsClient(
  onMessage: (msg: BTMessage) => void
): Promise<{
  device: BluetoothDevice;
  sendBuzz: (playerId: string, playerName: string) => Promise<void>;
  sendAnswer: (playerId: string, answer: string) => Promise<void>;
  disconnect: () => void;
}> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: "LetterBlitz" }],
    optionalServices: [BT_SERVICE_UUID],
  });

  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(BT_SERVICE_UUID);

  // Subscribe to game state updates from host
  const gameChar = await service.getCharacteristic(BT_CHAR_GAME_UUID);
  await gameChar.startNotifications();
  gameChar.addEventListener("characteristicvaluechanged", (e: any) => {
    const msg = decode(e.target.value);
    if (msg) onMessage(msg);
  });

  const buzzChar = await service.getCharacteristic(BT_CHAR_BUZZ_UUID);

  const sendBuzz = async (playerId: string, playerName: string) => {
    await buzzChar.writeValue(encode({ type: "buzz", playerId, playerName }));
  };

  const sendAnswer = async (playerId: string, answer: string) => {
    await buzzChar.writeValue(encode({ type: "answer", playerId, answer }));
  };

  const disconnect = () => {
    if (device.gatt?.connected) device.gatt.disconnect();
  };

  return { device, sendBuzz, sendAnswer, disconnect };
}

// NOTE: Web Bluetooth does not support acting as a GATT server (peripheral) from a browser.
// The HOST device uses the Vercel API route for word generation and manages game state locally.
// State is broadcast to clients by the host writing to a shared BLE characteristic
// via a compatible BLE peripheral (e.g. phone with a native BLE app, or Web Bluetooth
// in a supported future browser implementation).
//
// PRACTICAL APPROACH for 4-player local game:
// All 4 devices connect to the same WiFi/hotspot and use the Vercel-deployed app.
// The host creates a room code; clients join via the same web app.
// Game state syncs via Vercel API routes (polling or SSE).
// This gives the same real-time party feel without requiring BLE peripheral support.
//
// The bluetooth.ts utilities above are ready for when browsers support BLE peripheral mode,
// or if you bridge via a native app/Raspberry Pi BLE peripheral.
