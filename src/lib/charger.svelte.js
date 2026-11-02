// The one connection to a charger, real or simulated, as reactive state for the views.

import * as ff from "./ff09.js";
import { SimulatedCharger } from "./simulator.js";

const HISTORY_MS = 120_000;
const KEEP_FIRST = 14; // The handshake stays visible during long sessions.
const KEEP_LAST = 80;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  async #run(open) {
    this.reset();
    this.state = "connecting";
    this.statusText = "Connecting…";
    try {
      const { transport, start } = await open();
      this.session = new ff.Session(transport, {
        onFrame: (f) => this.#addFrame(f),
        onStep: (s) => (this.step = s),
        onKeys: (k) => (this.keys = k),
        onIdentity: (i) => (this.identity = i),
        onSnapshot: (s) => this.#addSnapshot(s),
        onError: (plain) => (this.errorReport = ff.hex(plain)),
      });
      await start();
      this.statusText = "Setting up a secure session…";
      await this.session.handshake();
      this.state = "live";
      this.statusText = "Connected";
      await this.session.poll();
    } catch (e) {
      // The person closed the device chooser. This is not an error.
      if (e.name === "NotFoundError") {
        this.#ended("Not connected");
        return;
      }
      const s = this.session;
      this.#ended("Not connected");
      await s?.stop().catch(() => {});
      this.notice = e.message;
    }
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
      device.addEventListener("gattserverdisconnected", () => this.#ended("The charger disconnected"));
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(ff.SERVICE);
      const write = await service.getCharacteristic(ff.WRITE_CHAR);
      const notify = await service.getCharacteristic(ff.NOTIFY_CHAR);
      // Start listening before any request goes out.
      return { transport: bluetoothTransport(device, write, notify), start: () => notify.startNotifications() };
    });
  }

  connectSimulator() {
    return this.#run(async () => {
      const sim = new SimulatedCharger();
      this.sim = sim;
      return { transport: sim, start: async () => {} };
    });
  }

  async disconnect() {
    const s = this.session;
    this.#ended("Not connected");
    await s?.stop();
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
