<script>
  import { charger } from "../lib/charger.svelte.js";
  let { children, what = "this" } = $props();
</script>

{#if (charger.connected || charger.lost) && charger.snapshot}
  <!-- Stays mounted through a reconnect, so open sections and the scroll position survive. -->
  <fieldset class="gate" disabled={!charger.connected}>
    {@render children()}
  </fieldset>
{:else if charger.state === "connecting"}
  <div class="card empty"><p>Connecting to the charger…</p></div>
{:else}
  <div class="card empty">
    <p>Connect to your charger to use {what}.</p>
    <div class="row">
      <button class="primary" onclick={() => charger.connectBluetooth()}>Connect to charger</button>
      <button onclick={() => charger.connectSimulator()}>Try the simulator</button>
    </div>
  </div>
{/if}
