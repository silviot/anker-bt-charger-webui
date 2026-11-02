<script>
  import { APP_FEATURES, STATUS } from "../lib/features.js";
</script>

<h1>Help</h1>

<section class="prose">
  <h2>If connecting fails</h2>
  <ul>
    <li>Use Chrome, Edge or another Chromium browser on a computer. Firefox and Safari don't support Web Bluetooth.</li>
    <li>Fully quit the Anker app on your phone, or turn off the phone's Bluetooth. The charger takes one connection at a time.</li>
    <li>On Linux, if the browser says Web Bluetooth is unavailable, enable <code>chrome://flags/#enable-experimental-web-platform-features</code>.</li>
    <li>On Linux, if scans find nothing and the kernel log shows <code>Opcode 0x2041 failed: -16</code>, restart the adapter with <code>bluetoothctl power off</code>, then <code>bluetoothctl power on</code>.</li>
  </ul>

  <h2>Is this safe to use?</h2>
  <p>Viewing power changes nothing. The Ports, Charging and Screen views do change your charger, and they use commands that were reverse engineered, not published by Anker. Anker could change them in any firmware update. This page never sends firmware, and it asks first before cutting power to a device or changing how the charger charges.</p>
  <p>It only says a change worked if the charger then reports the new value. Otherwise it tells you it can't confirm the change.</p>

  <h2>Compared with the Anker app</h2>
  <p>"Tested" means an A2687 on firmware v0.0.3.7 reported the new value after the change. Other firmware may behave differently.</p>
  <div class="table-scroll">
    <table>
      <thead><tr><th>Feature</th><th>Here</th><th>Status</th></tr></thead>
      <tbody>
        {#each APP_FEATURES as f}
          <tr>
            <td>{f.name}{#if f.note}<div class="muted">{f.note}</div>{/if}</td>
            <td>{#if f.where}{f.where}{:else}–{/if}</td>
            <td><span class={`badge ${f.status}`}>{STATUS[f.status]}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <h2>Credits</h2>
  <p>Other people did the reverse engineering. This page is a new implementation of what they documented, plus some field mapping on one charger. It was largely written by Claude Code.</p>
  <ul>
    <li><a href="https://github.com/LYJW131/anker-prime-desktop">LYJW131/anker-prime-desktop</a>: handshake, field maps, pictures and request vectors</li>
    <li><a href="https://github.com/Hyper-Beast/Anker_Prime_160W_WebBLE">Hyper-Beast/Anker_Prime_160W_WebBLE</a>: A2687 client and notes on the official app</li>
    <li><a href="https://github.com/qzz0518/Charker">qzz0518/Charker</a>: full macOS and Windows app</li>
    <li><a href="https://github.com/gabrieljcs/openankerproto">gabrieljcs/openankerproto</a>: protocol reference across models</li>
    <li><a href="https://github.com/atc1441/Anker_Prime_BLE_hacking">atc1441/Anker_Prime_BLE_hacking</a> and <a href="https://github.com/flip-dots/SolixBLE">flip-dots/SolixBLE</a>: earlier research</li>
  </ul>
</section>
