"use client";

/**
 * nearby.ts — JS bridge for the NearbySync Android plugin.
 *
 * Real device-to-device note transfer with NO internet (Google Nearby
 * Connections = Bluetooth + Wi-Fi Direct, same engine as Nearby Share).
 *
 * Security (owner's requirement): notes are only exchanged after BOTH phones
 * prove they belong to the same couple — the first payload carries the pair
 * key (derived from both invite codes); a mismatched phone gets dropped and
 * the session ends. Nothing is ever sent to a foreign device.
 *
 * Every function no-ops safely on the web preview (returns false / null).
 */

import { isNative } from "./native";

type AnyRec = Record<string, any>;

type EvHandlers = Record<string, Set<(data: AnyRec) => void>>;

const handlers: EvHandlers = {};
let wired = false;

function plug(): AnyRec | null {
  try {
    return (window as AnyRec)?.Capacitor?.Plugins?.NearbySync ?? null;
  } catch {
    return null;
  }
}

/** Nearby sync is available only inside the APK with the plugin registered. */
export function nearbyAvailable(): boolean {
  return isNative() && Boolean(plug());
}

async function wire() {
  if (wired) return;
  const p = plug();
  if (!p) return;
  wired = true;
  const events = [
    "advertisingStarted",
    "discoveryStarted",
    "endpointFound",
    "endpointLost",
    "connectionInitiated",
    "connected",
    "connectionFailed",
    "payloadReceived",
    "disconnected",
    "error",
  ];
  for (const ev of events) {
    try {
      await p.addListener(ev, (data: AnyRec) => {
        handlers[ev]?.forEach((cb) => cb(data || {}));
      });
    } catch {
      /* event not supported */
    }
  }
}

function on(ev: string, cb: (data: AnyRec) => void): () => void {
  if (!handlers[ev]) handlers[ev] = new Set();
  handlers[ev].add(cb);
  return () => handlers[ev]?.delete(cb);
}

/** Ask Android for the Bluetooth/location permissions Nearby needs. */
export async function nearbyRequestPermissions(): Promise<boolean> {
  const p = plug();
  if (!p) return false;
  try {
    const r = await p.ensurePermissions();
    return Boolean(r?.granted);
  } catch {
    return false;
  }
}

/** Make this phone visible to the partner ("Receive" side). */
export async function nearbyStartAdvertising(name: string): Promise<boolean> {
  await wire();
  const p = plug();
  if (!p) return false;
  try {
    await p.startAdvertising({ name });
    return true;
  } catch {
    return false;
  }
}

/** Scan for the partner's phone ("Send" side). */
export async function nearbyStartDiscovery(): Promise<boolean> {
  await wire();
  const p = plug();
  if (!p) return false;
  try {
    await p.startDiscovery();
    return true;
  } catch {
    return false;
  }
}

export async function nearbyConnect(endpointId: string, name: string): Promise<boolean> {
  const p = plug();
  if (!p) return false;
  try {
    await p.connect({ endpointId, name });
    return true;
  } catch {
    return false;
  }
}

export async function nearbySend(text: string): Promise<boolean> {
  const p = plug();
  if (!p) return false;
  try {
    await p.send({ text });
    return true;
  } catch {
    return false;
  }
}

export async function nearbyStopAll(): Promise<void> {
  const p = plug();
  if (!p) return;
  try {
    await p.stopAll();
  } catch {
    /* ignore */
  }
}

export const nearbyOn = {
  advertisingStarted: (cb: () => void) => on("advertisingStarted", cb),
  discoveryStarted: (cb: () => void) => on("discoveryStarted", cb),
  endpointFound: (cb: (endpointId: string, name: string) => void) =>
    on("endpointFound", (d) => cb(String(d.endpointId || ""), String(d.endpointName || ""))),
  endpointLost: (cb: (endpointId: string) => void) => on("endpointLost", (d) => cb(String(d.endpointId || ""))),
  connected: (cb: (endpointId: string) => void) => on("connected", (d) => cb(String(d.endpointId || ""))),
  connectionFailed: (cb: () => void) => on("connectionFailed", cb),
  disconnected: (cb: () => void) => on("disconnected", cb),
  error: (cb: (message: string) => void) => on("error", (d) => cb(String(d.message || ""))),
  /**
   * Every incoming payload (UTF-8 JSON). Returns a stop function.
   * The NearbySyncSession below handles parsing + pair verification.
   */
  payload: (cb: (text: string) => void) => on("payloadReceived", (d) => cb(String(d.text || ""))),
};

// ==================== High-level session ====================

export interface NearbySessionEvents {
  onState: (s: NearbySessionState) => void;
  onLog: (line: string) => void;
  onForeignDevice: () => void;
}

export type NearbySessionState =
  | "idle"
  | "advertising"
  | "discovering"
  | "connecting"
  | "exchanging"
  | "done"
  | "error";

/**
 * Runs one complete nearby exchange:
 *  1. this phone advertises AND scans at once (either side can be first)
 *  2. when the two phones see each other → connect (auto-accept both sides)
 *  3. connected → both send a hello {pairKey, device}
 *  4. pair verified → both send their pending/recent notes
 *  5. received notes go through the SAME merge engine (dedup + conflict)
 */
export class NearbySyncSession {
  private stops: (() => void)[] = [];
  private state: NearbySessionState = "idle";
  private pairKey: string;
  private deviceName: string;
  private ev: NearbySessionEvents;
  private helloSent = false;
  private notesSent = false;
  private gotHello = false;
  private foreign = false;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(pairKey: string, deviceName: string, ev: NearbySessionEvents) {
    this.pairKey = pairKey;
    this.deviceName = deviceName;
    this.ev = ev;
  }

  private setState(s: NearbySessionState) {
    this.state = s;
    this.ev.onState(s);
  }

  async start(): Promise<boolean> {
    if (!(await nearbyRequestPermissions())) {
      this.ev.onLog("bluetooth permission missing");
      this.setState("error");
      return false;
    }
    if (!nearbyAvailable()) {
      this.setState("error");
      return false;
    }

    this.stops.push(
      nearbyOn.endpointFound((endpointId) => {
        if (this.state === "discovering" || this.state === "advertising") {
          this.setState("connecting");
          void nearbyConnect(endpointId, this.deviceName);
        }
      })
    );
    this.stops.push(nearbyOn.connected(() => this.onConnected()));
    this.stops.push(nearbyOn.connectionFailed(() => this.ev.onLog("connection failed")));
    this.stops.push(nearbyOn.disconnected(() => this.finish()));
    this.stops.push(nearbyOn.payload((text) => this.onPayload(text)));
    this.stops.push(
      nearbyOn.error((m) => {
        this.ev.onLog(m);
        if (this.state !== "done") this.setState("error");
      })
    );

    const label = `OH·${this.deviceName.slice(0, 10)}`;
    const adv = await nearbyStartAdvertising(label);
    const disc = await nearbyStartDiscovery();
    if (!adv && !disc) {
      this.ev.onLog("nearby unavailable on this phone");
      this.setState("error");
      return false;
    }
    this.setState(adv ? "advertising" : "discovering");
    // hard timeout — never leave radios on forever
    this.timeout = setTimeout(() => {
      if (this.state !== "done") {
        this.ev.onLog("timeout");
        void this.stop();
        this.setState(this.gotHello ? "done" : "error");
      }
    }, 60000);
    return true;
  }

  private async onConnected() {
    this.setState("exchanging");
    this.helloSent = false;
    this.notesSent = false;
    await this.sendHello();
  }

  private async sendHello() {
    if (this.helloSent) return;
    this.helloSent = true;
    await nearbySend(JSON.stringify({ t: "hello", pair: this.pairKey, device: this.deviceName }));
  }

  private async sendNotes(sendFn: (notes: AnyRec[]) => Promise<void>) {
    if (this.notesSent) return;
    this.notesSent = true;
    await sendFn(this.pendingNotes);
    await nearbySend(JSON.stringify({ t: "end" }));
  }

  private pendingNotes: AnyRec[] = [];

  private async onPayload(text: string) {
    let msg: AnyRec;
    try {
      msg = JSON.parse(text) as AnyRec;
    } catch {
      return;
    }
    if (msg.t === "hello") {
      // SECURITY GATE — only the same couple's phones may exchange notes
      if (String(msg.pair || "") !== this.pairKey) {
        this.foreign = true;
        this.ev.onForeignDevice();
        void nearbyStopAll();
        this.setState("error");
        return;
      }
      this.gotHello = true;
      await this.sendHello();
      if (this.onSendNotes) await this.sendNotes(this.onSendNotes);
      return;
    }
    if (msg.t === "note" && msg.note) {
      if (!this.gotHello) return; // no notes before a verified hello
      this.received.push(msg.note as AnyRec);
      return;
    }
    if (msg.t === "end") {
      if (this.received.length && this.onReceiveNotes) {
        this.onReceiveNotes(this.received);
      }
      this.received = [];
      // give the payload queue a beat, then wrap up
      setTimeout(() => {
        this.finish();
        this.setState("done");
      }, 600);
    }
  }

  private received: AnyRec[] = [];
  onSendNotes: ((notes: AnyRec[]) => Promise<void>) | null = null;
  onReceiveNotes: ((notes: AnyRec[]) => void) | null = null;

  private finish() {
    if (this.timeout) clearTimeout(this.timeout);
    this.stops.forEach((fn) => fn());
    this.stops = [];
    void nearbyStopAll();
  }

  async stop() {
    this.finish();
    if (this.state !== "done") this.setState("idle");
  }
}
