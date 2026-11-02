<script>
  import { charger } from "../lib/charger.svelte.js";
  import { CMD, PORTS, requests } from "../lib/ff09.js";
  import Gate from "../components/Gate.svelte";
  import Outcome from "../components/Outcome.svelte";

  const MODES = [
    [0, "Smart", "The charger decides how to share power between ports. This is the app's AI mode."],
    [1, "Standard", "The app's standard mode, without the smart sharing."],
  ];
  const ALLOCATIONS = [
    [0, "Two laptops", "Shares power for two laptops."],
    [1, "C1 first", "Gives port C1 priority."],
  ];
  // SCP and UFCS are always allowed. The app allows at most three of the other four.
  const PROTOCOLS = [
    [0x01, "SCP", false], [0x02, "UFCS", false], [0x04, "PD 12 V", true],
    [0x08, "PPS 5–11 V", true], [0x10, "PPS 5–16 V", true], [0x20, "PPS 4.5–21 V", true],
  ];
  const LIMITED = PROTOCOLS.filter((p) => p[2]).reduce((m, p) => m | p[0], 0);

  const snap = $derived(charger.snapshot);
  let modeOutcome = $state(null);
  let allocationOutcome = $state(null);
  let identifyOutcome = $state(null);
  let customOutcome = $state(null);
  let understood = $state(false);
  let autoExit = $state(false);
  let watts = $state({ C1: 100, C2: 45, C3: 15 });
  let masks = $state({ C1: 0x3b, C2: 0x3b, C3: 0x3b });

  const warn = "Devices on the charger may briefly stop charging while it changes. Continue?";

  const total = $derived(PORTS.reduce((n, p) => n + (+watts[p] || 0), 0));
  const problem = $derived.by(() => {
    for (const p of PORTS) {
      const w = +watts[p];
      if (!Number.isInteger(w) || (w !== 0 && (w < 15 || w > 140))) return `${p} must be 0, or between 15 and 140 W.`;
      if (w > 0 && !masks[p]) return `${p} needs at least one protocol.`;
    }
    return total > 160 ? `The total is ${total} W, and the limit is 160 W.` : null;
  });

  const count = (m) => PROTOCOLS.filter(([bit, , limited]) => limited && m & bit).length;
  const blocked = (p, bit, limited) => limited && !(masks[p] & bit) && count(masks[p] & LIMITED) >= 3;

  async function setMode(value) {
    if (snap.chargingMode === value || !confirm(warn)) return;
    modeOutcome = "sending";
    modeOutcome = await charger.apply(requests.setting(CMD.MODE, value), (s) => s.chargingMode === value);
  }
  async function setAllocation(value) {
    if (!confirm(warn)) return;
    allocationOutcome = "sending";
    allocationOutcome = await charger.apply(requests.setting(CMD.ALLOCATION, value));
  }
  async function setIdentify(on) {
    identifyOutcome = "sending";
    identifyOutcome = await charger.apply(requests.setting(CMD.IDENTIFY, on ? 1 : 0));
  }
  async function sendCustom() {
    if (!confirm(`Send this custom mode to the charger? ${warn}`)) return;
    customOutcome = "sending";
    const plan = { autoExit, watts: Object.fromEntries(PORTS.map((p) => [p, +watts[p]])), masks: { ...masks } };
    customOutcome = await charger.apply(requests.customMode(plan), (s) => s.chargingMode === 4);
  }
</script>

<h1>Charging</h1>
<p class="lede-s">Choose how the charger shares its 160 W between ports. If you're not sure, Smart is a good choice.</p>

<Gate what="the charging settings">
  <div class="stack">
    <section class="card">
      <h2>Mode <span class="badge warn">Untested</span></h2>
      <p class="muted">These settings come from analysis of the official app. They haven't been tried on a real charger through this page.</p>
      <div class="choices">
        {#each MODES as [value, name, text]}
          <button class="choice" aria-pressed={snap.chargingMode === value} onclick={() => setMode(value)}>
            <strong>{name}</strong><span>{text}</span>
          </button>
        {/each}
      </div>
      {#if snap.chargingMode === 4}<p class="muted">The charger is using a custom mode.</p>{/if}
      <Outcome value={modeOutcome} />
    </section>

    <section class="card">
      <h2>Fixed power sharing <span class="badge warn">Untested</span></h2>
      <p class="muted">The charger doesn't report which one is active, so neither is highlighted.</p>
      <div class="choices">
        {#each ALLOCATIONS as [value, name, text]}
          <button class="choice" onclick={() => setAllocation(value)}><strong>{name}</strong><span>{text}</span></button>
        {/each}
      </div>
      <Outcome value={allocationOutcome} />
    </section>

    <details class="card">
      <summary><strong>Custom mode</strong> <span class="badge warn">Experimental</span></summary>
      <p>Set a power limit and the allowed protocols for each port. The app's format for this was worked out by inference, and nobody has published a captured example, so it may not work. Ordinary use doesn't need it.</p>
      <div class="custom">
        {#each PORTS as p}
          <fieldset>
            <legend>{p}</legend>
            <label>Limit (W) <input type="number" min="0" max="140" bind:value={watts[p]} /></label>
            {#each PROTOCOLS as [bit, name, limited]}
              <label class="check"><input type="checkbox" checked={!!(masks[p] & bit)} disabled={blocked(p, bit, limited)} onchange={(e) => (masks[p] = e.currentTarget.checked ? masks[p] | bit : masks[p] & ~bit)} /> {name}</label>
            {/each}
          </fieldset>
        {/each}
      </div>
      <p class="muted">Total {total} W of 160 W. As in the app, each port can have at most three of the PD 12 V and PPS options.</p>
      <label class="check"><input type="checkbox" bind:checked={autoExit} /> Leave custom mode automatically</label>
      {#if problem}<p class="outcome bad" role="alert">{problem}</p>{/if}
      <label class="check"><input type="checkbox" bind:checked={understood} /> I understand this is experimental</label>
      <div class="row"><button disabled={!understood || !!problem} onclick={sendCustom}>Send custom mode</button></div>
      <Outcome value={customOutcome} />
    </details>

    <details class="card">
      <summary><strong>Device identification</strong></summary>
      <p>The app can have the charger identify attached devices. On firmware v0.0.3.7 this command got no reply, so it may need newer firmware.</p>
      <div class="row">
        <button class="small" onclick={() => setIdentify(true)}>Turn on</button>
        <button class="small" onclick={() => setIdentify(false)}>Turn off</button>
      </div>
      <Outcome value={identifyOutcome} />
    </details>
  </div>
</Gate>
