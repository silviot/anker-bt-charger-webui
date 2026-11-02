"""Run with python3 -m unittest discover -s test -p '*_test.py'."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("firmware", Path(__file__).resolve().parents[1] / "tools/firmware.py")
firmware = importlib.util.module_from_spec(spec)
spec.loader.exec_module(firmware)


def manifest(raw=b"test image", model="A2687"):
    return {"code": 0, "data": {"update_infos": [{"children": [{
        "device_type": model + "_mcu", "rom_version_name": "v1.2.3.4",
        "full_package": {"file_path": "https://example.com/firmware.bin",
                         "file_size": len(raw), "file_md5": hashlib.md5(raw).hexdigest()}
    }]}]}}


class FirmwareTests(unittest.TestCase):
    def test_target_and_envelope(self):
        self.assertEqual(firmware.packages(manifest())[0]["component"], "A2687_mcu")
        for value in (manifest(model="A2345"), {"code": 401}, {"data": "encrypted"}, []):
            with self.assertRaises(ValueError):
                firmware.packages(value)

    def test_missing_integrity_and_unsafe_names(self):
        for field, value in (("file_size", 0), ("file_size", True), ("file_size", firmware.MAX_IMAGE + 1),
                             ("file_md5", "unknown"), ("file_path", "http://example.com/fw.bin"),
                             ("file_path", "https://user:password@example.com/fw.bin")):
            data = manifest()
            data["data"]["update_infos"][0]["children"][0]["full_package"][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                firmware.packages(data)
        data = manifest()
        data["data"]["update_infos"][0]["children"][0]["device_type"] = "A2687_../../outside"
        with self.assertRaises(ValueError):
            firmware.packages(data)

    def test_conflicting_metadata(self):
        data = manifest()
        record = data["data"]["update_infos"][0]
        other = json.loads(json.dumps(record["children"][0]))
        other["full_package"]["file_md5"] = "0" * 32
        record["children"].append(other)
        with self.assertRaises(ValueError):
            firmware.packages(data)

    def test_whole_package(self):
        data = {"data": {"product_code": "A2687", "version": "v1.2.3.4", "size": 1,
                         "md5": "0" * 32, "url": "https://example.com/all.bin"}}
        self.assertEqual(firmware.packages(data)[0]["component"], "A2687_ALL")

    def test_download_and_integrity_rejection(self):
        raw = b"test image"
        for actual, succeeds in ((raw, True), (b"wrong data", False), (raw + b"x", False)):
            with self.subTest(actual=actual), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                path = root / "manifest.json"
                data = manifest(raw)
                data["data"]["update_infos"][0]["device_sn"] = "PRIVATE_SERIAL"
                path.write_text(json.dumps(data))
                with patch.object(firmware.urllib.request, "build_opener") as opener:
                    opener.return_value.open.return_value = io.BytesIO(actual)
                    if succeeds:
                        result = firmware.fetch(path, root / "out")
                        self.assertEqual((root / "out/A2687_mcu-v1.2.3.4.bin").read_bytes(), raw)
                        self.assertEqual(result["components"][0]["sha256"], hashlib.sha256(raw).hexdigest())
                        self.assertNotIn("PRIVATE_SERIAL", (root / "out/download.json").read_text())
                    else:
                        with self.assertRaises(ValueError):
                            firmware.fetch(path, root / "out")
                        self.assertEqual(list((root / "out").glob("*.bin")), [])

    def test_existing_image_is_verified_and_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / "manifest.json"
            path.write_text(json.dumps(manifest()))
            image = root / "A2687_mcu-v1.2.3.4.bin"
            image.write_bytes(b"do not overwrite")
            with patch.object(firmware.urllib.request, "build_opener") as opener:
                with self.assertRaises(ValueError):
                    firmware.fetch(path, root)
                opener.return_value.open.assert_not_called()
            self.assertEqual(image.read_bytes(), b"do not overwrite")

    def test_binary_triage(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "fixture.bin"
            table = struct.pack("<16I", 0x20001000, 0x08000101, *([0x08000201] * 14))
            path.write_bytes(b"Anker A2687\0".ljust(128, b"\0") + table + b"\0" * 64)
            result = firmware.inspect(path)
            self.assertEqual(result["markers"]["A2687"], [6])
            self.assertEqual(result["cortex_m_vector_candidates"][0]["offset"], 128)
            self.assertFalse(result["architecture_confirmed"])
            path.write_bytes(b"")
            result = firmware.inspect(path)
            self.assertEqual(result["entropy"], 0)
            self.assertEqual(result["cortex_m_vector_candidates"], [])


if __name__ == "__main__":
    unittest.main()
