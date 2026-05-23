import Groq from "groq-sdk";

const FALLBACK: Record<number, string[]> = {
  3: ["CAT","DOG","SUN","RUN","FLY","BIG","HOT","CUP","JAM","MAP","GUN","ICE","OAK","PIG","ZAP"],
  4: ["JUMP","GLOW","FROG","CLAP","DUSK","MINT","PORK","TREK","VOLT","WINK","ZOOM","BLUR","CRISP","DAMP","FILM"],
  5: ["BLAZE","CRISP","FROST","GLOOM","HASTE","JOUST","KNACK","LEMON","MIRTH","NERVE","OXIDE","PLUME","QUIRK","RIVET","SWIFT"],
  6: ["BLIGHT","CHROME","DAGGER","FRENZY","GALLOP","HARBOR","IGNITE","JANGLE","KINDLE","LAVISH","MYSTIC","NOZZLE","OBLIQUE","PLUNGE","QUARTZ"],
};

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY ?? "" });
  return _groq;
}

export async function fetchWordBatchForLength(length: number): Promise<string[]> {
  try {
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        {
          role: "system",
          content: "You are a word game assistant. Return ONLY a JSON array of strings. No markdown, no explanation.",
        },
        {
          role: "user",
          content: `Generate 15 common English words that are EXACTLY ${length} letters long. Good for a party word game — recognizable but not too easy. No proper nouns, no offensive words. Return as JSON array only: ["WORD1","WORD2",...]`,
        },
      ],
      max_tokens: 200,
      temperature: 0.95,
    });
    const raw = completion.choices[0].message.content?.trim() ?? "[]";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Not array");
    return parsed
      .filter((w: unknown) => typeof w === "string" && w.length === length)
      .map((w: string) => w.toUpperCase());
  } catch (err) {
    console.error(`Groq error for length ${length}, using fallback:`, err);
    return [...(FALLBACK[length] ?? FALLBACK[4])];
  }
}
