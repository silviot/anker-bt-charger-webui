// FF09: the BLE protocol spoken by the Anker Prime 160W charger (A2687).
// No DOM and no Bluetooth here, so the same code runs in the browser and in `node test.mjs`.

export const SERVICE = "8c850001-0302-41c5-b46e-cf057c562025";
export const WRITE_CHAR = "8c850002-0302-41c5-b46e-cf057c562025";
export const NOTIFY_CHAR = "8c850003-0302-41c5-b46e-cf057c562025";
export const ADVERTISED_SERVICE = 0xff09;

export const INITIAL_KEY = "b8ff7422955d4eb6d554a2c470280559";
export const INITIAL_NONCE = "6ba3e3f2f3a60f2971ce5d1f";
export const AAD = "3322110077665544bbaa9988ffeeddcc";

export const FLAG_ENCRYPTED = 0x40;
export const FLAG_ACK = 0x08;
export const GROUP_SESSION = 0x01;
export const GROUP_TELEMETRY = 0x0f;

export const COMMANDS = {
  0x0001: "Hello",
  0x0003: "Parameters",
  0x0005: "Setup",
  0x0021: "Key exchange",
  0x0022: "Set time zone",
  0x0027: "Account ID",
  0x0029: "Identity",
  0x0200: "Status snapshot",
  0x020a: "Real-time request",
  0x0300: "Pushed telemetry",
};

export const hex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function unhex(text) {
  const clean = text.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("Hex text has an odd number of digits");
  return Uint8Array.from(clean.match(/../g) ?? [], (b) => parseInt(b, 16));
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const u32le = (v) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v >>> 0, true);
  return out;
};

export const epochBytes = (ms = Date.now()) => u32le(Math.floor(ms / 1000));

// ---- TLV ----

export function buildTlv(items) {
  return concat(
    ...items.map(([type, value]) => {
      if (value.length > 255) throw new Error(`TLV 0x${type.toString(16)} is too long`);
      return concat(Uint8Array.of(type, value.length), value);
    }),
  );
}

// A leading 0x00 is a status byte. Every TLV type is at least 0xA1, so skipping it is safe.
export const tlvOffset = (p) => (p.length && p[0] === 0 ? 1 : 0);

export function parseTlv(payload, offset = tlvOffset(payload)) {
  const out = [];
  let i = offset;
  while (i < payload.length - 1) {
    const n = payload[i + 1];
    if (i + 2 + n > payload.length) break;
    out.push({ type: payload[i], value: payload.slice(i + 2, i + 2 + n), at: i });
    i += 2 + n;
  }
  return out;
}

// ---- Frames ----
// FF 09 | length u16le | b4 b5 | group | cmd_hi+flags | cmd_lo | body | xor

export const checksum = (bytes) => bytes.reduce((x, b) => x ^ b, 0);

export function buildFrame(group, command, body, flags = FLAG_ENCRYPTED) {
  const head = Uint8Array.of(0xff, 0x09, 0, 0, 0x03, 0x00, group, (command >> 8) | flags, command & 0xff);
  const noSum = concat(head, body);
  const length = noSum.length + 1;
  noSum[2] = length & 0xff;
  noSum[3] = length >> 8;
  return concat(noSum, Uint8Array.of(checksum(noSum)));
}

export function parseFrame(raw) {
  if (raw.length < 10 || raw[0] !== 0xff || raw[1] !== 0x09) return null;
  const hi = raw[7];
  return {
    raw,
    declaredLength: raw[2] | (raw[3] << 8),
    group: raw[6],
    command: ((hi & ~(FLAG_ENCRYPTED | FLAG_ACK)) << 8) | raw[8],
    encrypted: !!(hi & FLAG_ENCRYPTED),
    ack: !!(hi & FLAG_ACK),
    body: raw.slice(9, -1),
    checksumOk: checksum(raw.slice(0, -1)) === raw[raw.length - 1],
  };
}

// BLE can split one frame across notifications, or join several into one.
export class Assembler {
  buf = new Uint8Array(0);
  feed(chunk) {
    this.buf = concat(this.buf, chunk);
    const frames = [];
    while (this.buf.length >= 4) {
      if (this.buf[0] !== 0xff || this.buf[1] !== 0x09) {
        this.buf = this.buf.slice(1);
        continue;
      }
      const n = this.buf[2] | (this.buf[3] << 8);
      if (n < 10 || n > 4096) {
        this.buf = this.buf.slice(1);
        continue;
      }
      if (this.buf.length < n) break;
      frames.push(this.buf.slice(0, n));
      this.buf = this.buf.slice(n);
    }
    return frames;
  }
}

// ---- Crypto ----
// AES-128-GCM with a fixed AAD. The firmware reuses one nonce for every frame.

export class Cipher {
  constructor() {
    this.useKey(unhex(INITIAL_KEY), unhex(INITIAL_NONCE));
    this.isSession = false;
  }
  useKey(key, nonce) {
    this.key = key;
    this.nonce = nonce;
    this.cryptoKey = crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  useSession(key, nonce) {
    this.useKey(key, nonce);
    this.isSession = true;
  }
  params() {
    return { name: "AES-GCM", iv: this.nonce, additionalData: unhex(AAD), tagLength: 128 };
  }
  async encrypt(plain) {
    return new Uint8Array(await crypto.subtle.encrypt(this.params(), await this.cryptoKey, plain));
  }
  async decrypt(ct) {
    return new Uint8Array(await crypto.subtle.decrypt(this.params(), await this.cryptoKey, ct));
  }
}

const P256 = { name: "ECDH", namedCurve: "P-256" };

export class Ecdh {
  static async create() {
    const e = new Ecdh();
    e.pair = await crypto.subtle.generateKey(P256, false, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", e.pair.publicKey));
    e.publicXY = raw.slice(1); // drop the 0x04 prefix
    return e;
  }
  // The session key and nonce are slices of the shared x coordinate. There is no KDF.
  async derive(deviceXY) {
    if (deviceXY.length !== 64) throw new Error("The device public key must be 64 bytes");
    const peer = await crypto.subtle.importKey("raw", concat(Uint8Array.of(4), deviceXY), P256, false, []);
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, this.pair.privateKey, 256),
    );
    return { shared, key: shared.slice(0, 16), nonce: shared.slice(16, 28) };
  }
}

// ---- Requests: the complete list of what this project sends ----

const SP = 0x20;

export const requests = {
  hello: (ts) => [GROUP_SESSION, 0x0001, buildTlv([[0xa1, ts]])],
  params: (ts) => [GROUP_SESSION, 0x0003, buildTlv([[0xa1, ts], [0xa3, Uint8Array.of(SP)], [0xa4, Uint8Array.of(0x00, 0xf0)]])],
  identity: (ts) => [GROUP_SESSION, 0x0029, buildTlv([[0xa1, ts]])],
  setup: (ts) => [
    GROUP_SESSION,
    0x0005,
    buildTlv([[0xa1, ts], [0xa3, Uint8Array.of(SP)], [0xa4, Uint8Array.of(0x29, 0x01)], [0xa5, Uint8Array.of(0x44)], [0xa6, Uint8Array.of(0x02)]]),
  ],
  keyExchange: (xy) => [GROUP_SESSION, 0x0021, buildTlv([[0xa1, xy]])],
  snapshot: (ts) => [GROUP_TELEMETRY, 0x0200, buildTlv([[0xa1, Uint8Array.of(0x21)], [0xfe, ts]])],
};

// ---- Decoding ----

const ascii = (b) => String.fromCharCode(...[...b].filter((c) => c >= 0x20 && c < 0x7f)).trim();

export function decodeIdentity(plain) {
  const offset = plain[0] === 3 && plain[1] === 0 ? 6 : tlvOffset(plain);
  const id = {};
  for (const { type, value } of parseTlv(plain, offset)) {
    const text = ascii(value);
    if (type === 0xa3 && /^[vV]?\d+(\.\d+)+$/.test(text)) id.firmware = text;
    if (type === 0xa4 && /^[0-9A-Za-z_-]{10,30}$/.test(text)) id.serial = text;
    if (type === 0xa5 && value.length >= 6 && value[0] < 0x20) {
      id.mac = [...value.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
    }
  }
  return id;
}

const CABLE_CAPABILITY = { 0x00: "3A / 60W", 0x01: "5A / 100W", 0x02: "EPR / 240W" };
const FAST_CHARGE = { 0x01: "Apple PD", 0x02: "Samsung Fast", 0x03: "Samsung Super Fast" };
const PORT_TLV = { C1: 0xa5, C2: 0xa6, C3: 0xa7 };
const CABLE_TLV = { C1: 0xac, C2: 0xad, C3: 0xae };

export function decodePortStruct(value) {
  if (value.length < 8 || value[0] !== 0x04) return null;
  const v = new DataView(value.buffer, value.byteOffset, value.byteLength);
  return {
    mode: value[1],
    volts: v.getUint16(2, true) / 1000,
    amps: v.getUint16(4, true) / 1000,
    watts: v.getUint16(6, true) / 100,
  };
}

export function decodeCable(value) {
  if (value.length < 3 || value[0] !== 0x04) return null;
  const capability = value[value.length - 2];
  const protocol = value[value.length - 1];
  return { capability: CABLE_CAPABILITY[capability] ?? null, fastCharge: FAST_CHARGE[protocol] ?? null };
}

export function decodeSnapshot(plain) {
  const tlvs = new Map(parseTlv(plain).map((t) => [t.type, t.value]));
  const ports = {};
  for (const name of Object.keys(PORT_TLV)) {
    const value = tlvs.get(PORT_TLV[name]);
    if (!value) continue;
    const port = decodePortStruct(value);
    if (!port) continue;
    const cable = tlvs.get(CABLE_TLV[name]);
    ports[name] = { ...port, cable: cable ? decodeCable(cable) : null };
  }
  const brightness = tlvs.get(0xa9);
  return {
    ports,
    totalWatts: Object.values(ports).reduce((sum, p) => sum + (p.mode ? p.watts : 0), 0),
    brightness: brightness?.length === 2 ? brightness[1] : null,
  };
}

// Plain-language names for the fields of a decoded frame.
export function describeTlv(command, type, value) {
  if (command === 0x0021 && type === 0xa1 && value.length === 64) return "P-256 public key (X and Y)";
  if (command === 0x0200 || command === 0x020a || command === 0x0300) {
    const port = Object.keys(PORT_TLV).find((k) => PORT_TLV[k] === type);
    if (port) {
      const p = decodePortStruct(value);
      if (p) return `${port} telemetry: mode ${p.mode}, ${p.volts.toFixed(3)} V, ${p.amps.toFixed(3)} A, ${p.watts.toFixed(2)} W`;
    }
    const cable = Object.keys(CABLE_TLV).find((k) => CABLE_TLV[k] === type);
    if (cable) {
      const c = decodeCable(value);
      return `${cable} cable: ${c?.capability ?? "not reported"}${c?.fastCharge ? `, ${c.fastCharge}` : ""}`;
    }
    if (type === 0xa9 && value.length === 2) return `Screen brightness: ${value[1]}%`;
    if (type === 0xfe) return "Timestamp field";
    if (type === 0xa1 && value.length === 1) return "State code";
  }
  if (command === 0x0029) {
    const text = ascii(value);
    if (type === 0xa3 && text) return `Firmware: ${text}`;
    if (type === 0xa4 && text) return `Serial: ${text}`;
    if (type === 0xa5) return "Bluetooth address";
    if (type === 0xa2 && text) return `Label: ${text}`;
  }
  if (type === 0xa1 && value.length === 4) return "Unix time, u32 little-endian";
  return "Meaning not known";
}

// ---- Session: runs the handshake and polls, over any transport ----
// A transport has: write(bytes), onNotify(callback), disconnect().

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Session {
  constructor(transport, { onFrame = () => {}, onStep = () => {}, onKeys = () => {}, onIdentity = () => {}, onSnapshot = () => {} } = {}) {
    Object.assign(this, { transport, onFrame, onStep, onKeys, onIdentity, onSnapshot });
    this.cipher = new Cipher();
    this.assembler = new Assembler();
    this.waiters = new Map();
    this.rx = Promise.resolve();
    transport.onNotify((chunk) => {
      // Keep frames in order: decryption is async, and the key changes mid-stream.
      this.rx = this.rx.then(() => this.feed(chunk)).catch((e) => console.error(e));
    });
  }

  async feed(chunk) {
    for (const raw of this.assembler.feed(chunk)) {
      const frame = parseFrame(raw);
      if (!frame) continue;
      let plain = frame.body;
      let authOk = null;
      if (frame.encrypted) {
        try {
          plain = await this.cipher.decrypt(frame.body);
          authOk = true;
        } catch {
          plain = null;
          authOk = false;
        }
      }
      const key = this.cipher.isSession ? "session" : "initial";
      this.onFrame({ dir: "rx", frame, plain, authOk, key, at: Date.now() });
      const waiter = this.waiters.get(frame.command);
      if (waiter && plain) {
        this.waiters.delete(frame.command);
        waiter(plain);
      }
      // A push can arrive at any time, so telemetry is decoded here and not only on request.
      if (plain && (frame.command === 0x0200 || frame.command === 0x0300)) this.onSnapshot(decodeSnapshot(plain));
    }
  }

  async send([group, command, plain]) {
    const raw = buildFrame(group, command, await this.cipher.encrypt(plain));
    const key = this.cipher.isSession ? "session" : "initial";
    this.onFrame({ dir: "tx", frame: parseFrame(raw), plain, authOk: true, key, at: Date.now() });
    await this.transport.write(raw);
  }

  async request(req, timeoutMs = 6000) {
    const command = req[1];
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(command);
        reject(new Error(`No reply to command 0x${command.toString(16).padStart(4, "0")}`));
      }, timeoutMs);
      this.waiters.set(command, (plain) => {
        clearTimeout(timer);
        resolve(plain);
      });
    });
    await this.send(req);
    return reply;
  }

  async handshake() {
    await sleep(300); // Let notifications settle, as the official app does.
    const ts = epochBytes();
    this.onStep("hello");
    await this.request(requests.hello(ts));
    await sleep(100);
    this.onStep("params");
    await this.request(requests.params(ts));
    await sleep(100);
    this.onStep("identity");
    const identity = decodeIdentity(await this.request(requests.identity(ts)));
    this.identity = identity;
    this.onIdentity(identity);
    await sleep(100);
    this.onStep("setup");
    await this.request(requests.setup(epochBytes()));
    await sleep(100);

    this.onStep("keyExchange");
    const ecdh = await Ecdh.create();
    const reply = await this.request(requests.keyExchange(ecdh.publicXY));
    const devicePub = parseTlv(reply).find((t) => t.type === 0xa1 && t.value.length === 64)?.value;
    if (!devicePub) throw new Error("The key exchange reply has no public key");
    const { shared, key, nonce } = await ecdh.derive(devicePub);
    this.cipher.useSession(key, nonce);
    this.onKeys({ hostPublic: ecdh.publicXY, devicePublic: devicePub, shared, key, nonce });
    this.onStep("session");
    await sleep(120);
  }

  async snapshot(timeoutMs = 4000) {
    return decodeSnapshot(await this.request(requests.snapshot(epochBytes()), timeoutMs));
  }

  // Requests one snapshot per second until stopped. Three misses in a row end the session.
  async poll(intervalMs = 1000) {
    this.polling = true;
    let misses = 0;
    while (this.polling) {
      try {
        await this.snapshot();
        misses = 0;
      } catch (e) {
        if (!this.polling) return;
        if (++misses >= 3) throw e;
      }
      if (this.polling) await sleep(intervalMs);
    }
  }

  async stop() {
    this.polling = false;
    await this.transport.disconnect();
  }
}
