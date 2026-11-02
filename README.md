# Anker Prime 160W charger, in your browser

I have an Anker Prime 160W charger (A2687) with Bluetooth, and I wanted to see what it says without installing an app or creating an account.

This page connects to the charger from the browser, shows live power for each port, and explains the protocol byte by byte.

**Try it: <https://silvio-chrgr.pgs.sh>**

No charger? Click "Use simulated charger". It runs the same protocol code.

## Using it with a real charger

You need Chrome or Edge on a desktop computer (Web Bluetooth). Quit the Anker app first, then click "Connect to charger".

On Linux, you may have to enable `chrome://flags/#enable-experimental-web-platform-features`.

The page is read-only. It sends only `0x0001`, `0x0003`, `0x0029`, `0x0005`, `0x0021` and `0x0200`: no settings, no time zone, no account ID.

## Running it locally

There is nothing to build or install:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
node test.mjs                 # run the tests
```

## How much to trust this

One data point: I tested it on my own charger only (firmware v0.0.3.7). On this unit, port data needs no pairing or account ID, and the replies aren't encrypted. Other units and firmware versions may behave differently.

The code and the explanation were largely written by Claude Code, and I did not proofread them line by line. It does work with my charger, though.

## Credits

The protocol facts come from people who did the hard work first:

* [LYJW131/anker-prime-desktop](https://github.com/LYJW131/anker-prime-desktop)
* [Hyper-Beast/Anker_Prime_160W_WebBLE](https://github.com/Hyper-Beast/Anker_Prime_160W_WebBLE)
* [gabrieljcs/openankerproto](https://github.com/gabrieljcs/openankerproto)
* [atc1441/Anker_Prime_BLE_hacking](https://github.com/atc1441/Anker_Prime_BLE_hacking)
* [flip-dots/SolixBLE](https://github.com/flip-dots/SolixBLE)

Not affiliated with or endorsed by Anker. Use it only with devices you own.
