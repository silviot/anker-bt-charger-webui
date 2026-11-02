<script>
  import { OUTCOME } from "../lib/charger.svelte.js";
  let { value } = $props();
</script>

{#if value === "sending"}
  <p class="outcome muted" role="status">Sending…</p>
{:else if value}
  <p class="outcome" class:good={value === "confirmed"} class:bad={value === "refused" || value === "no-reply"} role="status">{OUTCOME[value] ?? value}</p>
{/if}
