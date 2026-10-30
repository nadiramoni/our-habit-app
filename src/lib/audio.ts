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
  unlockMedia();
}

// ==================== v2.6: REAL audio files (meal music + adhan) ====================
// The owner's own files play in-app — meals randomly pick one of the 2 tracks
// (একটার পর একটা), adhan plays the real recording. HTMLMediaElement unlock
// trick: on the first user gesture we play+pause each element at volume 0 so
// later programmatic play() calls are allowed by the WebView.

const MEDIA_FILES = [
  "/meal-alarm.mp3",
  "/meal-music1.mp3",
  "/adhan.mp3",
  "/azan2.mp3", // v2.8: the 4 extra azan tracks (picker: আজানের ধ্বনি)
  "/azan3.mp3",
  "/azan4.mp3",
  "/azan5.mp3",
  "/water-alarm.mp3",
];
const mediaEls: HTMLAudioElement[] = [];
let mediaUnlocked = false;

function ensureMediaEls(): HTMLAudioElement[] {
  if (typeof window === "undefined") return [];
  if (!mediaEls.length) {
    for (const f of MEDIA_FILES) {
      try {
        const a = new Audio(f);
        a.preload = "auto";
        mediaEls.push(a);
      } catch {
        /* ignore */
      }
    }
  }
  return mediaEls;
}

function unlockMedia() {
  if (mediaUnlocked) return;
  mediaUnlocked = true;
  for (const a of ensureMediaEls()) {
    try {
      a.volume = 0;
      const p = a.play();
      if (p && typeof p.then === "function") p.then(() => { a.pause(); a.currentTime = 0; a.volume = 1; }).catch(() => { a.volume = 1; });
      else a.volume = 1;
    } catch {
      try { a.volume = 1; } catch { /* ignore */ }
    }
  }
}

/** Start the owner's REAL meal music — a RANDOM track of the two, looping. Returns stop. */
export function startMealMusic(): () => void {
  stopMedia();
  const tracks = ["/meal-alarm.mp3", "/meal-music1.mp3"];
  const pick = tracks[Math.floor(Math.random() * tracks.length)];
  const el = ensureMediaEls().find((a) => a.src.endsWith(pick));
  if (!el) return startAlarmMusic(); // no media support → synthesized fallback
  try {
    el.loop = true;
    el.volume = 1;
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        // autoplay still blocked (no gesture yet) → synthesized fallback
        el.loop = false;
        startAlarmMusic();
      });
    }
    return () => {
      try { el.pause(); el.currentTime = 0; el.loop = false; } catch { /* ignore */ }
    };
  } catch {
    return startAlarmMusic();
  }
}

/** v2.8: Play the CHOSEN azan recitation (settings.azanSound) — loops
 *  until dismissed so a long adhan keeps going. Falls back to the default
 *  recording, then to the synthesized music box. Returns stop. */
export function startAzan(soundFile: string): () => void {
  stopMedia();
  const file = soundFile && MEDIA_FILES.some((f) => f === `/${soundFile}`) ? `/${soundFile}` : "/adhan.mp3";
  const el = ensureMediaEls().find((a) => a.src.endsWith(file));
  if (!el) return startAlarmMusic();
  try {
    el.loop = true; // keep the azan going until the user stops it
    el.volume = 1;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => startAlarmMusic());
    return () => {
      try { el.pause(); el.currentTime = 0; el.loop = false; } catch { /* ignore */ }
    };
  } catch {
    return startAlarmMusic();
  }
}

/** Play the REAL adhan recording once (in-app azan overlay). Returns stop. */
export function startAdhan(): () => void {
  stopMedia();
  const el = ensureMediaEls().find((a) => a.src.endsWith("/adhan.mp3"));
  if (!el) return startAlarmMusic();
  try {
    el.loop = false;
    el.volume = 1;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => startAlarmMusic());
    return () => {
      try { el.pause(); el.currentTime = 0; } catch { /* ignore */ }
    };
  } catch {
    return startAlarmMusic();
  }
}

/** v2.8: short PREVIEW of an azan track (the picker's ▶ button) — 8 seconds. */
export function previewSound(soundFile: string, seconds = 8): () => void {
  stopMedia();
  const file = soundFile.startsWith("/") ? soundFile : `/${soundFile}`;
  let el = ensureMediaEls().find((a) => a.src.endsWith(file));
  if (!el) {
    try {
      el = new Audio(file);
      el.preload = "auto";
      mediaEls.push(el);
    } catch {
      return () => undefined;
    }
  }
  const stopAt = () => {
    try { el?.pause(); if (el) el.currentTime = 0; } catch { /* ignore */ }
  };
  try {
    el.volume = 1;
    const p = el.play();
    if (p && typeof p.catch === "function") p.catch(() => undefined);
    setTimeout(stopAt, seconds * 1000);
    return stopAt;
  } catch {
    return () => undefined;
  }
}

function stopMedia() {
  for (const a of ensureMediaEls()) {
    try { a.pause(); a.currentTime = 0; } catch { /* ignore */ }
  }
}

// ==================== v2.6: loud alarm-ON confirmation ====================
// The owner: "যেকোনো ফাংশন অন করলে ঐটা যাতে সাউন্ড করে" — a clear, louder
// two-voice success jingle (played together with the native confirmation
// notification, so it's audible through BOTH the media and the notification
// volume streams).

export function playAlarmOn() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + 0.01;
    // melody voice — rising major arpeggio
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      blip(ac, t0 + i * 0.11, f, f, 0.3, 0.34, "sine");
    });
    // sparkle voice — octave doubles, slightly delayed
    [1046.5, 1318.5, 1568.0, 2093.0].forEach((f, i) => {
      blip(ac, t0 + 0.05 + i * 0.11, f, f, 0.2, 0.1, "sine");
    });
    // final chord
    [523.25, 659.25, 783.99].forEach((f) => {
      blip(ac, t0 + 0.5, f, f, 0.5, 0.16, "sine");
    });
  } catch {
    /* ignore */
  }
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

// ==================== v4.3: messenger-style chat POP ====================
// Owner round-18: "মেসেঞ্জারে দেখো না টুট করে একটা পপ আপ এসে মেসেজটা সিন হয়"
// — a short bright two-tone "toot" that plays with the heads-up popup when a
// chat message arrives while the app is open. Distinct from every alarm.
export function playChatPop() {
  const ac = ensureCtx();
  if (!ac) return;
  try {
    const t0 = ac.currentTime + 0.01;
    // "টুট" — high ping then a quick higher answer, messenger-like
    blip(ac, t0, 987.77, 987.77, 0.09, 0.3, "sine");
    blip(ac, t0 + 0.1, 1318.51, 1318.51, 0.16, 0.3, "sine");
    // soft harmonic underneath so it carries on phone speakers
    blip(ac, t0, 493.88, 493.88, 0.12, 0.12, "triangle");
  } catch {
    /* ignore */
  }
}
