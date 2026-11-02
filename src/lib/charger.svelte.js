// The one connection to a charger, real or simulated, as reactive state for the views.

import * as ff from "./ff09.js";
import { SimulatedCharger } from "./simulator.js";

const HISTORY_MS = 120_000;
const KEEP_FIRST = 14; // The handshake stays visible during long sessions.
const KEEP_LAST = 80;
const REMEMBER = "chrgr-device";
const RECONNECT_DELAYS = [1500, 3000, 5000, 8000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const remember = (id) => {
  try {
    if (id) localStorage.setItem(REMEMBER, id);
    else localStorage.removeItem(REMEMBER);
  } catch {}
};
const remembered = () => {
  try {
    return localStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
};

function bluetoothTransport(device, write, notify) {
  return {
    onNotify(cb) {
      notify.addEventListener("characteristicvaluechanged", (e) => {
        const v = e.target.value;
        cb(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
      });
    },
    write: (bytes) => write.writeValueWithoutResponse(bytes),
    disconnect: async () => device.gatt.connected && device.gatt.disconnect(),
  };
}

class Charger {
  state = $state("idle"); // idle, connecting, live
  statusText = $state("Not connected");
  notice = $state("");
  identity = $state(null);
  snapshot = $state.raw(null);
  history = $state.raw([]);
  frames = $state.raw([]);
  step = $state(null);
  keys = $state.raw(null);
  errorReport = $state(null);
  sim = $state.raw(null);
  session = null;
  #device = null;
  #wanted = false;

  get connected() {
    return this.state === "live";
  }

  get isSim() {
    return !!this.sim;
  }

  reset() {
    this.notice = "";
    this.identity = null;
    this.snapshot = null;
    this.history = [];
    this.frames = [];
    this.step = null;
    this.keys = null;
    this.errorReport = null;
  }

  // Quiet runs are automatic ones: a failure there does not show an error.
  async #run(open, { label = "Connecting…", quiet = false, onLive = () => {}, onFail = () => {} } = {}) {
    this.reset();
    this.state = "connecting";
    this.statusText = label;
    let session = null;
    try {
      const { transport, start } = await open();
      session = this.session = new ff.Session(transport, {
        onFrame: (f) => this.#addFrame(f),
        onStep: (s) => (this.step = s),
        onKeys: (k) => (this.keys = k),
        onIdentity: (i) => (this.identity = i),
        onSnapshot: (s) => this.#addSnapshot(s),
        onError: (plain) => (this.errorReport = ff.hex(plain)),
      });
      await start();
      this.statusText = "Setting up a secure session…";
      await session.handshake();
      if (this.session !== session) throw new Error("The connection was lost");
      this.state = "live";
      this.statusText = "Connected";
      if (this.#device) remember(this.#device.id);
      onLive();
      await session.poll();
    } catch (e) {
      onFail();
      // A newer attempt already took over, so this old one has nothing to clean up.
      if (session && this.session !== session) return;
      // The person closed the device chooser. This is not an error.
      if (e.name === "NotFoundError") {
        this.#ended("Not connected");
        return;
      }
      this.#ended("Not connected");
      await session?.stop().catch(() => {});
      if (!quiet) this.notice = e.message;
    }
  }

  // Connecting over BlueZ often fails once and then works, so a failure gets more tries.
  async #open(device, tries) {
    let lastError;
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(1000 * i);
      if (!this.#wanted) throw new DOMException("Stopped", "NotFoundError");
      try {
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(ff.SERVICE);
        const write = await service.getCharacteristic(ff.WRITE_CHAR);
        const notify = await service.getCharacteristic(ff.NOTIFY_CHAR);
        // Start listening before any request goes out.
        return { transport: bluetoothTransport(device, write, notify), start: () => notify.startNotifications() };
      } catch (e) {
        lastError = e;
      }
    }
    throw new Error(`Couldn't connect to the charger (${lastError.message}). Check that nothing else is connected to it, then try again.`);
  }

  #useDevice(device) {
    if (this.#device !== device) device.addEventListener("gattserverdisconnected", () => this.#linkLost(device));
    this.#device = device;
    this.#wanted = true;
  }

  // The link dropped without anyone asking. The charger does this after a picture upload.
  async #linkLost(device) {
    if (device !== this.#device || !this.session) return;
    this.#ended("The charger disconnected");
    for (const delay of RECONNECT_DELAYS) {
      this.state = "connecting";
      this.statusText = "Reconnecting…";
      await sleep(delay);
      if (!this.#wanted || device !== this.#device) return;
      const live = await new Promise((resolve) => {
        this.#run(() => this.#open(device, 1), { label: "Reconnecting…", quiet: true, onLive: () => resolve(true), onFail: () => resolve(false) });
      });
      if (live) return;
    }
    if (!this.#wanted) return;
    this.#ended("Not connected");
    this.notice = "The charger disconnected, and reconnecting failed. Click Connect to try again.";
  }

  // Reconnects on page load to the charger used last time, with no chooser. This needs
  // navigator.bluetooth.getDevices(), which Chrome may keep behind a flag.
  async resume() {
    const id = remembered();
    if (!id || this.state !== "idle" || !navigator.bluetooth?.getDevices) return;
    const device = (await navigator.bluetooth.getDevices().catch(() => [])).find((d) => d.id === id);
    if (!device || this.state !== "idle") return;
    this.#useDevice(device);
    await this.#run(() => this.#open(device, 2), { label: "Reconnecting…", quiet: true });
  }

  #ended(text) {
    if (this.session) this.session.polling = false;
    this.session = null;
    this.sim = null;
    this.state = "idle";
    this.statusText = text;
  }

  connectBluetooth() {
    return this.#run(async () => {
      if (!navigator.bluetooth) {
        throw new Error("This browser has no Web Bluetooth. Use Chrome or Edge on a desktop computer. The Help page has more.");
      }
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [ff.ADVERTISED_SERVICE] }],
        optionalServices: [ff.SERVICE],
      });
      this.#useDevice(device);
      return this.#open(device, 4);
    });
  }

  connectSimulator() {
    return this.#run(async () => {
      this.#wanted = false;
      this.#device = null;
      const sim = new SimulatedCharger();
      this.sim = sim;
      return { transport: sim, start: async () => {} };
    });
  }

  async disconnect() {
    const s = this.session;
    const device = this.#device;
    // Choosing to disconnect also means not reconnecting on the next visit.
    this.#wanted = false;
    this.#device = null;
    remember(null);
    this.#ended("Not connected");
    await s?.stop();
    if (device?.gatt.connected) device.gatt.disconnect();
  }

  #addFrame(entry) {
    const next = [...this.frames, entry];
    if (next.length > KEEP_FIRST + KEEP_LAST) next.splice(KEEP_FIRST, 1);
    this.frames = next;
  }

  #addSnapshot(snapshot) {
    this.snapshot = snapshot;
    const now = Date.now();
    const watts = ff.PORTS.map((n) => (snapshot.ports[n]?.mode ? snapshot.ports[n].watts : 0));
    this.history = [...this.history.filter((h) => h.t >= now - HISTORY_MS), { t: now, watts }];
  }

  // Sends a write, then watches snapshots until `confirmed` is true.
  // Returns "confirmed", "unconfirmed" (accepted, but no visible change) or "refused".
  // An accepted write alone proves little, so only a changed reading counts as success.
  async apply(request, confirmed = null) {
    if (!this.session) throw new Error("Not connected");
    let result;
    try {
      result = await this.session.write(request);
    } catch {
      return "no-reply";
    }
    if (result !== 0) return "refused";
    if (!confirmed) return "unconfirmed";
    for (let i = 0; i < 4; i++) {
      await sleep(600);
      const snap = await this.session?.snapshot().catch(() => null);
      if (snap && confirmed(snap)) return "confirmed";
    }
    return "unconfirmed";
  }
}

export const charger = new Charger();

export const OUTCOME = {
  confirmed: "Done. The charger reports the new value.",
  unconfirmed: "The charger accepted this, but it does not report this setting, so I can't confirm the change.",
  refused: "The charger refused this.",
  "no-reply": "The charger did not reply. This firmware may not have this feature.",
};
