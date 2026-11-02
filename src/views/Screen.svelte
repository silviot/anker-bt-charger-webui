<script>
  import { charger } from "../lib/charger.svelte.js";
  import { CMD, crc32, DIRECTIONS, LANGUAGES, requests, SCREEN_OFF, unhex, hex } from "../lib/ff09.js";
  import Gate from "../components/Gate.svelte";
  import Outcome from "../components/Outcome.svelte";

  const STORE = "chrgr-pictures";
  const SIZE = 240;
  const snap = $derived(charger.snapshot);
  let outcome = $state(null);
  let pictureOutcome = $state(null);
  let brightness = $state(null);
  let dragging = $state(false);
  let draft = $state(null); // { url, jpeg, crc, name }
  let progress = $state(null);
  let gallery = $state(load());

  const shownBrightness = $derived(dragging || outcome === "sending" ? brightness : snap?.brightness);
  const pictureKnown = $derived(snap?.pictureId !== null && snap?.pictureId !== undefined);

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) ?? [];
    } catch {
      return [];
    }
  }
  function save() {
    localStorage.setItem(STORE, JSON.stringify(gallery));
  }

  async function set(command, value, field) {
    outcome = "sending";
    outcome = await charger.apply(requests.setting(command, value), (s) => s[field] === value);
  }
  async function commitBrightness() {
    dragging = false;
    await set(CMD.BRIGHTNESS, +brightness, "brightness");
  }

  async function prepare(name, draw) {
    pictureOutcome = null;
    const canvas = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, SIZE, SIZE);
    draw(ctx);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    draft = { url: canvas.toDataURL("image/jpeg", 0.85), jpeg, crc: crc32(jpeg), name };
  }

  // Crops to the middle square, then makes the 240 × 240 JPEG the charger uses.
  async function choose(e) {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    await prepare(file.name, (ctx) => ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE));
  }

  // The default picture: the white logo symbol, centered on black.
  async function useLogo() {
    const img = new Image();
    img.src = "codemyriad-mark.svg";
    await img.decode();
    const width = 170;
    const height = (width * 28) / 36.6;
    await prepare("Codemyriad logo", (ctx) => ctx.drawImage(img, (SIZE - width) / 2, (SIZE - height) / 2, width, height));
  }

  let offered = false;
  $effect(() => {
    if (pictureKnown && !offered) {
      offered = true;
      useLogo();
    }
  });

  const confirmed = (id) => (pictureKnown ? (s) => s.pictureId === (id & 0xffff) : null);

  // The charger can drop the link after an upload. The page reconnects, and a snapshot
  // showing the new id then still counts as proof.
  let pending = $state(null);
  $effect(() => {
    if (pending !== null && snap?.pictureId === (pending & 0xffff)) {
      pending = null;
      pictureOutcome = "confirmed";
    }
  });

  async function send() {
    const { jpeg, crc, name, url } = draft;
    // Ids below 65536 can be confirmed, because the charger reports only the low 16 bits.
    const id = 1000 + Math.floor(Math.random() * 60000);
    pictureOutcome = "sending";
    progress = 0;
    try {
      // The official order: select the new id (the charger answers "not here yet"), then send it.
      await charger.session.write(requests.showPicture(id, crc)).catch(() => {});
      await charger.session.sendPicture(id, crc, jpeg, (done, count) => (progress = done / count));
      pending = id;
      gallery = [{ id, crc, name, url, jpeg: hex(jpeg) }, ...gallery].slice(0, 8);
      save();
      draft = null;
      const result = await charger.apply(requests.showPicture(id, crc), confirmed(id));
      if (result === "no-reply") {
        pictureOutcome = "The upload finished, then the connection dropped. Reconnecting to check it…";
      } else {
        pending = null;
        pictureOutcome = result;
      }
    } catch (e) {
      pictureOutcome = charger.connected ? e.message : "The connection dropped during the upload. Reconnect and try again.";
    } finally {
      progress = null;
    }
  }

  async function show(p) {
    pictureOutcome = "sending";
    const result = await charger.apply(requests.showPicture(p.id, p.crc), confirmed(p.id));
    if (result === "refused") {
      // The charger keeps only four pictures, so an older one may be gone. Send it again.
      progress = 0;
      try {
        await charger.session.sendPicture(p.id, p.crc, unhex(p.jpeg), (done, count) => (progress = done / count));
        pictureOutcome = await charger.apply(requests.showPicture(p.id, p.crc), confirmed(p.id));
      } catch (e) {
        pictureOutcome = e.message;
      } finally {
        progress = null;
      }
    } else {
      pictureOutcome = result;
    }
  }
  function forget(p) {
    gallery = gallery.filter((g) => g.id !== p.id);
    save();
  }
</script>

<h1>Screen</h1>
<p class="lede-s">Change how the charger's small display behaves.</p>

<Gate what="the screen settings">
  <div class="stack">
    <section class="card form">
      <label for="bright">Brightness <strong>{shownBrightness ?? "–"}%</strong></label>
      <input id="bright" type="range" min="0" max="100" step="5" value={shownBrightness ?? 0}
        oninput={(e) => { dragging = true; brightness = e.currentTarget.value; }} onchange={commitBrightness} />

      <label for="lock">Screen turns off after</label>
      <select id="lock" value={snap.screenOff} onchange={(e) => set(CMD.SCREEN_OFF, +e.currentTarget.value, "screenOff")}>
        {#each SCREEN_OFF as text, i}<option value={i}>{text}</option>{/each}
      </select>

      <label for="lang">Language</label>
      <select id="lang" value={snap.language} onchange={(e) => set(CMD.LANGUAGE, +e.currentTarget.value, "language")}>
        {#each LANGUAGES as text, i}<option value={i}>{text}</option>{/each}
      </select>

      <span>Auto-rotate</span>
      <label class="switch">
        <input type="checkbox" role="switch" checked={snap.autoRotate === 1} onchange={(e) => set(CMD.ROTATE, e.currentTarget.checked ? 1 : 0, "autoRotate")} />
        <span>{snap.autoRotate === 1 ? "On" : "Off"}</span>
      </label>

      <span>Direction</span>
      <div>
        <div class="segmented" role="group" aria-label="Screen direction">
          {#each DIRECTIONS as text, i}
            <button aria-pressed={snap.direction === i} onclick={() => set(CMD.DIRECTION, i, "direction")}>{text}</button>
          {/each}
        </div>
        <p class="muted">Choosing a direction also turns auto-rotate off.</p>
      </div>
      <Outcome value={outcome} />
    </section>

    <section class="card">
      <h2>Picture {#if !pictureKnown}<span class="badge warn">Needs newer firmware</span>{/if}</h2>
      <p>Show your own picture on the charger's lock screen. It holds four pictures, so a new one replaces an older one. The charger may disconnect after an upload, and this page then reconnects by itself.</p>
      {#if !pictureKnown}
        <p class="notice">Your charger's firmware doesn't support this as far as I can tell, so upload is turned off. On v0.0.3.7, a full upload finished but no picture appeared, and the connection dropped. Pictures upload on v0.0.5.2. You can update the firmware in the Anker app, but other features here haven't been tested on newer firmware.</p>
      {/if}
      {#if pictureKnown}
        <div class="row">
          <label class="file">Choose your own <input type="file" accept="image/*" onchange={choose} /></label>
          <button onclick={useLogo}>Use the Codemyriad logo</button>
          <span class="muted">Your own picture is cropped to its middle square.</span>
        </div>
        {#if draft}
          <div class="row">
            <img class="thumb" src={draft.url} alt="Cropped preview" width="120" height="120" />
            <button class="primary" disabled={progress !== null} onclick={send}>Send to charger</button>
          </div>
        {/if}
        {#if progress !== null}
          <progress value={progress} max="1" aria-label="Sending picture"></progress>
        {/if}
        <Outcome value={pictureOutcome} />
        {#if gallery.length}
          <h3>Sent from this browser</h3>
          <ul class="gallery">
            {#each gallery as p (p.id)}
              <li>
                <button class="pic" aria-pressed={snap.pictureId === p.id} aria-label={`Show ${p.name}`} disabled={progress !== null} onclick={() => show(p)}><img src={p.url} alt="" width="96" height="96" /></button>
                <button class="link" onclick={() => forget(p)}>Forget</button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  </div>
</Gate>
