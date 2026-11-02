<script>
  import { charger } from "../lib/charger.svelte.js";
  import { PORTS, requests } from "../lib/ff09.js";
  import Gate from "../components/Gate.svelte";
  import Outcome from "../components/Outcome.svelte";

  const colors = { C1: "var(--c1)", C2: "var(--c2)", C3: "var(--c3)" };
  const PRESETS = [[900, "15 minutes"], [1800, "30 minutes"], [3600, "1 hour"], [7200, "2 hours"], [14400, "4 hours"]];
  const snap = $derived(charger.snapshot);
  let outcome = $state({});
  let chosen = $state({ C1: 3600, C2: 3600, C3: 3600 });

  async function toggle(p, on) {
    const port = snap.ports[p];
    if (!on && port?.mode && !confirm(`${p} is delivering ${port.watts.toFixed(1)} W. Turn it off? The attached device will stop charging.`)) return;
    outcome[p] = "sending";
    outcome[p] = await charger.apply(requests.portSwitch(p, on), (s) => s.ports[p]?.cable?.on === on);
  }
  async function startTimer(p) {
    outcome[p] = "sending";
    outcome[p] = await charger.apply(requests.portTimer(p, chosen[p]), (s) => s.ports[p]?.cable?.timerRunning === true);
  }
  async function stopTimer(p) {
    outcome[p] = "sending";
    outcome[p] = await charger.apply(requests.portTimer(p, 0), (s) => s.ports[p]?.cable?.timerRunning === false);
  }
  function left(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s`;
  }
</script>

<h1>Ports</h1>
<p class="lede-s">Switch a port off, or set it to turn off by itself later. A timer is handy for not leaving a device charging all night.</p>

<Gate what="the ports">
  <div class="stack">
    {#each PORTS as p}
      {@const port = snap.ports[p]}
      {@const cable = port?.cable}
      <section class="card" aria-label={`Port ${p}`}>
        <div class="card-head">
          <h2><i class="swatch" style:background={colors[p]}></i>{p}</h2>
          <span class="muted">{port?.mode ? `${port.watts.toFixed(1)} W at ${port.volts.toFixed(1)} V` : "Nothing charging"}</span>
          {#if cable?.on !== undefined}
            <label class="switch">
              <input type="checkbox" role="switch" checked={cable.on} onchange={(e) => { const on = e.currentTarget.checked; e.currentTarget.checked = cable.on; toggle(p, on); }} />
              <span>{cable.on ? "On" : "Off"}</span>
            </label>
          {/if}
        </div>

        {#if port?.device || cable?.capability || cable?.fastCharge}
          <dl class="facts">
            {#if port?.device}<div><dt>Device</dt><dd>{port.device}</dd></div>{/if}
            {#if cable?.capability}<div><dt>Cable</dt><dd>{cable.capability}</dd></div>{/if}
            {#if cable?.fastCharge}<div><dt>Fast charging</dt><dd>{cable.fastCharge}</dd></div>{/if}
          </dl>
        {/if}

        {#if cable?.timerRunning}
          <div class="row">
            <span>Turns off in <strong>{left(cable.timerRemaining)}</strong></span>
            <button class="small" onclick={() => stopTimer(p)}>Cancel timer</button>
          </div>
        {:else if cable?.on}
          <div class="row">
            <label>Turn off after <select bind:value={chosen[p]}>{#each PRESETS as [s, text]}<option value={s}>{text}</option>{/each}</select></label>
            <button class="small" onclick={() => startTimer(p)}>Start timer</button>
          </div>
        {/if}
        <Outcome value={outcome[p]} />
      </section>
    {/each}
  </div>
</Gate>
