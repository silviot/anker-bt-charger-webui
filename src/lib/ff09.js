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
  0x0202: "Set language",
  0x0203: "Set screen lock time",
  0x0204: "Set brightness",
  0x0205: "Set power allocation",
  0x0206: "Set charging mode",
  0x0207: "Port on or off",
  0x0209: "Port timer",
  0x020a: "Real-time request",
  0x020b: "Set screen direction",
  0x020c: "Port history",
  0x020d: "Set auto-rotate",
  0x020f: "Set device identification",
  0x021f: "Show picture",
  0x0220: "Start picture transfer",
  0x0221: "Picture chunk",
  0x0300: "Pushed telemetry",
  0x0301: "Error report",
};

export const CMD = {
  LANGUAGE: 0x0202, SCREEN_OFF: 0x0203, BRIGHTNESS: 0x0204, ALLOCATION: 0x0205, MODE: 0x0206,
  PORT_SWITCH: 0x0207, PORT_TIMER: 0x0209, DIRECTION: 0x020b, HISTORY: 0x020c, ROTATE: 0x020d,
  IDENTIFY: 0x020f, SHOW_PICTURE: 0x021f, PICTURE_START: 0x0220, PICTURE_CHUNK: 0x0221,
};

export const PORTS = ["C1", "C2", "C3"];

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

const u16le = (v) => Uint8Array.of(v & 0xff, (v >> 8) & 0xff);

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
// Values in group 0x0F carry a type byte: 01 u8, 02 u16, 03 u32, 04 raw bytes.

const SP = 0x20;
const ACTION = Uint8Array.of(0x21);
export const PICTURE_CHUNK = 156;
export const PICTURE_ACK_EVERY = 10;

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
  snapshot: (ts) => [GROUP_TELEMETRY, 0x0200, buildTlv([[0xa1, ACTION], [0xfe, ts]])],
  setting: (command, value, ts = epochBytes()) => [GROUP_TELEMETRY, command, buildTlv([[0xa1, ACTION], [0xa2, Uint8Array.of(1, value)], [0xfe, ts]])],
  portSwitch: (port, on, ts = epochBytes()) => [
    GROUP_TELEMETRY, CMD.PORT_SWITCH,
    buildTlv([[0xa1, ACTION], [0xa2, Uint8Array.of(1, PORTS.indexOf(port))], [0xa3, Uint8Array.of(1, on ? 1 : 0)], [0xfe, ts]]),
  ],
  portTimer: (port, seconds, ts = epochBytes()) => [
    GROUP_TELEMETRY, CMD.PORT_TIMER,
    buildTlv([[0xa1, ACTION], [0xa2, Uint8Array.of(1, PORTS.indexOf(port))], [0xa3, concat(Uint8Array.of(4), u32le(seconds))], [0xfe, ts]]),
  ],
  // The layout of A3 and A4 is an inference from the app, not a captured frame.
  customMode: ({ profile = 1, autoExit = false, watts, masks }, ts = epochBytes()) => [
    GROUP_TELEMETRY, CMD.MODE,
    buildTlv([
      [0xa1, ACTION],
      [0xa2, Uint8Array.of(1, 4)],
      [0xa3, Uint8Array.of(4, profile, autoExit ? 1 : 0, ...PORTS.map((p) => watts[p]))],
      [0xa4, Uint8Array.of(4, ...PORTS.flatMap((p) => [masks[p], 0, 0]))],
      [0xfe, ts],
    ]),
  ],
  showPicture: (id, crc, ts = epochBytes()) => [
    GROUP_TELEMETRY, CMD.SHOW_PICTURE,
    buildTlv([
      [0xa1, ACTION],
      [0xa3, Uint8Array.of(1, 3)],
      [0xa4, concat(Uint8Array.of(4), u32le(id))],
      [0xa5, concat(Uint8Array.of(4), u32le(crc))],
      [0xfd, concat(Uint8Array.of(0), new TextEncoder().encode("SmallChargingUrl"))],
      [0xfe, concat(Uint8Array.of(3), ts)],
    ]),
  ],
  pictureStart: (id, crc, size, count, ts = epochBytes()) => [
    GROUP_TELEMETRY, CMD.PICTURE_START,
    buildTlv([
      [0xa1, ACTION],
      [0xa2, Uint8Array.of(1, 1)],
      [0xa3, concat(Uint8Array.of(4), u32le(id))],
      [0xa4, concat(Uint8Array.of(4), u32le(crc))],
      [0xa5, concat(Uint8Array.of(3), u32le(size))],
      [0xa6, Uint8Array.of(1, PICTURE_ACK_EVERY)],
      [0xa7, concat(Uint8Array.of(2), u16le(PICTURE_CHUNK))],
      [0xa8, concat(Uint8Array.of(2), u16le(count))],
      [0xfe, concat(Uint8Array.of(3), ts)],
    ]),
  ],
  pictureChunk: (index, bytes) => {
    const payload = new Uint8Array(PICTURE_CHUNK + 1);
    payload[0] = 4;
    payload.set(bytes, 1);
    return [GROUP_TELEMETRY, CMD.PICTURE_CHUNK, buildTlv([[0xa1, ACTION], [0xa2, concat(Uint8Array.of(2), u16le(index))], [0xa3, payload]])];
  },
};

// The IEEE CRC-32 of the JPEG is the hash the charger stores with a picture.
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

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

// C1, C2 and C3 control: 04, switch, timer running, timer u32le, remaining u32le, cable, charging info.
export function decodeCable(value) {
  if (value.length < 3 || value[0] !== 0x04) return null;
  const capability = value[value.length - 2];
  const protocol = value[value.length - 1];
  const out = { capability: CABLE_CAPABILITY[capability] ?? null, fastCharge: FAST_CHARGE[protocol] ?? null };
  if (value.length === 13) {
    const v = new DataView(value.buffer, value.byteOffset, value.byteLength);
    out.on = value[1] === 1;
    out.timerRunning = value[2] === 1;
    out.timerSeconds = v.getUint32(3, true);
    out.timerRemaining = v.getUint32(7, true);
  }
  return out;
}

const VENDORS = { 0x05ac: "Apple", 0x291a: "Anker", 0x04e8: "Samsung", 0x18d1: "Google" };
const BRANDS = {
  1: "Apple", 2: "Samsung", 3: "Xiaomi", 4: "Huawei", 5: "Google", 6: "LG", 7: "IDT", 8: "TI", 9: "YBZ", 10: "Anker",
  11: "Honor", 12: "HP", 13: "Dell", 14: "Lenovo", 15: "Microsoft", 16: "ASUS", 17: "ASUS", 18: "MSI", 19: "Razer",
};

function decodeDevices(tlvs) {
  const out = {};
  const usb = tlvs.get(0xb4);
  const brand = tlvs.get(0xb5);
  PORTS.forEach((port, i) => {
    if (usb?.length >= 13) {
      const vid = usb[1 + i * 4] | (usb[2 + i * 4] << 8);
      if (VENDORS[vid]) out[port] = VENDORS[vid];
    }
    if (!out[port] && brand?.length >= 13 && BRANDS[brand[1 + i * 4]]) out[port] = BRANDS[brand[1 + i * 4]];
  });
  return out;
}

const typedU8 = (value) => (value?.length === 2 && value[0] === 1 ? value[1] : null);

export function decodeSnapshot(plain) {
  const tlvs = new Map(parseTlv(plain).map((t) => [t.type, t.value]));
  const ports = {};
  const devices = decodeDevices(tlvs);
  for (const name of Object.keys(PORT_TLV)) {
    const value = tlvs.get(PORT_TLV[name]);
    if (!value) continue;
    const port = decodePortStruct(value);
    if (!port) continue;
    const cable = tlvs.get(CABLE_TLV[name]);
    ports[name] = { ...port, cable: cable ? decodeCable(cable) : null, device: devices[name] ?? null };
  }
  const picture = tlvs.get(0xe1);
  return {
    ports,
    totalWatts: Object.values(ports).reduce((sum, p) => sum + (p.mode ? p.watts : 0), 0),
    screenOff: typedU8(tlvs.get(0xa8)),
    brightness: typedU8(tlvs.get(0xa9)),
    chargingMode: typedU8(tlvs.get(0xaa)),
    direction: typedU8(tlvs.get(0xaf)),
    language: typedU8(tlvs.get(0xb0)),
    autoRotate: typedU8(tlvs.get(0xb2)),
    // Only the low 16 bits of the picture id are reported. Older firmware has no such field.
    pictureId: picture?.length >= 5 ? picture[3] | (picture[4] << 8) : null,
  };
}

export const SCREEN_OFF = ["30 seconds", "1 minute", "5 minutes", "30 minutes", "12 hours"];
export const LANGUAGES = ["English", "Chinese", "Japanese", "German"];
export const DIRECTIONS = ["Up", "Left", "Down", "Right"];
export const MODES = { 0: "Smart", 1: "Standard", 4: "Custom" };

const SETTING_TLV = {
  0xa8: (v) => `Screen lock time: ${SCREEN_OFF[v] ?? v}`,
  0xa9: (v) => `Screen brightness: ${v}%`,
  0xaa: (v) => `Charging mode: ${MODES[v] ?? v}`,
  0xaf: (v) => `Screen direction: ${DIRECTIONS[v] ?? v}`,
  0xb0: (v) => `Language: ${LANGUAGES[v] ?? v}`,
  0xb2: (v) => `Auto-rotate: ${v ? "on" : "off"}`,
};

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
      const timer = c?.timerRunning ? `, timer ${c.timerRemaining} s left` : "";
      return `${cable} control: ${c?.on === false ? "switched off" : "on"}${timer}, cable ${c?.capability ?? "not reported"}${c?.fastCharge ? `, ${c.fastCharge}` : ""}`;
    }
    if (value.length === 2 && SETTING_TLV[type]) return SETTING_TLV[type](value[1]);
    if (type === 0xab) return "Custom mode settings (layout not fully known)";
    if (type === 0xb4) return "Attached devices: USB vendor and product IDs";
    if (type === 0xb5) return "Attached devices: brand and model codes";
    if (type === 0xe1 && value.length >= 5) return `Picture on screen: id ${value[3] | (value[4] << 8)}`;
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
  constructor(transport, { onFrame = () => {}, onStep = () => {}, onKeys = () => {}, onIdentity = () => {}, onSnapshot = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { transport, onFrame, onStep, onKeys, onIdentity, onSnapshot, onError });
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
      if (plain) {
        const waiting = this.waiters.get(frame.command);
        this.waiters.delete(frame.command);
        waiting?.forEach((resolve) => resolve(plain));
        if (frame.command === 0x0301) this.onError(plain);
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
      const done = (plain) => {
        clearTimeout(timer);
        resolve(plain);
      };
      const timer = setTimeout(() => {
        const left = (this.waiters.get(command) ?? []).filter((w) => w !== done);
        if (left.length) this.waiters.set(command, left);
        else this.waiters.delete(command);
        reject(new Error(`No reply to command 0x${command.toString(16).padStart(4, "0")}`));
      }, timeoutMs);
      this.waiters.set(command, [...(this.waiters.get(command) ?? []), done]);
    });
    await this.send(req);
    return reply;
  }

  // All five steps are needed: on the test unit, shorter sequences got no snapshot reply.
  // Waits between steps weren't needed there either, and they cost about 0.7 s.
  async handshake() {
    const ts = epochBytes();
    this.onStep("hello");
    // Normally about 0.3 s. A link left over from an earlier session gets no reply at all.
    await this.request(requests.hello(ts), 2500);
    this.onStep("params");
    await this.request(requests.params(ts));
    this.onStep("identity");
    const identity = decodeIdentity(await this.request(requests.identity(ts)));
    this.identity = identity;
    this.onIdentity(identity);
    this.onStep("setup");
    await this.request(requests.setup(epochBytes()));

    this.onStep("keyExchange");
    const ecdh = await Ecdh.create();
    const reply = await this.request(requests.keyExchange(ecdh.publicXY));
    const devicePub = parseTlv(reply).find((t) => t.type === 0xa1 && t.value.length === 64)?.value;
    if (!devicePub) throw new Error("The key exchange reply has no public key");
    const { shared, key, nonce } = await ecdh.derive(devicePub);
    this.cipher.useSession(key, nonce);
    this.onKeys({ hostPublic: ecdh.publicXY, devicePublic: devicePub, shared, key, nonce });
    this.onStep("session");
  }

  // The first byte of a write reply is its result. 00 means the charger took it, which does
  // not prove that anything changed: callers should confirm against the next snapshot.
  async write(req, timeoutMs = 4000) {
    return (await this.request(req, timeoutMs))[0] ?? null;
  }

  // Sends a JPEG in chunks. The charger acks every tenth chunk and the last, and it answers 0x12
  // if chunks arrive without waiting for those acks.
  async sendPicture(id, crc, jpeg, onProgress = () => {}) {
    const count = Math.ceil(jpeg.length / PICTURE_CHUNK);
    // No polling during a transfer: the official sequence sends only picture commands.
    this.paused = true;
    try {
      await sleep(300);
      await this.#sendChunks(id, crc, jpeg, count, onProgress);
    } finally {
      this.paused = false;
    }
  }

  async #sendChunks(id, crc, jpeg, count, onProgress) {
    const started = await this.write(requests.pictureStart(id, crc, jpeg.length, count));
    if (started !== 0) throw new Error(`The charger refused the transfer (code 0x${started.toString(16)})`);
    await sleep(200);
    for (let i = 0; i < count; i++) {
      const req = requests.pictureChunk(i, jpeg.subarray(i * PICTURE_CHUNK, (i + 1) * PICTURE_CHUNK));
      const last = i === count - 1;
      if (last || (i + 1) % PICTURE_ACK_EVERY === 0) {
        // The charger writes to flash before the last ack, which took 3.6 s in one report.
        const result = await this.write(req, last ? 10000 : 5000);
        if (result !== 0 && result !== 0x10) throw new Error(`The charger stopped the transfer (code 0x${result.toString(16)})`);
      } else {
        await this.send(req);
        await sleep(40);
      }
      onProgress(i + 1, count);
    }
    await sleep(400);
  }

  async snapshot(timeoutMs = 4000) {
    return decodeSnapshot(await this.request(requests.snapshot(epochBytes()), timeoutMs));
  }

  // Requests one snapshot per second until stopped. Three misses in a row end the session.
  async poll(intervalMs = 1000) {
    this.polling = true;
    let misses = 0;
    while (this.polling) {
      if (this.paused) {
        await sleep(100);
        continue;
      }
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
