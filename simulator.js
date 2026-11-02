// A pretend charger that runs the real protocol, including the real handshake encryption.
// It implements the same transport interface as the Bluetooth connection.

import {
  Assembler, buildFrame, buildTlv, Cipher, Ecdh, FLAG_ACK, FLAG_ENCRYPTED, parseFrame, parseTlv,
} from "./ff09.js";

const text = (s) => new TextEncoder().encode(s);
const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];

const portStruct = ({ on, volts, watts }) => {
  if (!on || watts <= 0) return Uint8Array.of(0x04, 0, 0, 0, 0, 0, 0, 0);
  const jitter = watts * (0.97 + Math.random() * 0.06);
  const mv = Math.round(volts * 1000 * (0.995 + Math.random() * 0.01));
  const ma = Math.round((jitter / volts) * 1000);
  return Uint8Array.of(0x04, 1, ...u16(mv), ...u16(ma), ...u16(Math.round((mv * ma) / 10000)));
};

const cable = (capability, protocol) => Uint8Array.of(0x04, 1, 0, 0x2c, 1, 0, 0, 0x2c, 1, 0, 0, capability, protocol);

export class SimulatedCharger {
  // Each load is editable while the simulation runs.
  loads = {
    C1: { on: true, volts: 20, watts: 65 },
    C2: { on: true, volts: 9, watts: 18 },
    C3: { on: false, volts: 5, watts: 5 },
  };
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

  async handle(frame) {
    const plain = await this.cipher.decrypt(frame.body);
    const status = (...items) => {
      const tlv = buildTlv(items);
      const out = new Uint8Array(tlv.length + 1);
      out.set(tlv, 1);
      return out;
    };
    switch (frame.command) {
      case 0x0001:
        return this.reply(frame, status([0xa1, Uint8Array.of(1)]));
      case 0x0003:
        return this.reply(frame, status([0xa1, Uint8Array.of(1)], [0xa3, Uint8Array.of(0x20)]));
      case 0x0029:
        return this.reply(frame, status(
          [0xa2, text("Charging")],
          [0xa3, text("v0.0.0.0-sim")],
          [0xa4, text("SIMULATED0000000")],
          [0xa5, Uint8Array.of(0x02, 0, 0, 0, 0, 0x01)],
        ));
      case 0x0005:
        return this.reply(frame, Uint8Array.of(0));
      case 0x0021: {
        const hostPublic = parseTlv(plain).find((t) => t.type === 0xa1).value;
        const ecdh = await Ecdh.create();
        // This reply still uses the initial key. The switch happens right after it.
        await this.reply(frame, status([0xa1, ecdh.publicXY]));
        const { key, nonce } = await ecdh.derive(hostPublic);
        this.cipher.useSession(key, nonce);
        return;
      }
      case 0x0200: {
        const l = this.loads;
        return this.reply(frame, status(
          [0xa1, text("1")],
          [0xa5, portStruct(l.C1)],
          [0xa6, portStruct(l.C2)],
          [0xa7, portStruct(l.C3)],
          [0xa9, Uint8Array.of(0x01, 80)],
          [0xac, cable(0x02, 0x01)],
          [0xad, cable(0x01, 0x00)],
          [0xae, cable(0x03, 0x00)],
          [0xfe, Uint8Array.of(0x03, 0, 0, 0, 0)],
        // A real A2687 on firmware v0.0.3.7 sends this reply without encryption.
        ), { encrypted: false });
      }
    }
  }
}
