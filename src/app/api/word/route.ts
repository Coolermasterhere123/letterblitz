import { fetchWordBatchForLength } from "@/lib/groqClient";
import { NextResponse } from "next/server";
import { PLAYER_COLORS, PLAYER_COLOR_NAMES, INITIAL_STATE, shuffle, getLevelForRound, LEVEL_WORD_LENGTH, MAX_ROUNDS } from "@/lib/gameTypes";
import type { GameState } from "@/lib/gameTypes";
import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const dynamic = "force-dynamic";
const ROOM_TTL = 60 * 60 * 2;

type QueuedPlayer = { id: string; name: string; countryFlag: string; sound: string; };

type RoomData = {
  wordBanks: Record<number, string[]>;
  usedWords: string[];
  state: GameState;
  lastActivity: number;
  queue: QueuedPlayer[]; // players waiting to join after current game
};

async function getRoom(code: string): Promise<RoomData | null> {
  try {
    const room = await kv.get<RoomData>(`room:${code}`);
    if (room && !room.queue) room.queue = [];
    return room;
  } catch { return null; }
}
async function saveRoom(code: string, room: RoomData): Promise<void> {
  try {
    await kv.set(`room:${code}`, room, { ex: ROOM_TTL });
    // Maintain public index
    await kv.sadd("rooms:index", code);
  } catch {}
}
async function deleteRoom(code: string): Promise<void> {
  try {
    await kv.del(`room:${code}`);
    await kv.srem("rooms:index", code);
  } catch {}
}

async function ensureWordsForLevel(room: RoomData, level: number) {
  if (!room.wordBanks[level]) room.wordBanks[level] = [];
  if (room.wordBanks[level].length < 3) {
    const length = LEVEL_WORD_LENGTH[level];
    const fresh = shuffle(await fetchWordBatchForLength(length));
    const newWords = fresh.filter((w) => !room.usedWords.includes(w));
    room.wordBanks[level].push(...newWords);
  }
}

function pickWord(room: RoomData, level: number): string {
  const bank = room.wordBanks[level] ?? [];
  if (bank.length === 0) return "A".repeat(LEVEL_WORD_LENGTH[level]);
  const idx = Math.floor(Math.random() * bank.length);
  const word = bank.splice(idx, 1)[0];
  room.usedWords.push(word);
  return word;
}

function setupRound(room: RoomData, round: number, word: string) {
  const level = getLevelForRound(round);
  room.state.round = round;
  room.state.level = level;
  room.state.phase = "countdown";
  room.state.revealedLetters = [];
  room.state.buzzedPlayerId = null;
  room.state.lastResult = null;
  room.state.currentWord = word;
  room.state.totalLetters = word.length;
  room.state.players.forEach((p) => { p.buzzed = false; p.muted = false; });
  room.lastActivity = Date.now();
}

function makePlayer(body: any, idx: number, isHost: boolean) {
  return {
    id: body.playerId, name: body.playerName,
    color: PLAYER_COLORS[idx], colorName: PLAYER_COLOR_NAMES[idx],
    score: 0, buzzed: false, muted: false, isHost,
    countryFlag: body.countryFlag ?? "🌍", sound: body.sound ?? "quack",
    readyForRematch: false, okResults: false,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (action === "room-state") {
    const room = await getRoom(searchParams.get("code") ?? "");
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json({ state: room.state });
  }

  if (action === "list-rooms") {
    try {
      const codes = await kv.smembers<string[]>("rooms:index");
      if (!codes || codes.length === 0) return NextResponse.json({ rooms: [] });

      const now = Date.now();
      const rooms = [];

      for (const code of codes) {
        const room = await kv.get<RoomData>(`room:${code}`);

        // Clean up missing rooms
        if (!room) {
          await kv.srem("rooms:index", code);
          continue;
        }

        const idleMs = now - room.lastActivity;
        const { phase, players } = room.state;

        // Remove empty or closed rooms
        if (phase === "closed" || players.length === 0) {
          await deleteRoom(code);
          continue;
        }

        // Remove rooms idle more than 10 minutes
        if (idleMs > 10 * 60 * 1000) {
          await deleteRoom(code);
          continue;
        }

        // Remove finished/dead-end rooms idle more than 3 minutes
        if (["gameover", "rematch"].includes(phase) && idleMs > 3 * 60 * 1000) {
          await deleteRoom(code);
          continue;
        }

        // Only show lobby and active game rooms
        if (!["lobby", "countdown", "dropping", "buzzed", "result", "gameover", "rematch"].includes(phase)) {
          continue;
        }

        rooms.push({
          code,
          phase,
          players: players.map(p => ({ name: p.name, countryFlag: p.countryFlag, color: p.color })),
          playerCount: players.length,
          isFull: players.length >= 4,
          round: room.state.round,
          maxRounds: room.state.maxRounds,
          level: room.state.level,
          queue: (room.queue ?? []).map(q => ({ id: q.id, name: q.name })),
          idleSeconds: Math.floor(idleMs / 1000),
        });
      }

      // Sort: lobby first, then by most recently active
      rooms.sort((a, b) => {
        if (a.phase === "lobby" && b.phase !== "lobby") return -1;
        if (b.phase === "lobby" && a.phase !== "lobby") return 1;
        return a.idleSeconds - b.idleSeconds;
      });

      return NextResponse.json({ rooms });
    } catch (e) {
      return NextResponse.json({ rooms: [] });
    }
  }

  return NextResponse.json({ error: "Unknown" }, { status: 400 });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { action } = body;

  // ── create-room ─────────────────────────────────────────────────────────────
  if (action === "create-room") {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const room: RoomData = {
      wordBanks: {}, usedWords: [], lastActivity: Date.now(), queue: [],
      state: { ...INITIAL_STATE, roomCode: code, players: [makePlayer(body, 0, true)] },
    };
    await ensureWordsForLevel(room, 1);
    await saveRoom(code, room);
    return NextResponse.json({ code, state: room.state });
  }

  // ── join-room ────────────────────────────────────────────────────────────────
  if (action === "join-room") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (room.state.players.length >= 4) return NextResponse.json({ error: "Room is full" }, { status: 400 });
    if (room.state.phase !== "lobby") return NextResponse.json({ error: "Game in progress" }, { status: 400 });
    const idx = room.state.players.length;
    room.state.players.push(makePlayer(body, idx, false));
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state });
  }

  // ── leave ────────────────────────────────────────────────────────────────────
  if (action === "leave") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ ok: true });

    room.state.players = room.state.players.filter((p) => p.id !== body.playerId);

    if (room.state.players.length === 0) {
      await deleteRoom(body.roomCode);
      return NextResponse.json({ closed: true });
    }

    if (room.state.players.length === 1) {
      room.state.phase = "closed";
      room.state.players[0].isHost = true;
      room.lastActivity = Date.now();
      await saveRoom(body.roomCode, room);
      // Schedule cleanup — room is effectively dead
      setTimeout(() => deleteRoom(body.roomCode), 60 * 1000);
      return NextResponse.json({ state: room.state, closed: true });
    }

    // Reassign host if host left
    if (!room.state.players.find((p) => p.isHost)) {
      room.state.players[0].isHost = true;
    }

    // If game was in progress, end it
    if (!["lobby","gameover","rematch","closed"].includes(room.state.phase)) {
      room.state.phase = "gameover";
    }

    // Reindex colors
    room.state.players.forEach((p, i) => {
      p.color = PLAYER_COLORS[i];
      p.colorName = PLAYER_COLOR_NAMES[i];
    });

    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state });
  }

  // ── ok-results ───────────────────────────────────────────────────────────────
  if (action === "ok-results") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const player = room.state.players.find((p) => p.id === body.playerId);
    if (player) player.okResults = true;
    // Check if all players clicked OK
    const allOk = room.state.players.every((p) => p.okResults);
    if (allOk) room.state.phase = "rematch";
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state, allOk });
  }

  // ── vote-rematch ─────────────────────────────────────────────────────────────
  if (action === "vote-rematch") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const player = room.state.players.find((p) => p.id === body.playerId);
    if (player) player.readyForRematch = body.vote === true;

    const allReady = room.state.players.every((p) => p.readyForRematch);
    const anyDeclined = room.state.players.some((p) => p.readyForRematch === false && p.okResults);

    if (allReady && room.state.players.length >= 2) {
      // Everyone wants to play again — reset to lobby
      room.wordBanks = {}; room.usedWords = [];
      room.state.round = 0; room.state.level = 1; room.state.phase = "lobby";
      room.state.revealedLetters = []; room.state.buzzedPlayerId = null;
      room.state.lastResult = null; room.state.currentWord = "";
      room.state.players.forEach((p) => { p.score = 0; p.buzzed = false; p.muted = false; p.readyForRematch = false; p.okResults = false; });

      // Admit queued players (up to 4 total)
      const queue = room.queue ?? [];
      while (room.state.players.length < 4 && queue.length > 0) {
        const queued = queue.shift()!;
        const idx = room.state.players.length;
        room.state.players.push({
          id: queued.id, name: queued.name,
          color: PLAYER_COLORS[idx], colorName: PLAYER_COLOR_NAMES[idx],
          score: 0, buzzed: false, muted: false, isHost: false,
          countryFlag: queued.countryFlag, sound: queued.sound,
          readyForRematch: false, okResults: false,
        });
      }
      room.queue = queue;
      await ensureWordsForLevel(room, 1);
    }

    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state });
  }

  // ── force-rematch-screen ──────────────────────────────────────────────────────
  // Called by client after 30s timeout to move from gameover to rematch
  if (action === "force-rematch") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (room.state.phase === "gameover") {
      room.state.phase = "rematch";
      room.state.players.forEach((p) => { p.okResults = true; });
    }
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state });
  }

  // ── start-game ───────────────────────────────────────────────────────────────
  if (action === "start-game") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (room.state.players.length < 2) return NextResponse.json({ error: "Need at least 2 players" }, { status: 400 });
    await ensureWordsForLevel(room, 1);
    const word = pickWord(room, 1);
    room.state.players.forEach((p) => { p.score = 0; p.buzzed = false; p.muted = false; p.readyForRematch = false; p.okResults = false; });
    setupRound(room, 1, word);
    await saveRoom(body.roomCode, room);
    ensureWordsForLevel(room, 2).then(() => saveRoom(body.roomCode, room));
    return NextResponse.json({ state: room.state });
  }

  // ── drop-letter ──────────────────────────────────────────────────────────────
  if (action === "drop-letter") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (room.state.phase !== "dropping" && room.state.phase !== "countdown") {
      return NextResponse.json({ state: room.state, done: false });
    }
    const word = room.state.currentWord;
    const nextIdx = room.state.revealedLetters.length;
    if (room.state.phase === "countdown") room.state.phase = "dropping";
    if (nextIdx < word.length) {
      room.state.revealedLetters = [...room.state.revealedLetters, word[nextIdx]];
    }
    const done = room.state.revealedLetters.length >= word.length;
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state, done });
  }

  // ── buzz ─────────────────────────────────────────────────────────────────────
  if (action === "buzz") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (room.state.phase !== "dropping") return NextResponse.json({ error: "Cannot buzz now" }, { status: 400 });
    const player = room.state.players.find((p) => p.id === body.playerId);
    if (!player || player.muted) return NextResponse.json({ error: "Cannot buzz" }, { status: 400 });
    player.buzzed = true;
    room.state.phase = "buzzed";
    room.state.buzzedPlayerId = body.playerId;
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state });
  }

  // ── answer ───────────────────────────────────────────────────────────────────
  if (action === "answer") {
    const room = await getRoom(body.roomCode);
    if (!room || room.state.phase !== "buzzed") return NextResponse.json({ error: "Not buzzed" }, { status: 400 });
    const player = room.state.players.find((p) => p.id === body.playerId);
    if (!player || player.id !== room.state.buzzedPlayerId) return NextResponse.json({ error: "Not your turn" }, { status: 400 });
    const word = room.state.currentWord;
    const correct = body.answer.trim().toUpperCase() === word.toUpperCase();
    if (correct) {
      const bonus = Math.max(0, word.length - room.state.revealedLetters.length);
      const points = 5 + bonus;
      player.score += points;
      room.state.lastResult = { type: "correct", playerName: player.name, playerColor: player.color, word, points, bonus };
      room.state.phase = "result";
    } else {
      player.score = Math.max(0, player.score - 1);
      player.muted = true;
      player.buzzed = false;
      const canStillBuzz = room.state.players.filter((p) => !p.muted);
      if (canStillBuzz.length === 0) {
        room.state.lastResult = { type: "timeout", playerName: player.name, playerColor: player.color, word, message: `Nobody got it! The word was: ${word}` };
        room.state.phase = "result";
      } else {
        room.state.lastResult = { type: "wrong", playerName: player.name, playerColor: player.color, word, message: `${player.name} got it wrong! -1 pt. Others can buzz!` };
        room.state.buzzedPlayerId = null;
        room.state.phase = "dropping";
      }
    }
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state, correct, word });
  }

  // ── next-round ───────────────────────────────────────────────────────────────
  if (action === "next-round") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (room.state.round >= MAX_ROUNDS) {
      room.state.phase = "gameover";
      await saveRoom(body.roomCode, room);
      return NextResponse.json({ state: room.state });
    }
    const nextRound = room.state.round + 1;
    const level = getLevelForRound(nextRound);
    await ensureWordsForLevel(room, level);
    if (level < 4) ensureWordsForLevel(room, level + 1).then(() => saveRoom(body.roomCode, room));
    const word = pickWord(room, level);
    setupRound(room, nextRound, word);
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ state: room.state });
  }

  // ── queue-join ────────────────────────────────────────────────────────────────
  // Player wants to join after the current game finishes
  if (action === "queue-join") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (!room.queue) room.queue = [];
    // Don't add twice
    if (!room.queue.find(q => q.id === body.playerId)) {
      room.queue.push({ id: body.playerId, name: body.playerName, countryFlag: body.countryFlag ?? "🌍", sound: body.sound ?? "quack" });
    }
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ ok: true, position: room.queue.findIndex(q => q.id === body.playerId) + 1, queueLength: room.queue.length });
  }

  // ── queue-leave ───────────────────────────────────────────────────────────────
  if (action === "queue-leave") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ ok: true });
    room.queue = (room.queue ?? []).filter(q => q.id !== body.playerId);
    room.lastActivity = Date.now();
    await saveRoom(body.roomCode, room);
    return NextResponse.json({ ok: true });
  }

  // ── queue-status ──────────────────────────────────────────────────────────────
  if (action === "queue-status") {
    const room = await getRoom(body.roomCode);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const pos = (room.queue ?? []).findIndex(q => q.id === body.playerId);
    return NextResponse.json({ position: pos + 1, queueLength: (room.queue ?? []).length, phase: room.state.phase });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
