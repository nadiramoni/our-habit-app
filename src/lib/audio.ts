"use client";

// Alarm sound engine — synthesized music alarm using Web Audio API.
// No audio files needed: works offline, tiny, and loops until dismissed.

let ctx: AudioContext | null = null;
let loopTimer: ReturnType<typeof setInterval> | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// gentle pentatonic melody (frequency in Hz), pleasant like a music box
const MELODY: [number, number][] = [
  [523.25, 0.28], // C5
  [659.25, 0.28], // E5
  [783.99, 0.34], // G5
  [659.25, 0.28], // E5
  [880.0, 0.34], // A5
  [783.99, 0.28], // G5
  [659.25, 0.4], // E5
  [587.33, 0.5], // D5
];

function playSequence(ac: AudioContext) {
  const now = ac.currentTime + 0.05;
  let t = now;
  const master = ac.createGain();
  master.gain.value = 0.22;
  master.connect(ac.destination);
  for (const [freq, dur] of MELODY) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // soft attack + release = bell-like tone
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    t += dur;
  }
  return t - now;
}

/** Start the looping alarm music. Returns stop function. */
export function startAlarmMusic(): () => void {
  stopAlarmMusic();
  const ac = ensureCtx();
  if (!ac) return () => undefined;
  const tick = () => playSequence(ac);
  tick();
  // melody ~2.7s; loop with a small gap
  loopTimer = setInterval(tick, 3200);
  return stopAlarmMusic;
}

export function stopAlarmMusic() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}

/** Short single chime for non-alarm notifications (water, ayat). */
export function playChime() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const now = ac.currentTime + 0.02;
    const master = ac.createGain();
    master.gain.value = 0.18;
    master.connect(ac.destination);
    for (const [i, freq] of [880, 1174.66].entries()) {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.12);
      g.gain.linearRampToValueAtTime(1, now + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.35);
      osc.connect(g);
      g.connect(master);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.4);
    }
  } catch {
    /* ignore */
  }
}

/** Pre-warm audio on first user gesture (browsers block audio before interaction). */
export function warmAudio() {
  ensureCtx();
}

// ==================== UI interaction sounds (owner round-4) ====================
// Every tap in the app gets its own tiny synthesized voice: prayer ticks climb
// a musical scale, water +/− bubble up/down, the tasbih bead clicks — all
// Web Audio (no files), so it works offline inside the WebView.

function blip(
  ac: AudioContext,
  at: number,
  f0: number,
  f1: number,
  dur: number,
  vol = 0.16,
  type: OscillatorType = "sine"
) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.03);
}

/** soft generic tap click */
export function playTap() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    blip(ac, ac.currentTime + 0.01, 720, 640, 0.07, 0.1, "triangle");
  } catch {
    /* ignore */
  }
}

// pentatonic ladder — consecutive ticks climb the scale like little music notes
const SCALE = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5];

/** tick tick tick — each completed item plays the next note of the scale */
export function playTick(count = 1) {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const f = SCALE[Math.max(0, Math.abs(count)) % SCALE.length];
    blip(ac, ac.currentTime + 0.01, f, f, 0.18, 0.18, "sine");
    blip(ac, ac.currentTime + 0.01, f * 2, f * 2, 0.1, 0.06, "sine");
  } catch {
    /* ignore */
  }
}

/** water + glass — bubbly upward chirp */
export function playAdd() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    blip(ac, ac.currentTime + 0.01, 500, 940, 0.14, 0.16, "sine");
  } catch {
    /* ignore */
  }
}

/** water − glass — downward blip */
export function playMinus() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    blip(ac, ac.currentTime + 0.01, 620, 300, 0.16, 0.14, "sine");
  } catch {
    /* ignore */
  }
}

/** all prayers / goal complete — tiny celebration fanfare */
export function playFanfare() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + 0.01;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(ac, t0 + i * 0.12, f, f, 0.24, 0.18, "sine"));
  } catch {
    /* ignore */
  }
}

/** timer START — clear two-note "we've begun" signal (meditation / focus) */
export function playStart() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + 0.01;
    blip(ac, t0, 440, 440, 0.16, 0.2, "sine");
    blip(ac, t0 + 0.14, 660, 660, 0.22, 0.2, "sine");
  } catch {
    /* ignore */
  }
}
