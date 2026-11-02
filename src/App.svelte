<script>
  import { charger } from "./lib/charger.svelte.js";
  import Live from "./views/Live.svelte";
  import Ports from "./views/Ports.svelte";
  import Charging from "./views/Charging.svelte";
  import Screen from "./views/Screen.svelte";
  import Protocol from "./views/Protocol.svelte";
  import Help from "./views/Help.svelte";

  const TABS = [
    { id: "live", label: "Live", view: Live, title: "Live power" },
    { id: "ports", label: "Ports", view: Ports, title: "Ports" },
    { id: "charging", label: "Charging", view: Charging, title: "Charging" },
    { id: "screen", label: "Screen", view: Screen, title: "Screen" },
    { id: "protocol", label: "How it works", view: Protocol, title: "How it works" },
    { id: "help", label: "Help", view: Help, title: "Help" },
  ];

  const parse = () => location.hash.replace(/^#\/?/, "").split("/");
  let route = $state(parse());
  const tab = $derived(TABS.find((t) => t.id === route[0]) ?? TABS[0]);

  $effect(() => {
    document.title = `${tab.title} · Anker Prime 160W in your browser`;
  });
</script>

<svelte:window onhashchange={() => { route = parse(); window.scrollTo(0, 0); }} />

<a class="skip" href={`#/${tab.id}`} onclick={(e) => { e.preventDefault(); document.getElementById("view")?.focus(); }}>Skip to content</a>

<header class="top">
  <div class="top-row">
    <a class="brand" href="#/live">
      <img src="favicon.svg" alt="" width="24" height="24" />
      <span>Anker Prime 160W</span>
    </a>
    <div class="conn">
      <span class="pill" class:on={charger.connected} class:busy={charger.state === "connecting"} role="status">
        {charger.statusText}{charger.isSim && charger.connected ? " (simulated)" : ""}
      </span>
      {#if charger.state !== "idle"}
        <button class="small" onclick={() => charger.disconnect()}>Disconnect</button>
      {:else}
        <button class="small primary" onclick={() => charger.connectBluetooth()}>Connect</button>
      {/if}
    </div>
  </div>
  <nav aria-label="Views">
    {#each TABS as t (t.id)}
      <a href={`#/${t.id}`} aria-current={t === tab ? "page" : undefined}>{t.label}</a>
    {/each}
  </nav>
</header>

<main id="view" tabindex="-1">
  {#if charger.lost}
    <p class="lost" role="status">
      {#if charger.state === "connecting"}Connection lost. Reconnecting… You can keep reading. Values below may be out of date, and controls are off for now.
      {:else}Connection lost, and reconnecting failed. Values below are out of date. <button class="small" onclick={() => charger.connectBluetooth()}>Connect again</button>{/if}
    </p>
  {/if}
  {#if charger.notice}
    <p class="notice" role="alert">{charger.notice}</p>
  {/if}
  {#if charger.errorReport}
    <p class="notice" role="alert">The charger sent an error report. It may be too hot, or a port may have a fault. Unplug the devices and let it cool. Raw report: <code>{charger.errorReport}</code></p>
  {/if}
  {#key tab.id}
    <tab.view sub={route[1]} />
  {/key}
</main>

<footer class="foot">
  <p>Not affiliated with or endorsed by Anker. Use only with devices you own. <a href="https://github.com/silviot/anker-bt-charger-webui">Source code</a></p>
</footer>
