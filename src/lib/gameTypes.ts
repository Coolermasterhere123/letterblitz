export type Player = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  score: number;
  buzzed: boolean;
  muted: boolean;
  isHost: boolean;
  countryFlag: string;
  sound: string;
  readyForRematch: boolean; // true when player clicks "Play Again"
  okResults: boolean;       // true when player clicks "OK" on results
};

export type GamePhase =
  | "lobby"
  | "countdown"
  | "dropping"
  | "buzzed"
  | "result"
  | "gameover"
  | "rematch"   // waiting for play-again votes
  | "closed";   // room closed (not enough players)

export type GameState = {
  roomCode: string;
  phase: GamePhase;
  players: Player[];
  revealedLetters: string[];
  totalLetters: number;
  currentWord: string;
  round: number;
  maxRounds: number;
  level: number;
  buzzedPlayerId: string | null;
  lastResult: ResultEvent | null;
};

export type ResultEvent = {
  type: "correct" | "wrong" | "timeout";
  playerName?: string;
  playerColor?: string;
  word: string;
  points?: number;
  bonus?: number;
  message?: string;
};

export const PLAYER_COLORS = ["#FF3CAC", "#00F5FF", "#FFE03C", "#39FF14"] as const;
export const PLAYER_COLOR_NAMES = ["Pink", "Cyan", "Yellow", "Green"] as const;

export const ROUNDS_PER_LEVEL = 3;
export const MAX_LEVELS = 4;
export const MAX_ROUNDS = ROUNDS_PER_LEVEL * MAX_LEVELS;

export const LEVEL_WORD_LENGTH: Record<number, number> = { 1: 3, 2: 4, 3: 5, 4: 6 };
export const LEVEL_NAMES: Record<number, string> = {
  1: "LEVEL 1 — 3 LETTERS",
  2: "LEVEL 2 — 4 LETTERS",
  3: "LEVEL 3 — 5 LETTERS",
  4: "LEVEL 4 — 6 LETTERS",
};

export const INITIAL_STATE: GameState = {
  roomCode: "",
  phase: "lobby",
  players: [],
  revealedLetters: [],
  totalLetters: 0,
  currentWord: "",
  round: 0,
  maxRounds: MAX_ROUNDS,
  level: 1,
  buzzedPlayerId: null,
  lastResult: null,
};

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getLevelForRound(round: number): number {
  return Math.min(Math.ceil(round / ROUNDS_PER_LEVEL), MAX_LEVELS);
}

export type PlayerProfile = {
  name: string;
  country: string;
  countryFlag: string;
  sound: string;
};
