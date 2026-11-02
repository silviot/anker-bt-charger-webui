// Run with: npm test [-- path/to/anker-prime-desktop/spec/protocol.json]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as ff from "../src/lib/ff09.js";
import { SimulatedCharger } from "../src/lib/simulator.js";

// Frame layout, from the worked example in the page.
const frame = ff.buildFrame(1, 0x0029, ff.unhex("aabb"));
assert.equal(ff.hex(frame.slice(0, 9)), "ff090c00030001" + "4029");
assert.equal(frame.length, 12);
const parsed = ff.parseFrame(frame);
assert.equal(parsed.command, 0x0029);
assert.ok(parsed.encrypted && !parsed.ack && parsed.checksumOk);

// Reassembly across split and joined notifications.
const a = new ff.Assembler();
assert.equal(a.feed(frame.slice(0, 5)).length, 0);
assert.equal(a.feed(Uint8Array.from([...frame.slice(5), ...frame])).length, 2);

// A real port struct captured from an A2687 on firmware v0.0.3.7.
const port = ff.decodePortStruct(ff.unhex("0401e04efb02fe05"));
assert.deepEqual(port, { mode: 1, volts: 20.192, amps: 0.763, watts: 15.34 });
const cable = ff.decodeCable(ff.unhex("0401002c0100002c0100000100"));
assert.equal(cable.capability, "5A / 100W");

// A complete snapshot with the same values, including the status byte.
const snap = ff.decodeSnapshot(ff.unhex("00a7080401e04efb02fe05a9020150"));
assert.equal(snap.totalWatts, 15.34);
assert.equal(snap.brightness, 80);

// Published request vectors, when the other project's spec is available.
const specPath = process.argv[2];
if (specPath) {
  const { vectors } = JSON.parse(readFileSync(specPath, "utf8"));
  const ts = Uint8Array.of(1, 0, 0, 0);
  const ts2 = Uint8Array.of(2, 0, 0, 0);
  const expected = Object.fromEntries(vectors.requests.map((r) => [r.name, r]));
  const check = (name, [group, command, body]) => {
    assert.equal(group, expected[name].group, name);
    assert.equal(command, expected[name].command, name);
    assert.equal(ff.hex(body), expected[name].body, name);
  };
  check("handshake_0001", ff.requests.hello(ts));
  check("handshake_0003", ff.requests.params(ts));
  check("handshake_0029", ff.requests.identity(ts));
  check("handshake_0005", ff.requests.setup(ts2));
  check("key_exchange", ff.requests.keyExchange(ff.unhex(vectors.public_key)));
  check("status_probe", ff.requests.snapshot(ts));
  console.log("request vectors match");
}

// Everything together, through the simulator with the real handshake.
const sim = new SimulatedCharger();
const frames = [];
const steps = [];
let keys;
const session = new ff.Session(sim, {
  onFrame: (f) => frames.push(f),
  onStep: (s) => steps.push(s),
  onKeys: (k) => (keys = k),
});
await session.handshake();
assert.deepEqual(steps, ["hello", "params", "identity", "setup", "keyExchange", "session"]);
assert.equal(session.identity.serial, "SIMULATED0000000");
assert.equal(keys.key.length, 16);
assert.equal(keys.nonce.length, 12);
assert.ok(frames.every((f) => f.authOk !== false));
const live = await session.snapshot();
assert.equal(live.ports.C1.mode, 1);
assert.equal(live.brightness, 80);
assert.equal(live.ports.C1.cable.on, true);
assert.ok(live.ports.C1.watts > 55 && live.ports.C1.watts < 75, `C1 ${live.ports.C1.watts}`);
assert.equal(live.ports.C3.mode, 0);
assert.equal(frames.at(-1).key, "session");
// As on the real unit: the request is encrypted, and the reply is not.
assert.ok(frames.at(-2).frame.encrypted);
assert.equal(frames.at(-1).frame.encrypted, false);

// Connecting and reading sends only the handshake and the snapshot request.
const sent = new Set(frames.filter((f) => f.dir === "tx").map((f) => f.frame.command));
assert.deepEqual([...sent].sort((x, y) => x - y), [0x0001, 0x0003, 0x0005, 0x0021, 0x0029, 0x0200]);

// Real control fields captured from the test unit: on, off, and a timer with 89 s left.
const on = ff.decodeCable(ff.unhex("0401002c0100002c0100000300"));
assert.deepEqual([on.on, on.timerRunning, on.timerSeconds, on.capability], [true, false, 300, null]);
assert.equal(ff.decodeCable(ff.unhex("0400002c0100002c0100000300")).on, false);
const timed = ff.decodeCable(ff.unhex("0401015a000000590000000300"));
assert.deepEqual([timed.timerRunning, timed.timerSeconds, timed.timerRemaining], [true, 90, 89]);

// A real settings snapshot from the test unit: no picture field on this firmware.
const real = ff.decodeSnapshot(ff.unhex("00a10131a8020100a9020150aa020100af020100b0020100b2020101"));
assert.deepEqual(
  [real.screenOff, real.brightness, real.chargingMode, real.direction, real.language, real.autoRotate, real.pictureId],
  [0, 80, 0, 0, 0, 1, null],
);

// Frames that a real charger accepted, apart from the timestamp.
const ts0 = Uint8Array.of(1, 2, 3, 4);
assert.equal(ff.hex(ff.requests.setting(ff.CMD.BRIGHTNESS, 40, ts0)[2]), "a10121a2020128fe0401020304");
assert.equal(ff.hex(ff.requests.portSwitch("C1", false, ts0)[2]), "a10121a2020100a3020100fe0401020304");
assert.equal(ff.hex(ff.requests.portSwitch("C3", true, ts0)[2]), "a10121a2020102a3020101fe0401020304");
assert.equal(ff.hex(ff.requests.portTimer("C1", 90, ts0)[2]), "a10121a2020100a305045a000000fe0401020304");

// Layouts documented by anker-prime-desktop: 47, 49 and 167 bytes.
assert.equal(ff.requests.showPicture(1001, 0xabcd, ts0)[2].length, 47);
assert.equal(ff.requests.pictureStart(1001, 0xabcd, 500, 4, ts0)[2].length, 49);
assert.equal(ff.requests.pictureChunk(0, Uint8Array.of(1, 2))[2].length, 167);
assert.equal(ff.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);

// Writes change what the simulator reports, as they did on the real charger.
assert.equal(await session.write(ff.requests.setting(ff.CMD.BRIGHTNESS, 40)), 0);
assert.equal((await session.snapshot()).brightness, 40);
await session.write(ff.requests.setting(ff.CMD.DIRECTION, 2));
const turned = await session.snapshot();
assert.deepEqual([turned.direction, turned.autoRotate], [2, 0]);
await session.write(ff.requests.portSwitch("C1", false));
const cut = await session.snapshot();
assert.deepEqual([cut.ports.C1.mode, cut.ports.C1.cable.on], [0, false]);
await session.write(ff.requests.portSwitch("C1", true));
await session.write(ff.requests.portTimer("C2", 600));
assert.ok((await session.snapshot()).ports.C2.cable.timerRunning);
await session.write(ff.requests.portTimer("C2", 0));
assert.equal((await session.snapshot()).ports.C2.cable.timerRunning, false);
await assert.rejects(session.write(ff.requests.setting(ff.CMD.IDENTIFY, 1), 100));

// A picture travels through the chunks intact, and only then can it be shown.
const jpeg = Uint8Array.from({ length: 2000 }, (_, i) => i % 251);
const crc = ff.crc32(jpeg);
assert.equal(await session.write(ff.requests.showPicture(4242, crc)), 0x11);
let moved = 0;
await session.sendPicture(4242, crc, jpeg, (done) => (moved = done));
assert.equal(moved, Math.ceil(2000 / 156));
assert.deepEqual(sim.pictures.get(4242), jpeg);
assert.equal((await session.snapshot()).pictureId, 4242);

// A changed ciphertext byte fails authentication.
const cipher = new ff.Cipher();
const ct = await cipher.encrypt(ff.unhex("a10121"));
ct[0] ^= 1;
await assert.rejects(cipher.decrypt(ct));

console.log("all tests passed");
