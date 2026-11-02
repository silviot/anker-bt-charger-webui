<script>
  import { charger } from "../lib/charger.svelte.js";
  import { PORTS } from "../lib/ff09.js";
  import Chart from "../components/Chart.svelte";

  const colors = { C1: "var(--c1)", C2: "var(--c2)", C3: "var(--c3)" };
  const snap = $derived(charger.snapshot);

  // The simulator's loads are plain objects, so these copies drive the form.
  let loads = $state({});
  $effect(() => {
    if (charger.sim) loads = Object.fromEntries(PORTS.map((p) => [p, { plugged: charger.sim.loads[p].plugged, watts: charger.sim.loads[p].watts }]));
  });
  function setLoad(port) {
    const l = charger.sim?.loads[port];
    if (!l) return;
    l.plugged = loads[port].plugged;
    l.watts = +loads[port].watts;
    l.volts = l.watts > 45 ? 20 : l.watts > 15 ? 9 : 5;
    l.cable = l.watts > 100 ? 2 : l.watts > 60 ? 1 : 0;
  }
</script>

{#if !snap || charger.state === "idle"}
  <section class="hero">
    <h1>Your Anker charger, in your browser.</h1>
    <p class="lede">See how much power each port is delivering, switch ports off, and change the charger's settings. You don't need the app or an account, and nothing leaves your computer.</p>
    {#if charger.state === "connecting"}
      <p class="muted">Connecting to the charger…</p>
    {:else}
      <div class="row">
        <button class="primary big-btn" onclick={() => charger.connectBluetooth()}>Connect to charger</button>
        <button class="big-btn" onclick={() => charger.connectSimulator()}>Try the simulator</button>
      </div>
      <p class="muted">Works in Chrome or Edge on a computer. Quit the Anker app first, because the charger takes one connection at a time. Curious how this works? <a href="#/protocol">See the protocol</a>.</p>
    {/if}
  </section>
{:else}
  <h1 class="sr-only">Live power</h1>
  <div class="stats">
    <div class="card total">
      <span class="label">Total output</span>
      <span class="big">{snap.totalWatts.toFixed(1)} W</span>
    </div>
    <div class="ports">
      {#each PORTS as p}
        {@const port = snap.ports[p]}
        <div class="card port">
          <header><i class="swatch" style:background={colors[p]}></i>{p}<span class="state">{port?.cable?.on === false ? "Switched off" : port?.mode ? "Charging" : "Idle"}</span></header>
          <div class="watts">{port?.mode ? port.watts.toFixed(1) : "0"} W</div>
          <div class="detail">{port?.mode ? `${port.volts.toFixed(1)} V · ${port.amps.toFixed(2)} A` : " "}</div>
        </div>
      {/each}
    </div>
  </div>

  <Chart history={charger.history} />

  {#if charger.sim && loads.C1}
    <details class="card sim" open>
      <summary>Simulated devices</summary>
      <p class="muted">Plug in a pretend device and change how much power it draws.</p>
      <div class="sliders">
        {#each PORTS as p}
          <div>
            <label><input type="checkbox" bind:checked={loads[p].plugged} onchange={() => setLoad(p)} /> {p}: {loads[p].plugged ? `${loads[p].watts} W` : "nothing plugged in"}</label>
            <input type="range" min="1" max="100" aria-label={`${p} load in watts`} disabled={!loads[p].plugged} bind:value={loads[p].watts} oninput={() => setLoad(p)} />
          </div>
        {/each}
      </div>
    </details>
  {/if}

  {#if charger.identity}
    <p class="muted id-line">Serial {charger.identity.serial ?? "unknown"} · Firmware {charger.identity.firmware ?? "unknown"}</p>
  {/if}
{/if}
