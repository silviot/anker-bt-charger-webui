import * as ff from "./ff09.js";
import { SimulatedCharger } from "./simulator.js";

const $ = (id) => document.getElementById(id);
const PORTS = ["C1", "C2", "C3"];
const WINDOW_MS = 120_000;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// ---- Connection ----

let session = null;
let sim = null;
let sessionKey = null;

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

async function openBluetooth() {
  if (!navigator.bluetooth) {
    throw new Error("This browser has no Web Bluetooth. Use Chrome or Edge on a desktop computer. See “If connecting fails” below.");
  }
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [ff.ADVERTISED_SERVICE] }],
    optionalServices: [ff.SERVICE],
  });
  device.addEventListener("gattserverdisconnected", () => ended("The charger disconnected."));
  setStatus(`Connecting to ${device.name ?? "charger"}…`);
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(ff.SERVICE);
  const write = await service.getCharacteristic(ff.WRITE_CHAR);
  const notify = await service.getCharacteristic(ff.NOTIFY_CHAR);
  const transport = bluetoothTransport(device, write, notify);
  // Start listening before any request goes out.
  return { transport, start: () => notify.startNotifications() };
}

async function run(open) {
  resetView();
  setBusy(true);
  try {
    const { transport, start } = await open();
    session = new ff.Session(transport, {
      onFrame: addFrame,
      onStep: markStep,
      onKeys: showKeys,
      onIdentity: showIdentity,
      onSnapshot: showSnapshot,
    });
    await start();
    setStatus("Running the handshake…");
    await session.handshake();
    setStatus("Connected. Reading the ports once per second.");
    await session.poll();
  } catch (e) {
    if (e.name === "NotFoundError") {
      // The person closed the device chooser. This is not an error.
      setStatus("Not connected");
      setBusy(false);
      return;
    }
    if (session) await session.stop().catch(() => {});
    ended();
    showNotice(e.message);
  }
}

function ended(message) {
  if (session) session.polling = false;
  session = null;
  sim = null;
  $("sim-controls").hidden = true;
  setStatus(message ?? "Not connected");
  setBusy(false);
}

$("connect").onclick = () => run(openBluetooth);
$("demo").onclick = () =>
  run(async () => {
    sim = new SimulatedCharger();
    buildSliders(sim);
    $("sim-controls").hidden = false;
    return { transport: sim, start: async () => {} };
  });
$("stop").onclick = async () => {
  const s = session;
  ended();
  await s?.stop();
};

function setStatus(text) {
  $("status").textContent = text;
}
function setBusy(busy) {
  $("connect").hidden = busy;
  $("demo").hidden = busy;
  $("stop").hidden = !busy;
}
function showNotice(text) {
  $("notice").textContent = text;
  $("notice").hidden = false;
}

function resetView() {
  $("notice").hidden = true;
  $("identity").hidden = true;
  $("keys").hidden = true;
  $("key-values").replaceChildren();
  document.querySelectorAll("#steps li").forEach((li) => li.classList.remove("done", "now"));
  history.length = 0;
  frames.length = 0;
  sessionKey = null;
  const option = $("key-select").options[1];
  option.disabled = true;
  $("key-select").value = "initial";
  renderLog();
  renderPorts(null);
  renderChart();
  $("total").textContent = "–";
}

// ---- Handshake view ----

function markStep(name) {
  let reached = false;
  document.querySelectorAll("#steps li").forEach((li) => {
    const current = li.dataset.step === name;
    if (current) reached = true;
    li.classList.toggle("done", !reached || (current && name === "session"));
    li.classList.toggle("now", current && name !== "session");
  });
}

function showKeys({ hostPublic, devicePublic, shared, key, nonce }) {
  sessionKey = { key, nonce };
  $("key-select").options[1].disabled = false;
  const rows = [
    ["Browser public key", hostPublic],
    ["Charger public key", devicePublic],
    ["Shared secret", shared],
    ["Session key", key],
    ["Session nonce", nonce],
  ];
  $("key-values").replaceChildren(
    ...rows.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: ff.hex(v) })]),
  );
  $("keys").hidden = false;
}

function showIdentity({ serial, firmware, mac }) {
  const rows = [["Serial", serial], ["Firmware", firmware], ["Address", mac]].filter(([, v]) => v);
  $("identity").replaceChildren(
    ...rows.map(([k, v]) => el("div", {}, el("dt", { textContent: k }), el("dd", { textContent: v }))),
  );
  $("identity").hidden = rows.length === 0;
}

// ---- Port cards ----

const portNodes = {};
for (const name of PORTS) {
  const watts = el("div", { className: "watts", textContent: "–" });
  const state = el("span", { className: "state", textContent: "No data" });
  const detail = el("div", { className: "detail" });
  const swatch = el("span", { className: "swatch" });
  swatch.style.background = `var(--${name.toLowerCase()})`;
  const header = el("header", {}, swatch, name, state);
  portNodes[name] = { watts, state, detail };
  $("ports").append(el("div", { className: "port" }, header, watts, detail));
}

function renderPorts(ports) {
  for (const name of PORTS) {
    const n = portNodes[name];
    const p = ports?.[name];
    if (!p) {
      n.watts.textContent = "–";
      n.state.textContent = "No data";
      n.detail.textContent = "";
    } else if (!p.mode) {
      n.watts.textContent = "0 W";
      n.state.textContent = "Idle";
      n.detail.textContent = "";
    } else {
      n.watts.textContent = `${p.watts.toFixed(1)} W`;
      n.state.textContent = "Active";
      const cable = [p.cable?.capability, p.cable?.fastCharge].filter(Boolean).join(", ");
      n.detail.textContent = `${p.volts.toFixed(2)} V · ${p.amps.toFixed(2)} A${cable ? ` · ${cable}` : ""}`;
    }
  }
}

function showSnapshot(snapshot) {
  renderPorts(snapshot.ports);
  $("total").textContent = `${snapshot.totalWatts.toFixed(1)} W`;
  const watts = PORTS.map((n) => (snapshot.ports[n]?.mode ? snapshot.ports[n].watts : 0));
  history.push({ t: Date.now(), watts });
  while (history.length && history[0].t < Date.now() - WINDOW_MS) history.shift();
  renderChart();
  renderTable();
}

// ---- Chart: stacked area, one axis, recessive grid ----

const history = [];
const SVG = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => {
  const node = document.createElementNS(SVG, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
};

$("legend").append(
  ...PORTS.map((n) => {
    const s = el("span", { className: "swatch" });
    s.style.background = `var(--${n.toLowerCase()})`;
    return el("span", {}, s, n);
  }),
);

function niceMax(v) {
  for (const m of [20, 40, 60, 80, 100, 120, 160, 200, 250]) if (v <= m) return m;
  return Math.ceil(v / 50) * 50;
}

const geometry = { left: 40, right: 12, top: 8, bottom: 22 };

function renderChart() {
  const svg = $("chart");
  const W = svg.clientWidth || 800;
  const H = svg.clientHeight || 240;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const { left, right, top, bottom } = geometry;
  const now = history.at(-1)?.t ?? Date.now();
  const max = niceMax(Math.max(0, ...history.map((h) => h.watts[0] + h.watts[1] + h.watts[2])));
  const x = (t) => left + (W - left - right) * (1 - (now - t) / WINDOW_MS);
  const y = (v) => H - bottom - (H - top - bottom) * (v / max);
  geometry.x = x;

  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    svg.append(svgEl("line", { x1: left, x2: W - right, y1: y(v), y2: y(v), stroke: "var(--line)", "stroke-width": 1 }));
    const label = svgEl("text", { x: left - 6, y: y(v) + 4, "text-anchor": "end" });
    label.textContent = String(v);
    svg.append(label);
  }
  for (const [text, s] of [["2 min ago", 120], ["1 min ago", 60], ["now", 0]]) {
    const anchor = s === 120 ? "start" : s === 0 ? "end" : "middle";
    const label = svgEl("text", { x: x(now - s * 1000), y: H - 6, "text-anchor": anchor });
    label.textContent = text;
    svg.append(label);
  }
  if (history.length < 2) return;
  const base = history.map(() => 0);
  PORTS.forEach((name, i) => {
    const upper = history.map((h, k) => base[k] + h.watts[i]);
    const line = history.map((h, k) => `${x(h.t).toFixed(1)},${y(upper[k]).toFixed(1)}`);
    const back = history.map((h, k) => `${x(h.t).toFixed(1)},${y(base[k]).toFixed(1)}`).reverse();
    svg.append(svgEl("polygon", {
      points: [...line, ...back].join(" "),
      fill: `var(--${name.toLowerCase()})`,
      stroke: "var(--surface)",
      "stroke-width": 2,
      "stroke-linejoin": "round",
    }));
    upper.forEach((v, k) => (base[k] = v));
  });
}

$("chart-wrap").addEventListener("pointermove", (e) => {
  if (history.length < 2) return;
  const rect = $("chart").getBoundingClientRect();
  const px = e.clientX - rect.left;
  let best = history[0];
  for (const h of history) if (Math.abs(geometry.x(h.t) - px) < Math.abs(geometry.x(best.t) - px)) best = h;
  const tip = $("tip");
  const rows = PORTS.map((n, i) => {
    const s = el("span", { className: "swatch" });
    s.style.background = `var(--${n.toLowerCase()})`;
    return el("div", {}, s, `${n} ${best.watts[i].toFixed(1)} W`);
  });
  const total = best.watts.reduce((a, b) => a + b, 0);
  tip.replaceChildren(
    el("div", { textContent: new Date(best.t).toLocaleTimeString() }),
    ...rows,
    el("div", {}, el("strong", { textContent: `Total ${total.toFixed(1)} W` })),
  );
  tip.hidden = false;
  const bx = geometry.x(best.t);
  const onLeft = bx > rect.width / 2;
  tip.style.left = onLeft ? "" : `${bx + 12}px`;
  tip.style.right = onLeft ? `${rect.width - bx + 12}px` : "";
  $("chart").querySelector(".cross")?.remove();
  $("chart").append(svgEl("line", {
    class: "cross", x1: bx, x2: bx, y1: geometry.top, y2: rect.height - geometry.bottom, stroke: "var(--text-2)", "stroke-width": 1,
  }));
});
$("chart-wrap").addEventListener("pointerleave", () => {
  $("tip").hidden = true;
  $("chart").querySelector(".cross")?.remove();
});
addEventListener("resize", renderChart);

function renderTable() {
  const rows = history.slice(-10).reverse().map((h) => {
    const total = h.watts.reduce((a, b) => a + b, 0);
    return el("tr", {},
      el("td", { textContent: new Date(h.t).toLocaleTimeString() }),
      ...[...h.watts, total].map((w) => el("td", { textContent: w.toFixed(2) })),
    );
  });
  $("table").tBodies[0].replaceChildren(...rows);
}

// ---- Simulator controls ----

function buildSliders(simulator) {
  $("sliders").replaceChildren(
    ...PORTS.map((name) => {
      const load = simulator.loads[name];
      const value = el("span");
      const on = el("input", { type: "checkbox", checked: load.on });
      const range = el("input", { type: "range", min: 1, max: 100, value: load.watts });
      const sync = () => {
        load.on = on.checked;
        load.watts = +range.value;
        load.volts = load.watts > 45 ? 20 : load.watts > 15 ? 9 : 5;
        range.disabled = !on.checked;
        value.textContent = on.checked ? ` ${load.watts} W at ${load.volts} V` : " nothing plugged in";
      };
      on.oninput = range.oninput = sync;
      range.setAttribute("aria-label", `${name} load in watts`);
      sync();
      return el("div", {}, el("label", {}, on, ` ${name}`, value), range);
    }),
  );
}

// ---- Traffic log ----

const frames = [];
const KEEP_FIRST = 14; // The handshake stays visible during long sessions.
const KEEP_LAST = 60;
let selected = null;

function addFrame(entry) {
  frames.push(entry);
  if (frames.length > KEEP_FIRST + KEEP_LAST) frames.splice(KEEP_FIRST, 1);
  renderLog();
  if (!selected && entry.dir === "rx" && entry.frame.command === 0x0200) selectFrame(entry);
}

function renderLog() {
  const log = $("log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  log.replaceChildren(
    ...frames.map((f) => {
      const name = ff.COMMANDS[f.frame.command] ?? "Unknown";
      const code = `0x${f.frame.command.toString(16).padStart(4, "0")}`;
      const b = el("button", { type: "button", onclick: () => selectFrame(f) },
        el("span", { textContent: f.dir === "tx" ? "→" : "←", title: f.dir === "tx" ? "Sent" : "Received" }),
        el("span", { textContent: code }),
        el("span", { className: "meta", textContent: name }),
        el("span", { className: "meta", textContent: `${f.frame.raw.length} B` }),
      );
      if (f === selected) b.setAttribute("aria-current", "true");
      return el("li", {}, b);
    }),
  );
  if (atBottom) log.scrollTop = log.scrollHeight;
  $("log-count").textContent = frames.length ? `${frames.length} shown` : "No frames yet";
}

function selectFrame(entry) {
  selected = entry;
  $("frame-input").value = ff.hex(entry.frame.raw);
  $("key-select").value = entry.key === "session" && sessionKey ? "session" : "initial";
  renderLog();
  dissect();
}

// ---- Dissector ----

async function dissect() {
  const out = $("dissect-bytes");
  const checks = $("dissect-checks");
  const body = $("dissect-tlv").tBodies[0];
  out.replaceChildren();
  checks.replaceChildren();
  body.replaceChildren();
  const addCheck = (ok, text) => checks.append(el("li", { className: ok ? "ok" : "fail", textContent: text }));

  let raw;
  try {
    raw = ff.unhex($("frame-input").value);
  } catch (e) {
    addCheck(false, e.message);
    return;
  }
  if (!raw.length) return;
  const frame = ff.parseFrame(raw);
  if (!frame) {
    addCheck(false, "This is not a frame. A frame starts with FF 09 and has at least 10 bytes.");
    return;
  }

  const seg = (cls, bytes, title) => {
    if (!bytes.length) return;
    out.append(el("span", { className: `seg ${cls}`, textContent: ff.hex(bytes).replace(/(..)(?=.)/g, "$1 "), title }), " ");
  };
  seg("magic", raw.slice(0, 2), "Start of frame");
  seg("len", raw.slice(2, 4), "Length of the whole frame");
  seg("hdr", raw.slice(4, 6), "Fixed bytes");
  seg("grp", raw.slice(6, 7), "Command group");
  seg("cmd", raw.slice(7, 9), "Flags and command");
  if (frame.encrypted && frame.body.length >= 16) {
    seg("ct", frame.body.slice(0, -16), "Encrypted body");
    seg("tag", frame.body.slice(-16), "GCM authentication tag");
  } else {
    seg("ct", frame.body, "Body");
  }
  seg("sum", raw.slice(-1), "XOR checksum");

  const name = ff.COMMANDS[frame.command] ?? "Unknown command";
  const code = frame.command.toString(16).padStart(4, "0");
  addCheck(true, `Command 0x${code}: ${name}, ${frame.ack ? "reply" : "request"}, ${frame.encrypted ? "encrypted" : "not encrypted"}`);
  addCheck(frame.declaredLength === raw.length, `Length field says ${frame.declaredLength} bytes; the frame has ${raw.length}`);
  addCheck(frame.checksumOk, frame.checksumOk ? "XOR checksum is correct" : "XOR checksum is wrong");

  let plain = frame.body;
  if (frame.encrypted) {
    const cipher = new ff.Cipher();
    const useSession = $("key-select").value === "session" && sessionKey;
    if (useSession) cipher.useSession(sessionKey.key, sessionKey.nonce);
    try {
      plain = await cipher.decrypt(frame.body);
      addCheck(true, `GCM tag is valid with the ${useSession ? "session" : "initial"} key`);
    } catch {
      addCheck(false, `GCM tag check failed with the ${useSession ? "session" : "initial"} key. The bytes changed, or this is the wrong key.`);
      return;
    }
  }
  const offset = frame.command === 0x0029 && plain[0] === 3 && plain[1] === 0 ? 6 : ff.tlvOffset(plain);
  body.append(
    ...ff.parseTlv(plain, offset).map(({ type, value }) =>
      el("tr", {},
        el("td", { textContent: type.toString(16).toUpperCase() }),
        el("td", { textContent: ff.hex(value) }),
        el("td", { textContent: ff.describeTlv(frame.command, type, value) }),
      ),
    ),
  );
}

$("frame-input").oninput = () => {
  selected = null;
  renderLog();
  dissect();
};
$("key-select").onchange = dissect;

// Start with a real encrypted Hello, built here with the fixed key.
const [group, command, plain] = ff.requests.hello(ff.epochBytes());
new ff.Cipher().encrypt(plain).then((ct) => {
  $("frame-input").value = ff.hex(ff.buildFrame(group, command, ct));
  dissect();
});

renderChart();
