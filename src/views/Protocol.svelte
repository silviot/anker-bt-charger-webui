<script>
  import { charger } from "../lib/charger.svelte.js";
  import { COMMAND_TABLE, STATUS } from "../lib/features.js";
  import { hex } from "../lib/ff09.js";
  import Lab from "../components/Lab.svelte";

  let { sub } = $props();
  const PAGES = [
    ["overview", "Overview"],
    ["handshake", "Handshake"],
    ["frames", "Frames and fields"],
    ["lab", "Frame lab"],
    ["commands", "Commands"],
    ["security", "Security"],
  ];
  const page = $derived(PAGES.some(([id]) => id === sub) ? sub : "overview");

  const STEPS = [
    ["hello", "0x0001", "Hello", "Sends the current time."],
    ["params", "0x0003", "Parameters", "Sends fixed parameter values."],
    ["identity", "0x0029", "Identity", "The reply has the serial number and firmware."],
    ["setup", "0x0005", "Setup", "Sends more fixed values. Their meaning isn't documented."],
    ["keyExchange", "0x0021", "Key exchange", "Each side sends a temporary P-256 public key."],
    ["session", "", "Session key active", "From here, all encrypted frames use the new key."],
  ];
  const reached = $derived(STEPS.findIndex(([id]) => id === charger.step));
  const stepClass = (i) => (i < reached || (i === reached && charger.step === "session") ? "done" : i === reached ? "now" : "");
  const keyRows = $derived(charger.keys ? [
    ["Browser public key", charger.keys.hostPublic],
    ["Charger public key", charger.keys.devicePublic],
    ["Shared secret", charger.keys.shared],
    ["Session key", charger.keys.key],
    ["Session nonce", charger.keys.nonce],
  ] : []);
</script>

<h1>How it works</h1>
<p class="lede-s">For developers who want to learn the protocol. You don't need any of this to use the charger.</p>

<nav class="subnav" aria-label="Protocol topics">
  {#each PAGES as [id, label]}
    <a href={`#/protocol/${id}`} aria-current={id === page ? "page" : undefined}>{label}</a>
  {/each}
</nav>

<section class="prose">
{#if page === "overview"}
  <p>A phone or browser talks to the charger in four layers. Each layer solves one problem.</p>
  <ol class="layers">
    <li><strong>Bluetooth LE</strong><span>Moves bytes. One characteristic for writing, one for notifications.</span></li>
    <li><strong>Frames</strong><span>Mark where a message starts and ends, and which command it is.</span></li>
    <li><strong>AES-GCM</strong><span>Encrypts the handshake and every request. Telemetry replies skip it on the test unit.</span></li>
    <li><strong>TLV fields</strong><span>Label each value inside the body.</span></li>
  </ol>
  <h2>Finding the charger</h2>
  <p>The charger advertises service <code>0xFF09</code> and a name that contains its serial number. No Bluetooth pairing is needed. After connecting, a client uses one GATT service:</p>
  <div class="table-scroll"><table class="plain">
    <tbody>
      <tr><th>Service</th><td><code>8c850001-0302-41c5-b46e-cf057c562025</code></td></tr>
      <tr><th>Write</th><td><code>8c850002-…</code> (write without response)</td></tr>
      <tr><th>Notify</th><td><code>8c850003-…</code> (replies arrive here)</td></tr>
    </tbody>
  </table></div>
  <h2>What it broadcasts</h2>
  <p>Before any connection, the charger advertises its name and this manufacturer data under company ID <code>0xFFFF</code>. It stayed the same during a 25-second scan with all ports idle, and it holds no power readings or settings, so live data needs a connection. The meaning of the bytes marked "probably" is inferred.</p>
  <div class="table-scroll"><table class="plain">
    <thead><tr><th>Bytes</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td><code>02</code></td><td>Not known</td></tr>
      <tr><td><code>7C E9 13 92 9D 99</code></td><td>Bluetooth address</td></tr>
      <tr><td><code>02</code></td><td>Not known</td></tr>
      <tr><td><code>B4 05</code></td><td>Probably the product type: the app lists <code>B405</code> for the A2687</td></tr>
      <tr><td><code>44 4A 56 56</code></td><td>Probably part of the serial: "DJVV"</td></tr>
      <tr><td><code>04</code></td><td>Not known</td></tr>
    </tbody>
  </table></div>
  <p>Then come the <a href="#/protocol/handshake">handshake</a>, and <a href="#/protocol/commands">commands</a> in <a href="#/protocol/frames">frames</a>. To see real traffic, connect and open the <a href="#/protocol/lab">frame lab</a>. The simulator runs the same code, with the real encryption.</p>

{:else if page === "handshake"}
  <p>The first messages use a key that is the same in all units. They exchange identity data, then agree a fresh session key. Connect, and watch the steps change.</p>
  <ol class="steps">
    {#each STEPS as [id, code, name, text], i (id)}
      <li class={stepClass(i)}>{#if code}<code>{code}</code> {/if}<b>{name}</b> <span>{text}</span></li>
    {/each}
  </ol>
  {#if charger.keys}
    <div class="keys">
      <h2>This session's key exchange</h2>
      <dl>
        {#each keyRows as [k, v]}<dt>{k}</dt><dd>{hex(v)}</dd>{/each}
      </dl>
      <p class="muted">These values exist only in this tab and end with the session.</p>
    </div>
  {:else if charger.state === "idle"}
    <div class="row"><button onclick={() => charger.connectSimulator()}>Watch it with the simulator</button></div>
  {/if}
  <p>On the test unit, every step above was needed. Skipping to the key exchange, or sending only identity and key exchange, got no reply to the snapshot request. The key exchange is the slowest step, at about 1.2 seconds.</p>
  <p>The session key is bytes 0–15 of the ECDH shared secret, and the nonce is bytes 16–27. There is no key derivation function.</p>
  <p>Other clients go on to send <code>0x0022</code> (time zone) and <code>0x0027</code> (a 40-character Anker account ID). Those unlock the pushed <code>0x0300</code> stream, according to other projects. This page sends neither: it polls <code>0x0200</code> once per second, and on the test unit settings worked without them. A wrong account ID can stop a lock-screen picture from showing, according to the same projects.</p>

{:else if page === "frames"}
  <p>Every message has the same shape. Multi-byte numbers are little-endian. The last 16 bytes of an encrypted body are the GCM tag. Frames without the encryption flag have no tag.</p>
  <div class="bytes-key">
    <span class="seg magic">FF 09 start</span><span class="seg len">length</span><span class="seg hdr">03 00 fixed</span><span class="seg grp">group</span><span class="seg cmd">flags + command</span><span class="seg ct">encrypted body</span><span class="seg tag">GCM tag</span><span class="seg sum">XOR checksum</span>
  </div>
  <p>The high byte of the command also holds two flags: <code>0x40</code> means encrypted, and <code>0x08</code> means this is a reply. So <code>48 29</code> on the wire is an encrypted reply to command <code>0x0029</code>.</p>
  <p>On the test unit, the charger sends its <code>0x0200</code> replies with no encryption, even after the session key is active.</p>
  <h2>Fields</h2>
  <p>A body is a list of type, length and value items. For example, each port in a snapshot is a 7-byte structure after a type byte:</p>
  <div class="worked">
    <code><span class="seg tag">A7</span> <span class="seg len">08</span> <span class="seg hdr">04</span> <span class="seg grp">01</span> <span class="seg cmd">E0 4E</span> <span class="seg ct">FB 02</span> <span class="seg sum">FE 05</span></code>
    <ul>
      <li><span class="seg tag">A7</span> Port C3 (<code>A5</code> is C1, <code>A6</code> is C2)</li>
      <li><span class="seg len">08</span> 8 bytes follow</li>
      <li><span class="seg hdr">04</span> Value type: raw bytes</li>
      <li><span class="seg grp">01</span> Mode: active (0 means idle)</li>
      <li><span class="seg cmd">E0 4E</span> 0x4EE0 = 20192 mV = <b>20.192 V</b></li>
      <li><span class="seg ct">FB 02</span> 0x02FB = 763 mA = <b>0.763 A</b></li>
      <li><span class="seg sum">FE 05</span> 0x05FE = 1534 centiwatts = <b>15.34 W</b></li>
    </ul>
  </div>
  <p class="muted">That is a real reading from a test A2687.</p>
  <h2>Port control fields</h2>
  <p><code>AC</code>, <code>AD</code> and <code>AE</code> hold each port's control state. This 13-byte layout fits the field list recovered from the app, and it was checked on the test unit by switching a port and setting a timer:</p>
  <div class="table-scroll"><table class="plain">
    <thead><tr><th>Byte</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td>0</td><td>Value type, 04</td></tr>
      <tr><td>1</td><td>Port switch: 1 on, 0 off</td></tr>
      <tr><td>2</td><td>Timer running</td></tr>
      <tr><td>3–6</td><td>Timer length in seconds, u32</td></tr>
      <tr><td>7–10</td><td>Seconds left, u32</td></tr>
      <tr><td>11</td><td>Cable: 0 60 W, 1 100 W, 2 240 W, 3 none</td></tr>
      <tr><td>12</td><td>Fast charging: 1 Apple PD, 2 Samsung, 3 Samsung Super</td></tr>
    </tbody>
  </table></div>

{:else if page === "lab"}
  <Lab />

{:else if page === "commands"}
  <p>All settings use group <code>0x0F</code>. The body starts with <code>A1=21</code> and ends with a timestamp in <code>FE</code>. The first byte of a reply is a result code: <code>00</code> accepted, <code>04</code> bad body, <code>10</code> picture complete, <code>11</code> picture not on the charger, <code>12</code> chunks sent too fast.</p>
  <p><strong>An accepted write doesn't prove anything changed.</strong> The test unit answered <code>00</code> to a picture that doesn't exist. So read the matching field back, as this page does.</p>
  <div class="table-scroll">
    <table class="commands">
      <thead><tr><th>Command</th><th>Purpose</th><th>Body</th><th>Read back from</th><th>Status</th></tr></thead>
      <tbody>
        {#each COMMAND_TABLE as c}
          <tr>
            <td><code>{c.code}</code></td>
            <td>{c.name}</td>
            <td><code>{c.body}</code></td>
            <td>{c.reads}</td>
            <td><span class={`badge ${c.status}`}>{STATUS[c.status]}</span>{#if c.note}<div class="muted">{c.note}</div>{/if}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="muted">"Tested" means an A2687 reported the new value, on firmware v0.0.3.7 and in part v0.0.5.2. "Untested" commands come from analysis of the official app, by the projects credited on the Help page.</p>

{:else}
  <ul class="spaced">
    <li><strong>Anyone in Bluetooth range can read your port data.</strong> The handshake needs no pairing, password or account. It gives voltage, current, power, serial number and firmware.</li>
    <li><strong>Anyone in range can also change settings.</strong> On the test unit, settings and port switches worked with no account ID. So a stranger nearby could probably turn off a port while nobody else is connected. The charger accepts one connection at a time, so staying connected would probably block this, but that's untested.</li>
    <li><strong>The first key is not secret.</strong> It is the same fixed value for every client, and it is public in the credited projects.</li>
    <li><strong>The key exchange has no authentication.</strong> Neither side proves who it is, so an attacker in the middle could likely read and change encrypted traffic. This attack wasn't tested.</li>
    <li><strong>One nonce is used for a whole session.</strong> AES-GCM requires a new nonce for each message. Reusing one weakens its encryption and its tamper detection.</li>
    <li><strong>Telemetry has only a checksum.</strong> On the test unit, <code>0x0200</code> replies are unencrypted, so a change in transit wouldn't be detected.</li>
  </ul>
{/if}
</section>
