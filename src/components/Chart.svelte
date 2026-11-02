<script>
  import { PORTS } from "../lib/ff09.js";
  let { history } = $props();

  const WINDOW_MS = 120_000;
  const HEIGHT = 240;
  const m = { left: 40, right: 12, top: 8, bottom: 22 };
  const colors = { C1: "var(--c1)", C2: "var(--c2)", C3: "var(--c3)" };
  let width = $state(800);
  let hover = $state(null);

  function niceMax(v) {
    for (const n of [20, 40, 60, 80, 100, 120, 160, 200, 250]) if (v <= n) return n;
    return Math.ceil(v / 50) * 50;
  }
  const sum = (h) => h.watts.reduce((a, b) => a + b, 0);
  const now = $derived(history.at(-1)?.t ?? Date.now());
  const max = $derived(niceMax(Math.max(0, ...history.map(sum))));
  const x = (t) => m.left + (width - m.left - m.right) * (1 - (now - t) / WINDOW_MS);
  const y = (v) => HEIGHT - m.bottom - (HEIGHT - m.top - m.bottom) * (v / max);

  const areas = $derived.by(() => {
    if (history.length < 2) return [];
    const base = history.map(() => 0);
    return PORTS.map((name, i) => {
      const upper = history.map((h, k) => base[k] + h.watts[i]);
      const line = history.map((h, k) => `${x(h.t).toFixed(1)},${y(upper[k]).toFixed(1)}`);
      const back = history.map((h, k) => `${x(h.t).toFixed(1)},${y(base[k]).toFixed(1)}`).reverse();
      upper.forEach((v, k) => (base[k] = v));
      return { name, points: [...line, ...back].join(" ") };
    });
  });

  function move(e) {
    if (history.length < 2) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    hover = history.reduce((best, h) => (Math.abs(x(h.t) - px) < Math.abs(x(best.t) - px) ? h : best));
  }
  const clock = (t) => new Date(t).toLocaleTimeString();
</script>

<figure class="chart">
  <figcaption><strong>Output power, last two minutes</strong> <span class="muted">(watts, stacked by port)</span></figcaption>
  <div class="legend">
    {#each PORTS as p}<span><i class="swatch" style:background={colors[p]}></i>{p}</span>{/each}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="chart-wrap" bind:clientWidth={width} onpointermove={move} onpointerleave={() => (hover = null)}>
    <svg viewBox={`0 0 ${width} ${HEIGHT}`} height={HEIGHT} role="img" aria-label="Stacked area chart of output power by port">
      {#each [0, 1, 2, 3, 4] as i}
        {@const v = (max * i) / 4}
        <line x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} stroke="var(--line)" />
        <text x={m.left - 6} y={y(v) + 4} text-anchor="end">{v}</text>
      {/each}
      <text x={x(now - WINDOW_MS)} y={HEIGHT - 6} text-anchor="start">2 min ago</text>
      <text x={x(now - WINDOW_MS / 2)} y={HEIGHT - 6} text-anchor="middle">1 min ago</text>
      <text x={x(now)} y={HEIGHT - 6} text-anchor="end">now</text>
      {#each areas as a (a.name)}
        <polygon points={a.points} fill={colors[a.name]} stroke="var(--surface)" stroke-width="2" stroke-linejoin="round" />
      {/each}
      {#if hover}
        <line x1={x(hover.t)} x2={x(hover.t)} y1={m.top} y2={HEIGHT - m.bottom} stroke="var(--text-2)" />
      {/if}
    </svg>
    {#if hover}
      {@const left = x(hover.t) <= width / 2}
      <div class="tip" style:left={left ? `${x(hover.t) + 12}px` : null} style:right={left ? null : `${width - x(hover.t) + 12}px`}>
        <div>{clock(hover.t)}</div>
        {#each PORTS as p, i}<div><i class="swatch" style:background={colors[p]}></i>{p} {hover.watts[i].toFixed(1)} W</div>{/each}
        <div><strong>Total {sum(hover).toFixed(1)} W</strong></div>
      </div>
    {/if}
  </div>
  <details>
    <summary>Show recent readings as a table</summary>
    <table class="numbers">
      <thead><tr><th>Time</th>{#each PORTS as p}<th>{p} (W)</th>{/each}<th>Total (W)</th></tr></thead>
      <tbody>
        {#each history.slice(-10).reverse() as h (h.t)}
          <tr><td>{clock(h.t)}</td>{#each h.watts as w}<td>{w.toFixed(2)}</td>{/each}<td>{sum(h).toFixed(2)}</td></tr>
        {/each}
      </tbody>
    </table>
  </details>
</figure>
