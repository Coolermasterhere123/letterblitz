// Sound system using:
// 1. Real audio files from Pixabay (free, no attribution required)
// 2. Web Speech API for voice shouts
// 3. Web Audio API fallback synth

export type SoundId =
  | "quack" | "airhorn" | "buzzer" | "ding"
  | "yeah" | "woohoo" | "lets_go" | "nice_one";

export const SOUNDS: { id: SoundId; label: string; emoji: string; description: string }[] = [
  { id: "quack",    label: "Quack",     emoji: "🦆", description: "Classic duck" },
  { id: "airhorn",  label: "Air Horn",  emoji: "📢", description: "Loud & proud" },
  { id: "buzzer",   label: "Buzzer",    emoji: "🔴", description: "Game show" },
  { id: "ding",     label: "Ding!",     emoji: "🔔", description: "Clean bell" },
  { id: "yeah",     label: "YEAH!",     emoji: "🙌", description: "Voice shout" },
  { id: "woohoo",   label: "WOO-HOO!",  emoji: "🎉", description: "Voice cheer" },
  { id: "lets_go",  label: "LET'S GO!", emoji: "🚀", description: "Voice hype" },
  { id: "nice_one", label: "NICE ONE!", emoji: "👊", description: "Voice praise" },
];

// Free real audio from Pixabay CDN (no attribution required)
const AUDIO_URLS: Partial<Record<SoundId, string>> = {
  quack:   "https://cdn.pixabay.com/audio/2021/08/09/audio_b2f6c69b95.mp3",
  airhorn: "https://cdn.pixabay.com/audio/2022/03/10/audio_8a5f7b5697.mp3",
  buzzer:  "https://cdn.pixabay.com/audio/2021/08/04/audio_c6ccf61c35.mp3",
  ding:    "https://cdn.pixabay.com/audio/2021/08/04/audio_0625c1539c.mp3",
};

// Voice shout config using Web Speech API
const VOICE_SHOUTS: Partial<Record<SoundId, string>> = {
  yeah:     "YEAH!",
  woohoo:   "WOO HOO!",
  lets_go:  "LET'S GO!",
  nice_one: "NICE ONE!",
};

// Pre-load audio cache
const audioCache: Record<string, HTMLAudioElement> = {};

function getAudio(url: string): HTMLAudioElement {
  if (!audioCache[url]) {
    const audio = new Audio(url);
    audio.preload = "auto";
    audioCache[url] = audio;
  }
  return audioCache[url];
}

// Preload all audio files on first call
export function preloadSounds() {
  if (typeof window === "undefined") return;
  Object.values(AUDIO_URLS).forEach(url => { if (url) getAudio(url); });
}

// Web Audio context for synth fallback
let _ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

export function playSound(id: SoundId) {
  if (typeof window === "undefined") return;

  // Try real audio file first
  const url = AUDIO_URLS[id];
  if (url) {
    try {
      const audio = getAudio(url);
      audio.currentTime = 0;
      audio.volume = 0.8;
      audio.play().catch(() => playSynthFallback(id));
      return;
    } catch {}
  }

  // Voice shout via Web Speech API
  const shout = VOICE_SHOUTS[id];
  if (shout && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(shout);
      utt.rate = 1.1;
      utt.pitch = 1.3;
      utt.volume = 1;
      // Pick an energetic voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        v.lang.startsWith("en") && (v.name.includes("Google") || v.name.includes("Samantha") || v.name.includes("Alex"))
      ) ?? voices.find(v => v.lang.startsWith("en"));
      if (preferred) utt.voice = preferred;
      window.speechSynthesis.speak(utt);
      return;
    } catch {}
  }

  // Synth fallback
  playSynthFallback(id);
}

function playSynthFallback(id: SoundId) {
  try {
    const c = getCtx();
    switch (id) {
      case "quack":   synthQuack(c); break;
      case "airhorn": synthAirhorn(c); break;
      case "buzzer":  synthBuzzer(c); break;
      case "ding":    synthDing(c); break;
      default:        synthBuzzer(c); break;
    }
  } catch {}
}

// ─── Synth fallbacks ──────────────────────────────────────────────────────────
function synthQuack(c: AudioContext) {
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(c.destination);
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(150, t + 0.15);
  osc.frequency.exponentialRampToValueAtTime(250, t + 0.25);
  gain.gain.setValueAtTime(0.4, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.start(t); osc.stop(t + 0.3);
}

function synthAirhorn(c: AudioContext) {
  const t = c.currentTime;
  [466, 587, 698].forEach(freq => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.start(t); osc.stop(t + 0.6);
  });
}

function synthBuzzer(c: AudioContext) {
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(c.destination);
  osc.type = "square";
  osc.frequency.setValueAtTime(120, t);
  gain.gain.setValueAtTime(0.4, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  osc.start(t); osc.stop(t + 0.4);
}

function synthDing(c: AudioContext) {
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(c.destination);
  osc.type = "sine";
  osc.frequency.setValueAtTime(1047, t);
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  osc.start(t); osc.stop(t + 0.8);
}
