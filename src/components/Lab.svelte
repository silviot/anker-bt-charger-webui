<script>
  import { untrack } from "svelte";
  import { charger } from "../lib/charger.svelte.js";
  import * as ff from "../lib/ff09.js";

  let input = $state("");
  let selected = $state.raw(null);
  let keyChoice = $state("initial");
  let result = $state.raw({ segments: [], checks: [], fields: [] });
  let logEl = $state();
  let scrolled = false;

  const code = (c) => `0x${c.toString(16).padStart(4, "0")}`;
  const spaced = (bytes) => ff.hex(bytes).replace(/(..)(?=.)/g, "$1 ");
  const sessionKey = $derived(charger.keys);

  function pick(entry) {
    selected = entry;
    input = ff.hex(entry.frame.raw);
    keyChoice = entry.key === "session" && sessionKey ? "session" : "initial";
  }

  async function dissect(text, choice, keys) {
    const checks = [];
    const segments = [];
    const fields = [];
    const done = () => ({ segments, checks, fields });
    let raw;
    try {
      raw = ff.unhex(text);
    } catch (e) {
      checks.push([false, e.message]);
      return done();
    }
    if (!raw.length) return done();
    const frame = ff.parseFrame(raw);
    if (!frame) {
      checks.push([false, "This isn't a frame. A frame starts with FF 09 and has at least 10 bytes."]);
      return done();
    }
    const seg = (cls, bytes, title) => bytes.length && segments.push({ cls, text: spaced(bytes), title });
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
    checks.push([true, `Command ${code(frame.command)}: ${name}, ${frame.ack ? "reply" : "request"}, ${frame.encrypted ? "encrypted" : "not encrypted"}`]);
    checks.push([frame.declaredLength === raw.length, `Length field says ${frame.declaredLength} bytes; the frame has ${raw.length}`]);
    checks.push([frame.checksumOk, frame.checksumOk ? "XOR checksum is correct" : "XOR checksum is wrong"]);

    let plain = frame.body;
    if (frame.encrypted) {
      const useSession = choice === "session" && keys;
      const cipher = new ff.Cipher();
      if (useSession) cipher.useSession(keys.key, keys.nonce);
      const which = useSession ? "session" : "initial";
      try {
        plain = await cipher.decrypt(frame.body);
        checks.push([true, `GCM tag is valid with the ${which} key`]);
      } catch {
        checks.push([false, `GCM tag check failed with the ${which} key. The bytes changed, or this is the wrong key.`]);
        return done();
      }
    }
    const offset = frame.command === 0x0029 && plain[0] === 3 && plain[1] === 0 ? 6 : ff.tlvOffset(plain);
    for (const { type, value } of ff.parseTlv(plain, offset)) {
      fields.push({ type: type.toString(16).toUpperCase(), value: ff.hex(value), meaning: ff.describeTlv(frame.command, type, value) });
    }
    return done();
  }

  $effect(() => {
    const args = [input, keyChoice, sessionKey];
    let current = true;
    dissect(...args).then((r) => current && (result = r));
    return () => (current = false);
  });

  // Start with a real encrypted Hello, built here with the fixed key.
  const [group, command, plain] = ff.requests.hello(ff.epochBytes());
  new ff.Cipher().encrypt(plain).then((ct) => {
    if (!input) input = ff.hex(ff.buildFrame(group, command, ct));
  });

  // Open on a live snapshot once there is one, and keep the list at the newest frame.
  $effect(() => {
    const frames = charger.frames;
    untrack(() => {
      if (!selected) {
        const snap = frames.findLast((f) => f.dir === "rx" && f.frame.command === 0x0200);
        if (snap) pick(snap);
      }
      if (logEl && (!scrolled || logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 60)) {
        scrolled = frames.length > 0;
        queueMicrotask(() => logEl && (logEl.scrollTop = logEl.scrollHeight));
      }
    });
  });
</script>

<p>Select a frame from the session, or paste one. Then change a digit. The XOR checksum catches the change in any frame, and the GCM tag also catches it in an encrypted frame. Telemetry replies have only the checksum, so a changed reading with a fixed checksum still decodes.</p>
{#if charger.state === "idle"}
  <div class="row"><button onclick={() => charger.connectSimulator()}>Fill this with simulated traffic</button></div>
{/if}
<div class="lab">
  <div>
    <div class="log-head"><h2>Traffic</h2><span class="muted">{charger.frames.length ? `${charger.frames.length} shown` : "No frames yet"}</span></div>
    <ol class="log" bind:this={logEl} aria-label="Frames in this session">
      {#each charger.frames as f}
        <li>
          <button type="button" aria-current={f === selected ? "true" : undefined} onclick={() => pick(f)}>
            <span title={f.dir === "tx" ? "Sent" : "Received"}>{f.dir === "tx" ? "→" : "←"}</span>
            <span>{code(f.frame.command)}</span>
            <span class="meta">{ff.COMMANDS[f.frame.command] ?? "Unknown"}</span>
            <span class="meta">{f.frame.raw.length} B</span>
          </button>
        </li>
      {/each}
    </ol>
  </div>
  <div>
    <h2>Dissector</h2>
    <label for="frame-input">Frame in hex</label>
    <textarea id="frame-input" rows="4" spellcheck="false" bind:value={input} oninput={() => (selected = null)}></textarea>
    <div class="key-choice">
      <label>Decrypt with
        <select bind:value={keyChoice}>
          <option value="initial">Fixed initial key</option>
          <option value="session" disabled={!sessionKey}>This session's key</option>
        </select>
      </label>
    </div>
    <div class="dissect-bytes">
      {#each result.segments as s}<span class={`seg ${s.cls}`} title={s.title}>{s.text}</span>{" "}{/each}
    </div>
    <ul class="checks">
      {#each result.checks as [ok, text]}<li class={ok ? "ok" : "fail"}>{text}</li>{/each}
    </ul>
    {#if result.fields.length}
      <div class="table-scroll">
        <table class="plain tlv">
          <thead><tr><th>Type</th><th>Value</th><th>Meaning</th></tr></thead>
          <tbody>
            {#each result.fields as f}<tr><td>{f.type}</td><td>{f.value}</td><td>{f.meaning}</td></tr>{/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
