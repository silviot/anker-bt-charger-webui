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

Custom pictures failed on my firmware: the upload finished, but no picture appeared and the connection dropped. The page turns upload off on firmware that doesn't report a current picture. Pictures are reported to work on v0.0.5.2, which I have not tried. The Help view has the full comparison with the app.

These commands were reverse engineered, so a firmware update could change them. Firmware updates themselves are left out on purpose.

The code and the explanation were largely written by Claude Code, and I did not proofread them line by line.

## Credits

The protocol facts come from people who did the hard work first:

* [LYJW131/anker-prime-desktop](https://github.com/LYJW131/anker-prime-desktop)
* [Hyper-Beast/Anker_Prime_160W_WebBLE](https://github.com/Hyper-Beast/Anker_Prime_160W_WebBLE)
* [gabrieljcs/openankerproto](https://github.com/gabrieljcs/openankerproto)
* [atc1441/Anker_Prime_BLE_hacking](https://github.com/atc1441/Anker_Prime_BLE_hacking)
* [flip-dots/SolixBLE](https://github.com/flip-dots/SolixBLE)

Not affiliated with or endorsed by Anker. Use it only with devices you own.
