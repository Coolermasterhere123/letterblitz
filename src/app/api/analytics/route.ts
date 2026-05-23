import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const dynamic = "force-dynamic";

// Secret key to protect the analytics endpoint
const ANALYTICS_SECRET = process.env.ANALYTICS_SECRET ?? "letterblitz-dev";

export type PlayerRecord = {
  name: string;
  country: string;
  countryFlag: string;
  sound: string;
  firstSeen: string;
  lastSeen: string;
  gamesPlayed: number;
  totalScore: number;
};

// Called when a player signs in
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, playerId, name, country, countryFlag, sound, score } = body;

    if (action === "register") {
      const key = `player:${playerId}`;
      const existing = await kv.get<PlayerRecord>(key);
      const now = new Date().toISOString();

      const record: PlayerRecord = {
        name,
        country,
        countryFlag,
        sound,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
        gamesPlayed: (existing?.gamesPlayed ?? 0) + 1,
        totalScore: (existing?.totalScore ?? 0) + (score ?? 0),
      };

      await kv.set(key, record, { ex: 60 * 60 * 24 * 90 }); // keep 90 days

      // Add to global player index
      await kv.sadd("players:index", playerId);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Developer dashboard — protected by secret
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (secret !== ANALYTICS_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const playerIds = await kv.smembers<string[]>("players:index");
    if (!playerIds || playerIds.length === 0) {
      return NextResponse.json({ players: [], total: 0 });
    }

    const players: PlayerRecord[] = [];
    for (const id of playerIds) {
      const p = await kv.get<PlayerRecord>(`player:${id}`);
      if (p) players.push({ ...p, id } as any);
    }

    players.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

    return NextResponse.json({
      total: players.length,
      players,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
