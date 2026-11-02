// What was checked on real hardware, in one place. "tested" means an A2687 on firmware v0.0.3.7 or v0.0.5.2
// reported the new value after the write. Keep this honest: it is shown to readers.

export const STATUS = {
  tested: "Tested",
  partial: "Partly tested",
  reported: "Reported by others",
  inferred: "Untested",
  missing: "Not here",
};

export const COMMAND_TABLE = [
  { code: "0x0200", name: "Status snapshot", body: "A1=21, FE=time", reads: "All fields", status: "tested" },
  { code: "0x0204", name: "Brightness", body: "A2=01 percent", reads: "A9", status: "tested" },
  { code: "0x0203", name: "Screen lock time", body: "A2=01 0..4", reads: "A8", status: "tested" },
  { code: "0x0202", name: "Language", body: "A2=01 0..3", reads: "B0", status: "tested" },
  { code: "0x020B", name: "Direction", body: "A2=01 0..3", reads: "AF, also clears B2", status: "tested" },
  { code: "0x020D", name: "Auto-rotate", body: "A2=01 0..1", reads: "B2", status: "tested" },
  { code: "0x0207", name: "Port on or off", body: "A2=01 port, A3=01 0..1", reads: "AC to AE, byte 1", status: "tested" },
  { code: "0x0209", name: "Port timer", body: "A2=01 port, A3=04 seconds u32", reads: "AC to AE, bytes 2 to 10", status: "tested" },
  { code: "0x0206", name: "Charging mode", body: "A2=01 mode", reads: "AA (likely)", status: "inferred" },
  { code: "0x0206", name: "Custom mode", body: "A2=01 04, A3=04 power, A4=04 masks", reads: "AA (likely)", status: "inferred" },
  { code: "0x0205", name: "Fixed power sharing", body: "A2=01 0..1", reads: "Not known", status: "inferred" },
  { code: "0x020F", name: "Device identification", body: "A2=01 0..1", reads: "Not known", status: "partial", note: "No reply on v0.0.3.7" },
  { code: "0x021F", name: "Show picture", body: "A3=01 03, A4=04 id, A5=04 crc, FD, FE", reads: "E1", status: "reported", note: "v0.0.3.7 has no E1 and answers 00 anyway" },
  { code: "0x0220", name: "Start picture transfer", body: "id, crc, size, chunk size, count", reads: "Result byte", status: "reported", note: "On v0.0.3.7, a full transfer showed no picture and the link dropped" },
  { code: "0x0221", name: "Picture chunk", body: "A2=02 index, A3=04 156 bytes", reads: "Result byte", status: "reported" },
  { code: "0x020C", name: "Port history", body: "A2=01 00", reads: "Multi-part reply", status: "partial", note: "Replies, but the layout isn't worked out" },
];

export const APP_FEATURES = [
  { name: "Live power, volts and amps per port", status: "tested", where: "Live" },
  { name: "Cable capability and fast-charging type", status: "tested", where: "Ports", note: "Needs a cable attached that reports it" },
  { name: "Attached device name", status: "reported", where: "Ports", note: "Brand only. Your firmware doesn't send this field" },
  { name: "Turn a port on or off", status: "tested", where: "Ports" },
  { name: "Port timer", status: "tested", where: "Ports" },
  { name: "Brightness, lock time, language, direction, auto-rotate", status: "tested", where: "Screen" },
  { name: "Smart and standard charging modes", status: "inferred", where: "Charging" },
  { name: "Fixed power sharing", status: "inferred", where: "Charging" },
  { name: "Custom charging mode", status: "inferred", where: "Charging", note: "Behind a warning. The format is inferred" },
  { name: "Device identification", status: "partial", where: "Charging", note: "No reply on v0.0.3.7" },
  { name: "Custom lock-screen pictures", status: "partial", where: "Screen", note: "Off on v0.0.3.7, where it failed. On v0.0.5.2 the charger reports the new picture, but it may drop the connection afterwards. Stored in this browser, not in Anker's cloud" },
  { name: "Over-temperature and port fault warnings", status: "reported", where: "All views", note: "Never triggered here. The report layout isn't known, so the warning is generic" },
  { name: "Power history stored on the charger", status: "missing", note: "It replies, but the layout isn't worked out. This page charts its own two minutes instead" },
  { name: "Per-port protocol management", status: "missing", note: "The app gets this data from Anker's cloud" },
  { name: "Firmware updates", status: "missing", note: "Left out on purpose, because a failed update could break the charger. Use the Anker app" },
  { name: "Anker account and cloud pictures", status: "missing", note: "Left out on purpose. Nothing here needs an account" },
];
