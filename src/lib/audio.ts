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
