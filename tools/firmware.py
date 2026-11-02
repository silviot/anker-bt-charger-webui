#!/usr/bin/env python3
"""Download captured A2687 OTA packages, or inspect an image offline. Never flashes."""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import urllib.parse
import urllib.request

MAX_IMAGE = 128 * 1024 * 1024
MODEL = "A2687"


def digest(data):
    return {name: hashlib.new(name, data).hexdigest() for name in ("md5", "sha256")}


def entropy(data):
    if not data:
        return 0.0
    return round(-sum((n / len(data)) * math.log2(n / len(data))
                      for n in Counter(data).values()), 4)


def packages(manifest):
    """Accept the decrypted batch response or a single product update response."""
    if not isinstance(manifest, dict):
        raise ValueError("Expected a decoded JSON object")
    if manifest.get("code", 0) != 0:
        raise ValueError("The manifest contains an API error")
    data = manifest.get("data", manifest)
    if not isinstance(data, dict):
        raise ValueError("Expected decoded metadata; encrypted responses cannot be used")
    records = data.get("update_infos", [data])
    if not isinstance(records, list):
        raise ValueError("Invalid update_infos")
    found = []
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Invalid update record")
        for child in record.get("children", []):
            component = child.get("device_type", "")
            if component != MODEL and not component.startswith(MODEL + "_"):
                continue
            full = child.get("full_package") or {}
            found.append(dict(component=component, version=child.get("rom_version_name"),
                              url=full.get("file_path"), bytes=full.get("file_size"),
                              md5=full.get("file_md5")))
        main = record.get("lastPackage", record)
        if main.get("product_code") == MODEL and main.get("url"):
            found.append(dict(component=MODEL + "_ALL", version=main.get("version"),
                              url=main.get("url"), bytes=main.get("size"), md5=main.get("md5")))
    if not found:
        raise ValueError("No explicitly targeted A2687 packages in this metadata")
    unique = {}
    for item in found:
        url = urllib.parse.urlsplit(item.get("url") or "")
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("Package URLs must be HTTPS without embedded credentials")
        if not isinstance(item["bytes"], int) or isinstance(item["bytes"], bool) or not 0 < item["bytes"] <= MAX_IMAGE:
            raise ValueError("Missing or invalid package byte count")
        if not re.fullmatch(r"[0-9a-fA-F]{32}", item.get("md5") or ""):
            raise ValueError("Missing or invalid package MD5")
        if not re.fullmatch(r"v?\d+(?:\.\d+){1,5}", item.get("version") or ""):
            raise ValueError("Missing or invalid package version")
        if not re.fullmatch(r"A2687(?:_[A-Za-z0-9_-]+)?", item["component"]):
            raise ValueError("Invalid component name")
        key = (item["component"], item["version"])
        if key in unique and unique[key] != item:
            raise ValueError("Conflicting packages for the same component and version")
        unique[key] = item
    return list(unique.values())


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("Refusing a redirect away from HTTPS")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(manifest_path, destination):
    manifest_bytes = manifest_path.read_bytes()
    items = packages(json.loads(manifest_bytes))  # Validate every entry before downloading.
    destination.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(HTTPSOnly())
    results = []
    for item in items:
        name = f"{item['component']}-{item['version']}.bin"
        target = destination / name
        if target.exists():
            raw = target.read_bytes()
        else:
            with opener.open(item["url"], timeout=30) as response:
                raw = response.read(item["bytes"] + 1)
        hashes = digest(raw)
        if len(raw) != item["bytes"] or hashes["md5"] != item["md5"].lower():
            raise ValueError(f"Size/MD5 mismatch for {name}; image was not saved")
        if not target.exists():
            with target.open("xb") as out:
                out.write(raw)
        results.append({**item, **hashes, "file": name})
    result = {"model": MODEL, "manifest_sha256": digest(manifest_bytes)["sha256"],
              "components": results, "publisher_signature_verified": False}
    # The original response can contain a serial; it is not copied into this ledger.
    (destination / "download.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def inspect(path):
    if path.stat().st_size > MAX_IMAGE:
        raise ValueError("Image exceeds the 128 MiB inspection limit")
    raw = path.read_bytes()
    strings = [{"offset": m.start(), "text": m.group().decode("ascii")}
               for m in re.finditer(rb"[\x20-\x7e]{6,}", raw)]
    vectors = []
    # Heuristic only: Cortex-M SP in SRAM, Thumb reset handler, and a plausible
    # exception table. The A2687 also contains processors that are not Cortex-M.
    for off in range(0, len(raw) - 64 + 1, 4):
        sp, reset, *handlers = struct.unpack_from("<16I", raw, off)
        if not (0x1FFF0000 <= sp <= 0x20080000 and sp % 8 == 0 and reset & 1):
            continue
        # Count handlers close to reset, rather than assuming a flash load base.
        valid = sum(v == 0 or (v & 1 and abs(v - reset) < MAX_IMAGE) for v in handlers)
        if valid >= 12 and reset < 0x20000000:
            vectors.append({"offset": off, "initial_sp": hex(sp),
                            "reset_handler": hex(reset), "plausible_exceptions": valid})
    markers = {}
    for name, value in {
        "Anker": b"Anker", "A2687": b"A2687", "ELF": b"\x7fELF",
        "ZIP": b"PK\x03\x04", "gzip": b"\x1f\x8b\x08",
        "GCM_initial_key": bytes.fromhex("b8ff7422955d4eb6d554a2c470280559"),
        "GCM_initial_nonce": bytes.fromhex("6ba3e3f2f3a60f2971ce5d1f"),
        "GCM_AAD": bytes.fromhex("3322110077665544bbaa9988ffeeddcc"),
    }.items():
        hits, start = [], 0
        while (start := raw.find(value, start)) != -1:
            hits.append(start)
            start += 1
        if hits:
            markers[name] = hits
    return {"file": path.name, "bytes": len(raw), **digest(raw),
            "first_128_bytes": raw[:128].hex(" "), "entropy": entropy(raw),
            "entropy_4k": [{"offset": i, "entropy": entropy(raw[i:i + 4096])}
                           for i in range(0, len(raw), 4096)],
            "markers": markers, "cortex_m_vector_candidates": vectors,
            "strings": strings, "architecture_confirmed": False,
            "notes": ["Offsets are file offsets, not runtime addresses.",
                      "Magic, strings, entropy and vector candidates are leads, not proof of product targeting, encryption or authenticity.",
                      "A missing key marker does not establish that the key is absent from running firmware."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    download = commands.add_parser("fetch", help="Download from a captured, decoded OTA response")
    download.add_argument("manifest", type=Path)
    download.add_argument("--directory", type=Path, default=Path("research/firmware/downloads"))
    analyze = commands.add_parser("inspect", help="Offline binary triage; does not contact the charger")
    analyze.add_argument("image", type=Path)
    analyze.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = fetch(args.manifest, args.directory) if args.command == "fetch" else inspect(args.image)
        output = json.dumps(result, indent=2) + "\n"
        if args.command == "inspect" and args.output:
            args.output.write_text(output)
            print(f"Wrote {args.output}: {result['bytes']} bytes, SHA-256 {result['sha256']}")
        else:
            print(output, end="")
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        parser.exit(1, f"firmware: {exc}\n")


if __name__ == "__main__":
    main()
