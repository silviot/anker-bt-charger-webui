// A pretend charger that runs the real protocol, including the real handshake encryption.
// It implements the same transport interface as the Bluetooth connection, and it behaves as an
// A2687 on firmware v0.0.3.7 did when tested, apart from also reporting the picture on screen.

import {
  Assembler, buildFrame, buildTlv, Cipher, CMD, crc32, Ecdh, FLAG_ACK, FLAG_ENCRYPTED, parseFrame, parseTlv, PORTS,
} from "./ff09.js";

const text = (s) => new TextEncoder().encode(s);
const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const u8 = (v) => Uint8Array.of(1, v);
const readU32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

const portStruct = ({ plugged, volts, watts }, on) => {
  if (!plugged || !on || watts <= 0) return Uint8Array.of(0x04, 0, 0, 0, 0, 0, 0, 0);
  const jitter = watts * (0.97 + Math.random() * 0.06);
  const mv = Math.round(volts * 1000 * (0.995 + Math.random() * 0.01));
  const ma = Math.round((jitter / volts) * 1000);
  return Uint8Array.of(0x04, 1, ...u16(mv), ...u16(ma), ...u16(Math.round((mv * ma) / 10000)));
};

export class SimulatedCharger {
  // Each load is editable while the simulation runs.
  loads = {
    C1: { plugged: true, volts: 20, watts: 65, cable: 2, info: 1 },
    C2: { plugged: true, volts: 9, watts: 18, cable: 1, info: 0 },
    C3: { plugged: false, volts: 5, watts: 5, cable: 3, info: 0 },
  };
  control = Object.fromEntries(PORTS.map((p) => [p, { on: true, timer: false, seconds: 300, endsAt: 0 }]));
  settings = { screenOff: 1, brightness: 80, mode: 0, direction: 0, language: 0, autoRotate: 1 };
  pictures = new Map();
  pictureId = 1000;
  transfer = null;
  name = "SIMULATED-A2687";
  cipher = new Cipher();
  assembler = new Assembler();

  onNotify(cb) {
    this.notify = cb;
  }

  async write(raw) {
    await new Promise((r) => setTimeout(r, 15));
    for (const f of this.assembler.feed(raw)) await this.handle(parseFrame(f));
  }

  async disconnect() {
    this.closed = true;
    this.onDisconnect?.();
  }

  async reply(frame, plain, { encrypted = true } = {}) {
    const body = encrypted ? await this.cipher.encrypt(plain) : plain;
    const raw = buildFrame(frame.group, frame.command, body, (encrypted ? FLAG_ENCRYPTED : 0) | FLAG_ACK);
    // Split into small chunks, the way a real low-MTU link delivers frames.
    for (let i = 0; i < raw.length && !this.closed; i += 180) {
      this.notify(raw.slice(i, i + 180));
    }
  }

  tickTimers() {
    for (const c of Object.values(this.control)) {
      if (c.timer && Date.now() >= c.endsAt) {
        c.timer = false;
        c.on = false;
      }
    }
  }

  controlBytes(port) {
    const c = this.control[port];
    const { cable, info } = this.loads[port];
    const left = c.timer ? Math.ceil((c.endsAt - Date.now()) / 1000) : c.seconds;
    return Uint8Array.of(4, c.on ? 1 : 0, c.timer ? 1 : 0, ...u32(c.seconds), ...u32(left), this.loads[port].plugged ? cable : 3, info);
  }

  async handle(frame) {
    const plain = await this.cipher.decrypt(frame.body);
    const fields = new Map(parseTlv(plain).map((t) => [t.type, t.value]));
    const ok = () => this.reply(frame, Uint8Array.of(0, 0xa1, 1, 0x31));
    const result = (code) => this.reply(frame, Uint8Array.of(code, 0xa1, 1, 0x31));
    const status = (...items) => {
      const tlv = buildTlv(items);
      const out = new Uint8Array(tlv.length + 1);
      out.set(tlv, 1);
      return out;
    };
    const value = () => fields.get(0xa2)?.[1];
    const s = this.settings;
    switch (frame.command) {
      case 0x0001:
        return this.reply(frame, status([0xa1, Uint8Array.of(1)]));
      case 0x0003:
        return this.reply(frame, status([0xa1, Uint8Array.of(1)], [0xa3, Uint8Array.of(0x20)]));
      case 0x0029:
        return this.reply(frame, status(
          [0xa2, text("Charging")],
          [0xa3, text("v0.0.0.0")],
          [0xa4, text("SIMULATED0000000")],
          [0xa5, Uint8Array.of(0x02, 0, 0, 0, 0, 0x01)],
        ));
      case 0x0005:
        return this.reply(frame, Uint8Array.of(0));
      case 0x0021: {
        const hostPublic = fields.get(0xa1);
        const ecdh = await Ecdh.create();
        // This reply still uses the initial key. The switch happens right after it.
        await this.reply(frame, status([0xa1, ecdh.publicXY]));
        const { key, nonce } = await ecdh.derive(hostPublic);
        this.cipher.useSession(key, nonce);
        return;
      }
      case 0x0200: {
        this.tickTimers();
        const c = this.control;
        const l = this.loads;
        return this.reply(frame, status(
          [0xa1, text("1")],
          [0xa5, portStruct(l.C1, c.C1.on)],
          [0xa6, portStruct(l.C2, c.C2.on)],
          [0xa7, portStruct(l.C3, c.C3.on)],
          [0xa8, u8(s.screenOff)],
          [0xa9, u8(s.brightness)],
          [0xaa, u8(s.mode)],
          [0xac, this.controlBytes("C1")],
          [0xad, this.controlBytes("C2")],
          [0xae, this.controlBytes("C3")],
          [0xaf, u8(s.direction)],
          [0xb0, u8(s.language)],
          [0xb2, u8(s.autoRotate)],
          [0xe1, Uint8Array.of(4, 0x80, 3, ...u16(this.pictureId), 0, 0, 0, 0, 0, 0)],
          [0xfe, Uint8Array.of(0x03, 0, 0, 0, 0)],
        // A real A2687 on firmware v0.0.3.7 sends this reply without encryption.
        ), { encrypted: false });
      }
      case CMD.LANGUAGE:
        s.language = value();
        return ok();
      case CMD.SCREEN_OFF:
        s.screenOff = value();
        return ok();
      case CMD.BRIGHTNESS:
        s.brightness = value();
        return ok();
      case CMD.MODE:
        s.mode = value();
        return ok();
      case CMD.ALLOCATION:
        return ok();
      case CMD.ROTATE:
        s.autoRotate = value();
        return ok();
      case CMD.DIRECTION:
        // Seen on real hardware: choosing a direction also turns auto-rotate off.
        s.direction = value();
        s.autoRotate = 0;
        return ok();
      case CMD.PORT_SWITCH: {
        const c = this.control[PORTS[value()]];
        // Seen on real hardware: a switch command also clears any timer.
        Object.assign(c, { on: fields.get(0xa3)[1] === 1, timer: false, seconds: 300 });
        return ok();
      }
      case CMD.PORT_TIMER: {
        const c = this.control[PORTS[value()]];
        const seconds = readU32(fields.get(0xa3), 1);
        if (seconds) Object.assign(c, { timer: true, seconds, endsAt: Date.now() + seconds * 1000 });
        else c.timer = false;
        return ok();
      }
      case CMD.IDENTIFY:
        // Seen on real hardware: firmware v0.0.3.7 never answers this one.
        return;
      case CMD.SHOW_PICTURE: {
        const id = readU32(fields.get(0xa4), 1);
        if (!this.pictures.has(id)) return result(0x11);
        this.pictureId = id & 0xffff;
        return ok();
      }
      case CMD.PICTURE_START:
        this.transfer = { id: readU32(fields.get(0xa3), 1), crc: readU32(fields.get(0xa4), 1), size: readU32(fields.get(0xa5), 1), bytes: [] };
        return ok();
      case CMD.PICTURE_CHUNK: {
        const t = this.transfer;
        const index = fields.get(0xa2)[1] | (fields.get(0xa2)[2] << 8);
        t.bytes.push(...fields.get(0xa3).slice(1));
        const count = Math.ceil(t.size / 156);
        if (index + 1 === count) {
          const jpeg = Uint8Array.from(t.bytes.slice(0, t.size));
          if (crc32(jpeg) !== t.crc) return result(0x04);
          this.pictures.set(t.id, jpeg);
          // Keep four pictures and drop the oldest, as reported for the real charger.
          if (this.pictures.size > 4) this.pictures.delete(this.pictures.keys().next().value);
          this.pictureId = t.id & 0xffff;
          return result(0x10);
        }
        if ((index + 1) % 10 === 0) return ok();
        return;
      }
    }
  }
}
