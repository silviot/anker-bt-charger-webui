# Anker Prime 160W charger, in your browser

I have an Anker Prime 160W charger (A2687) with Bluetooth, and I wanted to use it without installing an app or creating an account.

This page connects to the charger from the browser. You can watch live power per port, switch ports off, set timers, and change the charging and screen settings. If you're a developer, the "How it works" view explains the protocol byte by byte.

**Try it: <https://silvio-chrgr.pgs.sh>**

No charger? Click "Try the simulator". It runs the same protocol code.

## Using it with a real charger

You need Chrome or Edge on a desktop computer (Web Bluetooth). Quit the Anker app first, then click "Connect to charger".

On Linux, you may have to enable `chrome://flags/#enable-experimental-web-platform-features`.

## Running it locally

```bash
npm install
npm run dev      # then open the URL it prints
npm test         # protocol tests
npm run build    # static site in dist/
```

## How much to trust this

One data point: I tested it on my own charger only (firmware v0.0.3.7). On it, port switches, timers and screen settings all worked, with the new value read back from the charger. None of them needed pairing or an account ID (which also means anyone in Bluetooth range can probably do the same).

These are not tested, because they could interrupt charging: charging modes, fixed power sharing and custom mode. They come from other people's analysis of the official app, and the page says so next to each one.

Custom pictures failed on v0.0.3.7: the upload finished, but no picture appeared and the connection dropped. The page turns upload off on firmware that doesn't report a current picture. After I updated to v0.0.5.2, the charger reports the new picture, though it may still drop the connection afterwards. Screen brightness, port switches and timers also work on v0.0.5.2. The Help view has the full comparison with the app.

These commands were reverse engineered, so a firmware update could change them. Firmware updates themselves are left out on purpose.

The code and the explanation were largely written by Claude Code, and I did not proofread them line by line.

## Firmware investigation

The A2687 firmware image has **not been obtained or disassembled**. The
[investigation record](research/firmware/findings.json) preserves sources,
download checks and their limitations. The documented single-product OTA URL
returned HTTP 401 (`token error`) without authentication. The official app APK
downloaded during the investigation contained no identified charger firmware.
The public GD32F303/TLSR8253 backups in the older BLE hacking project belong to
a different power bank.

The [Anker Power 3.25.0 APK investigation](research/firmware/apk-3.25.0.json)
also covers its separate Flutter asset pack and 102 nested archives (7,128
files in total). Its APK signatures match the older official download. No
A2687 firmware image was identified. Disassembly shows that the A2687 update
controller queries cloud metadata; the shared BLE updater downloads a URL
from that response. Its `App.bin` reference names a file created in the app's
documents directory. This supports downloading firmware at runtime, although
it does not exclude a hidden image in protected code or another regional build.

The [A2687 teardown](https://www.chargerlab.com/teardown-of-anker-prime-160w-charger-with-smart-display-a2687/)
identifies an HC32F452 Cortex-M4 on the display board, an AB2026B3 RISC-V
Bluetooth SoC and 16 MiB of external NOR flash. It also has TI C28x power
control and Cortex-M0 port controllers. Which components an OTA package updates
is still unknown. The Bluetooth version and main application version must be
kept separate.

To continue, obtain the A2687 binary or a decoded update metadata response from
the official app/account. An Android phone's existing download cache is another
possible source; USB debugging alone does not guarantee access to private app
files. Checking for an update and installing one are separate actions.

The standalone Python tool downloads packages from captured metadata and
performs offline binary triage. It does not connect to Bluetooth or install
firmware, and needs only Python's standard library:

```bash
# Read a decoded batch OTA response or single-product response from a local file.
# Only packages explicitly labelled A2687 are selected; size and MD5 are required.
python3 tools/firmware.py fetch /absolute/path/update.json

# Inspect any acquired image: hashes, strings with offsets, entropy, known
# crypto constants and possible Cortex-M vector tables. This is initial triage,
# not disassembly, decryption, signature verification or proof of product identity.
python3 tools/firmware.py inspect /absolute/path/firmware.bin --output /tmp/firmware-analysis.json

python3 -m unittest discover -s test -p '*_test.py'
```

Store original manifests in `research/firmware/private/` and downloaded files in
`research/firmware/downloads/`; both directories are ignored by Git. The download
ledger omits the account serial and records SHA-256 alongside the supplied MD5.
Matching MD5 establishes agreement with the metadata; publisher authentication
remains unverified. Vector and magic matches are analysis leads and do not
establish the processor or memory map.

## Credits

The protocol facts come from people who did the hard work first:

* [LYJW131/anker-prime-desktop](https://github.com/LYJW131/anker-prime-desktop)
* [Hyper-Beast/Anker_Prime_160W_WebBLE](https://github.com/Hyper-Beast/Anker_Prime_160W_WebBLE)
* [gabrieljcs/openankerproto](https://github.com/gabrieljcs/openankerproto)
* [atc1441/Anker_Prime_BLE_hacking](https://github.com/atc1441/Anker_Prime_BLE_hacking)
* [flip-dots/SolixBLE](https://github.com/flip-dots/SolixBLE)

Not affiliated with or endorsed by Anker. Use it only with devices you own.
