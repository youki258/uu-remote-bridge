var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// cli.ts
var cli_exports = {};
__export(cli_exports, {
  CLI_FILE_NAME: () => CLI_FILE_NAME,
  CLOUDPC_STATUS_NAMES: () => CLOUDPC_STATUS_NAMES,
  CliError: () => CliError,
  LOCAL_SHELLS: () => LOCAL_SHELLS,
  REMOTE_SHELLS: () => REMOTE_SHELLS,
  candidateCliPaths: () => candidateCliPaths,
  cloudPcStatusName: () => cloudPcStatusName,
  echo: () => echo,
  execCli: () => execCli,
  execCliJson: () => execCliJson,
  execCliText: () => execCliText,
  firstErrorLine: () => firstErrorLine,
  friendlyResult: () => friendlyResult,
  getDeviceStatus: () => getDeviceStatus,
  getLocalDeviceId: () => getLocalDeviceId,
  getUserInfo: () => getUserInfo,
  getVersion: () => getVersion,
  getWallet: () => getWallet,
  isValidShell: () => isValidShell,
  launchMainApp: () => launchMainApp,
  listCloudPCs: () => listCloudPCs,
  listDevices: () => listDevices,
  listLtermSessions: () => listLtermSessions,
  looksLikeError: () => looksLikeError,
  parseLtermLs: () => parseLtermLs,
  parseTermSessions: () => parseTermSessions,
  platformName: () => platformName,
  resetCustomCode: () => resetCustomCode,
  resolveCliPath: () => resolveCliPath,
  setBitrateLimit: () => setBitrateLimit,
  setLitePunch: () => setLitePunch,
  stripAnsi: () => stripAnsi,
  tryParseJson: () => tryParseJson
});
function stripAnsi(s) {
  return s.replace(ANSI_RE, "");
}
function candidateCliPaths() {
  const candidates = [];
  const drives = process.platform === "win32" ? ["C:", "D:", "E:"] : [];
  for (const drive of drives) {
    for (const pf of ["Program Files", "Program Files (x86)"]) {
      candidates.push((0, import_path.join)(drive, "\\", pf, "Netease", "GameViewer", "bin", CLI_FILE_NAME));
    }
  }
  const local = process.env["LOCALAPPDATA"];
  if (local) {
    candidates.push((0, import_path.join)(local, "Netease", "GameViewer", "bin", CLI_FILE_NAME));
  }
  const home = process.env["HOME"] ?? process.env["USERPROFILE"];
  if (home) {
    candidates.push((0, import_path.join)("/Applications", "UU\u8FDC\u7A0B.app", "Contents", "MacOS", CLI_FILE_NAME));
    candidates.push((0, import_path.join)("/Applications", "GameViewer.app", "Contents", "MacOS", CLI_FILE_NAME));
    candidates.push((0, import_path.join)(home, "Applications", "UU\u8FDC\u7A0B.app", "Contents", "MacOS", CLI_FILE_NAME));
    candidates.push((0, import_path.join)("/usr/local/bin", CLI_FILE_NAME));
    candidates.push((0, import_path.join)("/opt/homebrew/bin", CLI_FILE_NAME));
    candidates.push((0, import_path.join)(home, ".local", "bin", CLI_FILE_NAME));
    candidates.push((0, import_path.join)(home, "bin", CLI_FILE_NAME));
  }
  return candidates;
}
function whereCli() {
  const finder = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    (0, import_child_process.execFile)(finder, [CLI_FILE_NAME], { timeout: 3e3 }, (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      resolve(
        stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      );
    });
  });
}
async function resolveCliPath(configured) {
  if (configured && configured.trim()) {
    const p = configured.trim();
    if ((0, import_fs.existsSync)(p)) {
      return p;
    }
    throw new CliError(`\u914D\u7F6E\u7684 uu.cliPath \u4E0D\u5B58\u5728:${p}`);
  }
  for (const p of candidateCliPaths()) {
    if ((0, import_fs.existsSync)(p)) {
      return p;
    }
  }
  for (const p of await whereCli()) {
    if ((0, import_fs.existsSync)(p)) {
      return p;
    }
  }
  throw new CliError(
    '\u672A\u627E\u5230 uuyc-cli\u3002\u8BF7\u786E\u8BA4\u5DF2\u5B89\u88C5 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F,\u6216\u5728\u8BBE\u7F6E "uu.cliPath" \u4E2D\u6307\u5B9A CLI \u5B8C\u6574\u8DEF\u5F84(\u901A\u5E38\u4F4D\u4E8E UU\u8FDC\u7A0B\u5B89\u88C5\u76EE\u5F55\u7684 bin\\uuyc-cli.exe)\u3002'
  );
}
async function execCli(cliPath2, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15e3;
  return new Promise((resolve, reject) => {
    const child = (0, import_child_process.spawn)(cliPath2, args, { windowsHide: true });
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill();
        settled = true;
        reject(new CliError(`\u547D\u4EE4\u8D85\u65F6(${timeoutMs}ms):${args.join(" ")}`));
      }
    }, timeoutMs);
    child.stdout?.on("data", (d) => stdoutChunks.push(d));
    child.stderr?.on("data", (d) => stderrChunks.push(d));
    child.on("error", (e) => {
      if (!settled) {
        clearTimeout(timer);
        settled = true;
        reject(new CliError(`\u65E0\u6CD5\u542F\u52A8 CLI:${e.message}`));
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        clearTimeout(timer);
        settled = true;
        const stdout = stripAnsi(Buffer.concat(stdoutChunks).toString("utf8")).trim();
        const stderr = stripAnsi(Buffer.concat(stderrChunks).toString("utf8")).trim();
        resolve({ stdout, stderr, code: code ?? -1 });
      }
    });
  });
}
function firstErrorLine(r) {
  for (const text of [r.stderr, r.stdout]) {
    const m = text.match(/(?:^|\r?\n)\s*Error:\s*(.+)/);
    if (m) {
      return m[1].trim();
    }
  }
  if (r.stderr) {
    return r.stderr.split(/\r?\n/)[0].trim();
  }
  return r.stdout.split(/\r?\n/)[0].trim() || `\u9000\u51FA\u7801 ${r.code}`;
}
function looksLikeError(r) {
  if (r.code !== 0) {
    return true;
  }
  const errRe = /(?:^|\r?\n)\s*Error:/;
  return errRe.test(r.stderr) || errRe.test(r.stdout);
}
function toCliError(r) {
  return new CliError(firstErrorLine(r), r.stdout, r.stderr, r.code ?? void 0);
}
function tryParseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return void 0;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
  }
  const start = trimmed.indexOf("{");
  if (start < 0) {
    return void 0;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return void 0;
        }
      }
    }
  }
  return void 0;
}
async function execCliText(cliPath2, args, opts = {}) {
  const r = await execCli(cliPath2, args, opts);
  if (looksLikeError(r)) {
    throw toCliError(r);
  }
  return r.stdout;
}
async function execCliJson(cliPath2, args, opts = {}) {
  const r = await execCli(cliPath2, args, opts);
  if (looksLikeError(r)) {
    throw toCliError(r);
  }
  const obj = tryParseJson(r.stdout);
  if (obj === void 0 || typeof obj !== "object" || obj === null) {
    throw new CliError(`CLI \u8F93\u51FA\u4E0D\u662F\u5408\u6CD5 JSON:${r.stdout.split(/\r?\n/)[0] || "(\u7A7A)"}`);
  }
  return obj;
}
function friendlyResult(stdout) {
  const obj = tryParseJson(stdout);
  if (obj && typeof obj === "object" && "success" in obj) {
    const success = obj.success;
    if (success === true) {
      return "\u64CD\u4F5C\u6210\u529F";
    }
    if (success === false) {
      return `\u64CD\u4F5C\u5931\u8D25:${stdout.split(/\r?\n/)[0]}`;
    }
  }
  return stdout.split(/\r?\n/).filter(Boolean).join("\n");
}
async function listDevices(cliPath2) {
  const env = await execCliJson(cliPath2, ["device", "list"]);
  return env.data?.devices ?? [];
}
async function getDeviceStatus(cliPath2) {
  const env = await execCliJson(cliPath2, ["device", "status"]);
  const raw = env.data?.connected_devices ?? env.data?.connections ?? [];
  const list = [];
  for (const c of raw) {
    const rec = c;
    const targetId = String(rec["targetId"] ?? rec["deviceId"] ?? rec["id"] ?? "");
    const targetName = String(rec["targetName"] ?? rec["deviceName"] ?? rec["name"] ?? "");
    if (targetId || targetName) {
      list.push({ targetId, targetName });
    }
  }
  return list;
}
async function listCloudPCs(cliPath2) {
  const env = await execCliJson(cliPath2, ["cloudpc", "list"]);
  return env.data?.cloudPCs ?? [];
}
async function getUserInfo(cliPath2) {
  const env = await execCliJson(cliPath2, ["user", "info"]);
  if (!env.data?.userId) {
    throw new CliError("\u672A\u83B7\u53D6\u5230\u7528\u6237\u4FE1\u606F,\u53EF\u80FD\u5C1A\u672A\u767B\u5F55 UU\u8FDC\u7A0B\u4E3B\u5E94\u7528\u3002");
  }
  return env.data;
}
async function getWallet(cliPath2) {
  const env = await execCliJson(cliPath2, ["user", "wallet"]);
  return env.data ?? { coinBalance: 0 };
}
async function getVersion(cliPath2) {
  return execCliText(cliPath2, ["--version"]);
}
async function getLocalDeviceId(cliPath2) {
  try {
    const id = await execCliText(cliPath2, ["-d"]);
    if (id.trim()) {
      return id.trim();
    }
  } catch (e) {
    if (e instanceof CliError && /unknown option|unexpected argument/i.test(`${e.message} ${e.stderr}`)) {
      const env = await execCliJson(cliPath2, ["assist", "id"]);
      const id = env.data?.deviceId;
      if (id && id.trim()) {
        return id.trim();
      }
    }
    throw e;
  }
  throw new CliError("\u672A\u80FD\u83B7\u53D6\u672C\u673A\u8BBE\u5907 ID");
}
async function resetCustomCode(cliPath2, code) {
  const r = await execCli(cliPath2, ["--reset-custom-code", code]);
  if (looksLikeError(r)) {
    const err = firstErrorLine(r) + r.stderr;
    if (/unknown option|unexpected argument/i.test(err)) {
      const r2 = await execCli(cliPath2, ["assist", "set-code", code]);
      if (looksLikeError(r2)) {
        return Promise.reject(toCliError(r2));
      }
      return friendlyResult(r2.stdout);
    }
    return Promise.reject(toCliError(r));
  }
  return friendlyResult(r.stdout);
}
async function setBitrateLimit(cliPath2, mbps) {
  const r = await execCli(cliPath2, ["--set-bitrate-limit", String(mbps)]);
  return looksLikeError(r) ? Promise.reject(toCliError(r)) : friendlyResult(r.stdout);
}
async function setLitePunch(cliPath2, disabled) {
  const r = await execCli(cliPath2, ["--disable-lite-punch", disabled ? "true" : "false"]);
  return looksLikeError(r) ? Promise.reject(toCliError(r)) : friendlyResult(r.stdout);
}
async function echo(cliPath2, message) {
  const text = await execCliText(cliPath2, ["echo", message]);
  const obj = tryParseJson(text);
  if (obj && typeof obj === "object") {
    const msg = obj.data?.message;
    if (typeof msg === "string" && msg) {
      return msg.replace(/^echo:\s*/i, "");
    }
  }
  return text.replace(/^echo:\s*/i, "");
}
function parseLtermLs(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0 || !/^NAME\b/.test(lines[0].trim())) {
    return [];
  }
  const sessions = [];
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 2) {
      continue;
    }
    const createdAt = cols.length >= 4 ? Number(cols[cols.length - 1]) : NaN;
    sessions.push({
      name: cols[0],
      shell: cols[1] ?? "",
      state: cols[2] ?? "",
      createdAtMs: Number.isFinite(createdAt) ? createdAt : void 0,
      raw: line.trim()
    });
  }
  return sessions;
}
async function listLtermSessions(cliPath2) {
  const text = await execCliText(cliPath2, ["lterm", "ls"]);
  const fromTsv = parseLtermLs(text);
  if (fromTsv.length > 0 || /^NAME\b/.test(text.trim())) {
    return fromTsv;
  }
  const obj = tryParseJson(text);
  if (obj && typeof obj === "object") {
    const sessions = obj.data?.sessions;
    if (Array.isArray(sessions)) {
      return sessions.map((s) => ({
        name: String(s["name"] ?? ""),
        shell: String(s["shell"] ?? ""),
        state: String(s["state"] ?? ""),
        createdAtMs: typeof s["created_at_ms"] === "number" ? s["created_at_ms"] : void 0,
        raw: JSON.stringify(s)
      })).filter((s) => s.name.length > 0);
    }
  }
  return [];
}
function parseTermSessions(stdout) {
  const lines = stdout.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
  const headerIdx = lines.findIndex((l) => /^SESSION_ID\b/.test(l));
  if (headerIdx < 0) {
    return [];
  }
  const sessions = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cols = line.split(/\t+/).filter((c) => c.length > 0);
    if (cols.length < 2 || !/^\d+$/.test(cols[0])) {
      continue;
    }
    const [id, name, shell, state, lastActive] = cols;
    sessions.push({
      id,
      label: name ?? id,
      shell,
      state,
      lastActiveMs: /^\d+$/.test(lastActive ?? "") ? Number(lastActive) : void 0,
      raw: line
    });
  }
  return sessions;
}
function isValidShell(shell, shells) {
  return shells.includes(shell);
}
function platformName(platform) {
  if (platform === void 0 || platform === "") {
    return "";
  }
  if (typeof platform === "number") {
    const known2 = { 1: "Windows", 4: "Windows" };
    return known2[platform] ?? `platform ${platform}`;
  }
  const known = {
    windows: "Windows",
    win32: "Windows",
    macos: "macOS",
    mac: "macOS",
    linux: "Linux",
    android: "Android",
    ios: "iOS"
  };
  const name = known[platform.toLowerCase()];
  return name ?? platform;
}
function launchMainApp(cliPath2) {
  if (process.platform === "win32") {
    const installDir = (0, import_path.dirname)((0, import_path.dirname)(cliPath2));
    const exe = [(0, import_path.join)(installDir, "GameViewer.exe"), (0, import_path.join)(installDir, "uuyc.exe")].find((p) => (0, import_fs.existsSync)(p));
    return exe ? { command: exe, args: [] } : void 0;
  }
  if (process.platform === "darwin") {
    const macDir = (0, import_path.dirname)(cliPath2);
    const contentsDir = (0, import_path.dirname)(macDir);
    const appBundle = (0, import_path.dirname)(contentsDir);
    if (appBundle.endsWith(".app") && (0, import_fs.existsSync)(appBundle)) {
      return { command: "open", args: ["-a", appBundle] };
    }
    for (const app of ["/Applications/UURemote.app", "/Applications/UU\u8FDC\u7A0B.app", "/Applications/GameViewer.app"]) {
      if ((0, import_fs.existsSync)(app)) {
        return { command: "open", args: ["-a", app] };
      }
    }
    return void 0;
  }
  return void 0;
}
function cloudPcStatusName(status) {
  return CLOUDPC_STATUS_NAMES[status] ?? status;
}
var import_child_process, import_fs, import_path, CliError, ANSI_RE, CLI_FILE_NAME, REMOTE_SHELLS, LOCAL_SHELLS, CLOUDPC_STATUS_NAMES;
var init_cli = __esm({
  "cli.ts"() {
    import_child_process = require("child_process");
    import_fs = require("fs");
    import_path = require("path");
    CliError = class extends Error {
      constructor(message, stdout = "", stderr = "", code = void 0) {
        super(message);
        this.stdout = stdout;
        this.stderr = stderr;
        this.code = code;
        this.name = "CliError";
      }
      stdout;
      stderr;
      code;
    };
    ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
    CLI_FILE_NAME = process.platform === "win32" ? "uuyc-cli.exe" : "uuyc-cli";
    REMOTE_SHELLS = ["powershell", "cmd", "zsh", "bash"];
    LOCAL_SHELLS = ["powershell", "cmd"];
    CLOUDPC_STATUS_NAMES = {
      shutdown: "\u5DF2\u5173\u673A",
      running: "\u8FD0\u884C\u4E2D",
      starting: "\u5F00\u673A\u4E2D",
      stopping: "\u5173\u673A\u4E2D"
    };
  }
});

// main.ts
init_cli();

// termBridge.ts
var import_child_process3 = require("child_process");

// capabilities.ts
var import_child_process2 = require("child_process");
function unknownFeatures() {
  return {
    termChannel: true,
    dashD: true,
    inputDiag: true,
    bitrateAndPunch: true,
    echoJson: false,
    ltermLsJson: false
  };
}
function runCli(cliPath2, args, timeoutMs = 5e3) {
  return new Promise((resolve) => {
    const child = (0, import_child_process2.execFile)(cliPath2, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        resolve(`${stdout}
${stderr}`);
        return;
      }
      resolve(`${stdout}
${stderr}`);
    });
    child.on("error", () => resolve(""));
  });
}
function hasMarker(help, markers) {
  return markers.some((m) => help.includes(m));
}
function isUnsupportedArgs(out) {
  return /unknown option|unexpected argument|unrecognized|doesn't exist|no such option/i.test(out);
}
var cachedPath;
var cachedFeatures;
async function probeCliFeatures(cliPath2) {
  if (cachedPath === cliPath2 && cachedFeatures) {
    return cachedFeatures;
  }
  cachedPath = cliPath2;
  try {
    return await doProbe(cliPath2);
  } catch {
    cachedFeatures = unknownFeatures();
    return cachedFeatures;
  }
}
async function doProbe(cliPath2) {
  const [rootHelp, termHelp, termOpenHelp, inputDiagHelp] = await Promise.all([
    runCli(cliPath2, ["--help"]),
    runCli(cliPath2, ["term", "--help"]),
    runCli(cliPath2, ["term", "open", "--help"]),
    runCli(cliPath2, ["input-diag", "--help"])
  ]);
  const init = {
    termChannel: hasMarker(`${termHelp}
${termOpenHelp}`, ["--device-id", "--new-session", "--list-sessions", "--shell"]),
    dashD: false,
    // root help 是权威的子命令清单(旧版 CLI 对未知子命令 --help 会静默回退到 status help,
    // 因此不能单看子命令 help,必须确认 root help 确实列出了 input-diag)
    inputDiag: hasMarker(rootHelp, ["input-diag"]),
    bitrateAndPunch: hasMarker(rootHelp, ["--set-bitrate-limit", "--disable-lite-punch"]),
    echoJson: false,
    // 由运行时探测确认(见 probeEchoFormat)
    ltermLsJson: false
    // 由运行时探测确认(见 listLtermSessions 双解析)
  };
  init.dashD = await isSupportedFlag(cliPath2);
  if (!init.inputDiag && /input-diag|输入诊断/i.test(inputDiagHelp) && !isUnsupportedArgs(inputDiagHelp) && !/^USAGE: uuyc-cli status/m.test(inputDiagHelp.trim())) {
    init.inputDiag = true;
  }
  cachedFeatures = init;
  return init;
}
async function isSupportedFlag(cliPath2) {
  const out = await runCli(cliPath2, ["-d"], 3e3);
  return !isUnsupportedArgs(out) && out.trim().length > 0 && !/^error:/i.test(out.trim());
}

// vt.ts
var VtScreen = class {
  rows = /* @__PURE__ */ new Map();
  cursorRow = 1;
  cursorCol = 1;
  pending = "";
  /** 喂入原始字节流(可分多次;转义序列跨 chunk 也安全,残留在 pending 中) */
  feed(chunk) {
    let text = this.pending + chunk;
    this.pending = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\x1B") {
        const seq = matchEscape(text, i);
        if (seq) {
          this.applyEscape(seq.seq);
          i += seq.len;
          continue;
        }
        this.pending = text.slice(i);
        return;
      }
      if (ch === "\r") {
        this.cursorCol = 1;
      } else if (ch === "\n") {
        this.cursorRow++;
        this.cursorCol = 1;
      } else if (ch !== "\x07" && ch !== "\0") {
        this.writeChar(ch);
      }
      i++;
    }
  }
  writeChar(ch) {
    const row = this.getRow(this.cursorRow);
    const col = this.cursorCol;
    const before = row.substring(0, col - 1);
    const after = row.length >= col ? row.substring(col) : "";
    const padded = before.padEnd(col - 1, " ");
    this.rows.set(this.cursorRow, padded + ch + after);
    this.cursorCol++;
  }
  getRow(r) {
    return this.rows.get(r) ?? "";
  }
  applyEscape(seq) {
    if (!seq.startsWith("\x1B[")) {
      return;
    }
    const body = seq.slice(2, -1);
    const final = seq[seq.length - 1];
    const params = body.replace(/^\?/, "");
    switch (final) {
      case "H":
      case "f": {
        const [r, c] = params.split(";");
        this.cursorRow = Math.max(1, parseInt(r || "1", 10) || 1);
        this.cursorCol = Math.max(1, parseInt(c || "1", 10) || 1);
        break;
      }
      case "J": {
        const mode = params || "0";
        if (mode === "2" || mode === "3") {
          this.rows.clear();
          this.cursorRow = 1;
          this.cursorCol = 1;
        } else if (mode === "0") {
          const row = this.getRow(this.cursorRow);
          this.rows.set(this.cursorRow, row.substring(0, this.cursorCol - 1));
          for (const k of [...this.rows.keys()]) {
            if (k > this.cursorRow) {
              this.rows.delete(k);
            }
          }
        }
        break;
      }
      case "K": {
        const mode = params || "0";
        const row = this.getRow(this.cursorRow);
        if (mode === "0") {
          this.rows.set(this.cursorRow, row.substring(0, this.cursorCol - 1));
        } else if (mode === "1") {
          this.rows.set(this.cursorRow, row.padEnd(this.cursorCol - 1, " "));
        } else {
          this.rows.delete(this.cursorRow);
        }
        break;
      }
      case "X": {
        const n = parseInt(params || "1", 10) || 1;
        const row = this.getRow(this.cursorRow);
        const before = row.substring(0, this.cursorCol - 1);
        const after = row.substring(this.cursorCol - 1 + n);
        this.rows.set(this.cursorRow, before.padEnd(this.cursorCol - 1, " ") + " ".repeat(n) + after);
        break;
      }
      case "A":
        this.cursorRow = Math.max(1, this.cursorRow - (parseInt(params || "1", 10) || 1));
        break;
      case "B":
        this.cursorRow += parseInt(params || "1", 10) || 1;
        break;
      case "C":
        this.cursorCol += parseInt(params || "1", 10) || 1;
        break;
      case "D":
        this.cursorCol = Math.max(1, this.cursorCol - (parseInt(params || "1", 10) || 1));
        break;
      default:
        break;
    }
  }
  /** 当前屏幕快照:非空行数组(行尾空白已修剪) */
  snapshotLines() {
    const maxRow = Math.max(0, ...this.rows.keys());
    const lines = [];
    for (let r = 1; r <= maxRow; r++) {
      const line = (this.rows.get(r) ?? "").replace(/\s+$/, "");
      lines.push(line);
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }
  /** 判定屏幕是否包含某文本(忽略颜色等转义后逐行查找) */
  contains(needle) {
    return this.snapshotLines().some((l) => l.includes(needle));
  }
  reset() {
    this.rows.clear();
    this.pending = "";
    this.cursorRow = 1;
    this.cursorCol = 1;
  }
};
function matchEscape(text, i) {
  const csiRe = /^\u001B\[[0-9;?]*[ -/]*[@-~]/;
  const oscRe = /^\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/;
  const singleRe = /^\u001B[@-Z\\-_]/;
  for (const re of [csiRe, oscRe, singleRe]) {
    const m = re.exec(text.slice(i));
    if (m) {
      return { seq: m[0], len: m[0].length };
    }
  }
  return null;
}

// termBridge.ts
function psQuote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}
function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
var BridgeError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "BridgeError";
  }
};
var PAGE_ROWS = 26;
var BEGIN_MARKER = "UU_BEGIN";
function isNoiseLine(t, fullCmd) {
  if (t === "" || /^PS [^>]*>\s*$/.test(t) || /^\s*[A-Za-z]:\\[^>]*>\s*$/.test(t)) {
    return true;
  }
  const em = /^PS [^>]*>\s?(.*)$/.exec(t);
  if (em && (fullCmd.startsWith(em[1].slice(0, 16)) || em[1].startsWith(fullCmd.slice(0, 16)))) {
    return true;
  }
  return false;
}
var powershellProtocol = {
  flush() {
    return `Clear-Host; `;
  },
  sentry(s) {
    return `("${s.slice(0, 4)}" + "${s.slice(4)}")`;
  },
  assignRows(cmd, countSentry) {
    return `Write-Output ('UU_B' + 'EGIN'); $global:uuOut = @(${cmd}); ("${countSentry.slice(0, 4)}" + "${countSentry.slice(4)}$($global:uuOut.Count)")`;
  },
  pageRows(start, end, s, varName = "uuOut") {
    return `Write-Output ('UU_B' + 'EGIN'); $global:${varName}[${start}..${end}]; ("${s.slice(0, 4)}" + "${s.slice(4)}")`;
  },
  storeFileB64(path, countSentry, limit, varName = "uuF64") {
    return [
      `Write-Output ('UU_B' + 'EGIN');`,
      `$f = $null; try { $f = Get-Item -Force -LiteralPath ${psQuote(path)} -ErrorAction Stop } catch { }`,
      `if (-not $f) { Write-Output ('UU_F' + '_MISS'); $global:${varName} = @() }`,
      `elseif ($f.PSIsContainer) { Write-Output 'ISDIR'; $global:${varName} = @() }`,
      `elseif ($f.Length -gt ${limit}) { Write-Output ('TOOBIG|' + $f.Length); $global:${varName} = @() }`,
      `else { $s2 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName)); $L2 = New-Object 'System.Collections.Generic.List[string]'; for ($j = 0; $j -lt $s2.Length; $j += 76) { $L2.Add($s2.Substring($j, [Math]::Min(76, $s2.Length - $j))) }; $global:${varName} = @($L2) }`,
      `; Write-Output ('UU_FL' + 'EN' + $s2.Length); ("${countSentry.slice(0, 4)}" + "${countSentry.slice(4)}$($global:${varName}.Count)")`
    ].join(" ");
  },
  writeFileB64(path, chunks, s) {
    const lines = ["Write-Output ('UU_B' + 'EGIN');", "$L = New-Object 'System.Collections.Generic.List[string]'"];
    for (const chunk of chunks) {
      lines.push(`$L.Add('${chunk}')`);
    }
    lines.push(`$okW = $true; try { [IO.File]::WriteAllBytes(${psQuote(path)}, [Convert]::FromBase64String(($L -join ''))) } catch { $okW = $false; Write-Output ('UU_W' + '_FAIL|' + $_.Exception.Message) }; $L = $null; if ($okW) { ("${s.slice(0, 4)}" + "${s.slice(4)}") }`);
    return lines.join("\r\n");
  },
  quote: psQuote
};
function posixProtocol(tmpPrefix) {
  return {
    flush() {
      return `printf '\\033[H\\033[2J'; `;
    },
    sentry(s) {
      return `echo "${s.slice(0, 4)}""${s.slice(4)}"`;
    },
    assignRows(cmd, countSentry) {
      return `echo "UU_B""EGIN"; eval ${shQuote(cmd)} > ${tmpPrefix}uuOut 2>/dev/null; echo "${countSentry.slice(0, 4)}""${countSentry.slice(4)}$(wc -l < ${tmpPrefix}uuOut | tr -d ' ')"`;
    },
    pageRows(start, end, s, varName = "uuOut") {
      return `echo "UU_B""EGIN"; sed -n '${start + 1},${end + 1}p' ${shQuote(tmpPrefix + varName)}; echo "${s.slice(0, 4)}""${s.slice(4)}"`;
    },
    storeFileB64(path, countSentry, limit, varName = "uuF64") {
      return [
        `echo "UU_B""EGIN";`,
        `sz=$(wc -c < ${shQuote(path)} 2>/dev/null | tr -d ' ')`,
        `if [ -d ${shQuote(path)} ]; then echo ISDIR; : > ${shQuote(tmpPrefix + varName)}`,
        `elif [ "$sz" -gt ${limit} ] 2>/dev/null; then echo "TOOBIG|$sz"; : > ${shQuote(tmpPrefix + varName)}`,
        `else base64 < ${shQuote(path)} | fold -w 76 > ${shQuote(tmpPrefix + varName)} 2>/dev/null; fi`,
        `; echo "${countSentry.slice(0, 4)}""${countSentry.slice(4)}$(wc -l < ${shQuote(tmpPrefix + varName)} | tr -d ' ')"`
      ].join(" ");
    },
    writeFileB64(path, chunks, s) {
      const lines = ['echo "UU_B""EGIN";', ": > " + shQuote(tmpPrefix + "uuIn")];
      for (const chunk of chunks) {
        lines.push(`printf '%s' ${shQuote(chunk)} >> ${shQuote(tmpPrefix + "uuIn")}`);
      }
      lines.push(`base64 -d < ${shQuote(tmpPrefix + "uuIn")} > ${shQuote(path)} && rm -f ${shQuote(tmpPrefix + "uuIn")}; echo "${s.slice(0, 4)}""${s.slice(4)}"`);
      return lines.join("\n");
    },
    quote: shQuote
  };
}
function b64ShapeValid(rows, count) {
  if (count === 0) {
    return true;
  }
  if (rows.length !== count) {
    return false;
  }
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].length !== 76) {
      return false;
    }
  }
  return rows.length === 0 || rows[rows.length - 1].length <= 76;
}
var TermBridge = class {
  constructor(cliPath2, deviceId, shell = "powershell", onStderr) {
    this.cliPath = cliPath2;
    this.deviceId = deviceId;
    this.shell = shell;
    this.onStderr = onStderr;
    this.protocol = shell === "powershell" ? powershellProtocol : posixProtocol(`/tmp/uu-${process.pid}-`);
  }
  cliPath;
  deviceId;
  shell;
  onStderr;
  child;
  screen = new VtScreen();
  seq = 0;
  closed = false;
  chain = Promise.resolve();
  protocol;
  stderrTail = [];
  /** 最近一次收到渲染流的时间(静默检测用) */
  lastDataAt = 0;
  /** 串行化所有远程操作,避免命令交叉 */
  enqueue(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => void 0);
    return run;
  }
  ensureStarted() {
    if (this.child && !this.closed) {
      return Promise.resolve();
    }
    if (this.closed) {
      return Promise.reject(new BridgeError("\u6865\u5DF2\u5173\u95ED"));
    }
    return this.start();
  }
  /**
   * 静默确认:哨兵命中后,服务端可能还在流式渲染剩余输出;此时写入下一条
   * 命令会打断渲染(实测:输入触发 2J 重绘,未完成的输出被丢弃)。
   * 等到输出流静默 quietMs 或到达 maxMs 才返回。
   */
  async settle(quietMs = 500, maxMs = 2500) {
    const start = Date.now();
    for (; ; ) {
      const idle = Date.now() - this.lastDataAt;
      if (idle >= quietMs || Date.now() - start >= maxMs) {
        return;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  /** 发送新命令前清空本地屏幕模型:避免上一命令的标记/哨兵残留误匹配 */
  send(cmd) {
    if (!this.child || this.closed) {
      this.throwIfDead();
    }
    this.screen.reset();
    this.child.stdin.write(cmd);
  }
  recordStderr(line) {
    this.stderrTail.push(line);
    if (this.stderrTail.length > 12) {
      this.stderrTail.shift();
    }
    this.onStderr?.(line);
  }
  /** stderr 中的关键错误行(过滤连接进度噪声),用于超时诊断 */
  stderrDiagnosis() {
    const meaningful = this.stderrTail.filter(
      (l) => !/^\[连接\]|^\[系统\]|^\[终端\]|^─+$|^\[提示\]|^Warning:/i.test(l)
    );
    return meaningful.length > 0 ? meaningful.join(";").slice(0, 200) : "";
  }
  /** 进程已断开时抛错;带上 stderr 中的关键错误行(如「主控端版本过低」),让用户看到真实原因 */
  throwIfDead(detail = "") {
    const diag = this.stderrDiagnosis();
    throw new BridgeError(`\u8FDC\u7A0B\u7EC8\u7AEF\u4F1A\u8BDD\u5DF2\u65AD\u5F00${detail}${diag ? ` \u2014\u2014 ${diag}` : ""}`);
  }
  async start() {
    const delays = [0, 8e3, 16e3];
    let lastErr;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i] > 0) {
        await new Promise((r) => setTimeout(r, delays[i]));
      }
      try {
        await this.attemptStart();
        return;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/频繁|2005/.test(msg)) {
          throw e;
        }
        try {
          this.child?.kill();
        } catch {
        }
        this.child = void 0;
      }
    }
    throw lastErr;
  }
  async attemptStart() {
    const feats = await probeCliFeatures(this.cliPath);
    if (!feats.termChannel) {
      throw new BridgeError(
        "\u5F53\u524D uuyc-cli \u7248\u672C\u4E0D\u652F\u6301\u8FDC\u7A0B\u7EC8\u7AEF\u7BA1\u9053\u901A\u9053(term --device-id)\u3002\u8FD9\u662F\u672C\u673A UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F\u7248\u672C\u9650\u5236:\u8BF7\u5347\u7EA7\u4E3B\u7A0B\u5E8F\u5230\u652F\u6301\u8BE5\u901A\u9053\u7684\u7248\u672C(\u53EF\u5728\u4E3B\u7A0B\u5E8F\u5185\u68C0\u67E5\u66F4\u65B0),\u6216\u76F4\u63A5\u5728 UU\u8FDC\u7A0B\u4E3B\u7A0B\u5E8F\u4E2D\u4F7F\u7528\u8FDC\u7A0B\u7EC8\u7AEF\u3002"
      );
    }
    this.screen.reset();
    this.stderrTail.length = 0;
    this.child = (0, import_child_process3.spawn)(this.cliPath, ["term", "--device-id", this.deviceId, "--new-session", "--shell", this.shell], {
      windowsHide: true
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (d) => {
      this.lastDataAt = Date.now();
      this.screen.feed(d);
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (d) => {
      for (const line of d.split(/\r?\n/)) {
        if (line.trim()) {
          this.recordStderr(line.trim());
        }
      }
    });
    this.child.on("close", () => {
      this.child = void 0;
    });
    try {
      await this.waitSentry(this.protocol.flush() + this.protocol.sentry("UU_R_0"), "UU_R_0", 2e4);
    } catch (e) {
      const diag = this.stderrDiagnosis();
      throw diag ? new BridgeError(`\u8FDC\u7A0B\u7EC8\u7AEF\u4F1A\u8BDD\u65E0\u6CD5\u5C31\u7EEA:${diag}`) : e instanceof Error ? e : new BridgeError(String(e));
    }
  }
  async waitSentry(fullCmd, sentry, timeoutMs) {
    this.send(fullCmd + "\r\n");
    const t0 = Date.now();
    for (; ; ) {
      await new Promise((r) => setTimeout(r, 120));
      if (this.screen.contains(sentry)) {
        await this.settle();
        return;
      }
      if (!this.child || this.closed) {
        this.throwIfDead();
      }
      if (Date.now() - t0 > timeoutMs) {
        throw new BridgeError(`\u547D\u4EE4\u8D85\u65F6(${timeoutMs}ms),\u8BBE\u5907\u53EF\u80FD\u7E41\u5FD9\u6216\u79BB\u7EBF`);
      }
    }
  }
  /**
   * 执行单条命令,返回其输出行(已剔除提示符/回显)。
   * 适合输出行数确定较少的命令;行数可能超过一屏的请用 execRows。
   */
  exec(cmd, opts = {}) {
    return this.enqueue(async () => {
      await this.ensureStarted();
      return this.runOnce(cmd, opts.timeoutMs ?? 15e3);
    });
  }
  async runOnce(cmd, timeoutMs) {
    this.seq++;
    const sentry = `UU_E_${this.seq}`;
    const full = this.protocol.flush() + `Write-Output ('UU_B' + 'EGIN'); ` + cmd + "; " + this.protocol.sentry(sentry);
    this.send(full + "\r\n");
    const t0 = Date.now();
    for (; ; ) {
      await new Promise((r) => setTimeout(r, 130));
      if (this.screen.contains(sentry)) {
        await this.settle();
        return this.extract(sentry, full);
      }
      if (!this.child || this.closed) {
        this.throwIfDead();
      }
      if (Date.now() - t0 > timeoutMs) {
        const diag = this.stderrDiagnosis();
        throw new BridgeError(`\u8FDC\u7A0B\u547D\u4EE4\u8D85\u65F6(${timeoutMs}ms):${cmd.slice(0, 50)}${diag ? `(${diag})` : ""}`);
      }
    }
  }
  extract(sentry, fullCmd) {
    const lines = this.screen.snapshotLines();
    const idx = lines.findIndex((l) => l.includes(sentry));
    if (idx < 0) {
      return [];
    }
    const beginIdx = lines.findIndex((l) => l.trim() === BEGIN_MARKER);
    const start = beginIdx >= 0 && beginIdx < idx ? beginIdx + 1 : 0;
    const out = [];
    for (const line of lines.slice(start, idx)) {
      const t = line.replace(/\s+$/, "");
      if (isNoiseLine(t, fullCmd)) {
        continue;
      }
      out.push(t);
    }
    return out;
  }
  /**
   * 执行命令并把输出按行分页拉全(输出先落盘/数组,再按页读取)。
   * 用于行数不确定/可能超过一屏的命令(目录列表、base64 文件内容等)。
   */
  execRows(cmd, opts = {}) {
    return this.enqueue(async () => {
      await this.ensureStarted();
      const timeoutMs = opts.timeoutMs ?? 3e4;
      this.seq++;
      const countSentry = `UU_N_${this.seq}`;
      const assign = this.protocol.flush() + this.protocol.assignRows(cmd, countSentry);
      this.send(assign + "\r\n");
      const t0 = Date.now();
      for (; ; ) {
        await new Promise((r) => setTimeout(r, 130));
        const hit = this.screen.snapshotLines().find((l) => l.includes(countSentry));
        if (hit) {
          const m = new RegExp(`${countSentry}(\\d+)`).exec(hit);
          const count = m ? parseInt(m[1], 10) : 0;
          await this.settle();
          return this.pullPages(count, timeoutMs);
        }
        if (!this.child || this.closed) {
          this.throwIfDead();
        }
        if (Date.now() - t0 > timeoutMs) {
          throw new BridgeError(`\u8FDC\u7A0B\u547D\u4EE4\u8D85\u65F6(${timeoutMs}ms):${cmd.slice(0, 50)}`);
        }
      }
    });
  }
  async pullPages(count, timeoutMs, varName = "uuOut") {
    const rows = [];
    for (let start = 0; start < count; start += PAGE_ROWS) {
      const end = Math.min(start + PAGE_ROWS - 1, count - 1);
      this.seq++;
      const sentry = `UU_P_${this.seq}`;
      const cmd = this.protocol.flush() + this.protocol.pageRows(start, end, sentry, varName);
      let pageRows = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        this.send(cmd + "\r\n");
        const t0 = Date.now();
        for (; ; ) {
          await new Promise((r) => setTimeout(r, 130));
          if (this.screen.contains(sentry)) {
            await this.settle();
            pageRows = this.extract(sentry, cmd);
            break;
          }
          if (!this.child || this.closed) {
            this.throwIfDead();
          }
          if (Date.now() - t0 > timeoutMs) {
            throw new BridgeError(`\u5206\u9875\u8BFB\u53D6\u8D85\u65F6(\u7B2C ${start} \u884C\u8D77)`);
          }
        }
        if (pageRows.length > 0 || end < start) {
          break;
        }
      }
      rows.push(...pageRows);
    }
    return rows;
  }
  /**
   * 读取文件为 base64(分页拉取): 先存入服务端数组(附状态标记), 再按页读取。
   * 返回行数组;首行可能是 ISDIR / TOOBIG|<size> / UU_F_MISS 状态标记。
   */
  readFileB64(path, limitBytes = 256 * 1024, opts = {}) {
    return this.enqueue(async () => {
      await this.ensureStarted();
      const timeoutMs = opts.timeoutMs ?? 24e4;
      let count = 0;
      let head = [];
      let missSeen = false;
      for (let a = 0; a < 3; a++) {
        this.seq++;
        const countSentry = `UU_F_${this.seq}`;
        const cmd = this.protocol.flush() + this.protocol.storeFileB64(path, countSentry, limitBytes);
        this.send(cmd + "\r\n");
        const t0 = Date.now();
        for (; ; ) {
          await new Promise((r) => setTimeout(r, 130));
          if (this.screen.contains("UU_F_MISS")) {
            if (missSeen) {
              await this.settle();
              return ["UU_F_MISS"];
            }
            missSeen = true;
            break;
          }
          const hit = this.screen.snapshotLines().find((l) => l.includes(countSentry));
          if (hit) {
            const m = new RegExp(`${countSentry}(\\d+)`).exec(hit);
            count = m ? parseInt(m[1], 10) : 0;
            await this.settle();
            head = this.extract(countSentry, cmd);
            missSeen = false;
            break;
          }
          if (!this.child || this.closed) {
            this.throwIfDead();
          }
          if (Date.now() - t0 > timeoutMs) {
            throw new BridgeError(`\u8BFB\u53D6\u6587\u4EF6\u8D85\u65F6:${path}`);
          }
        }
        if (head.length > 0 || count === 0 && !missSeen) {
          break;
        }
        const marker = head.find((l) => l === "ISDIR" || l.startsWith("TOOBIG"));
        if (marker) {
          return [marker];
        }
        if (head.length > 0) {
          break;
        }
      }
      const lenRow = head.find((l) => l.startsWith("UU_FLEN"));
      const expectLen = lenRow ? parseInt(lenRow.slice("UU_FLEN".length), 10) : -1;
      if (count === 0) {
        return [];
      }
      for (let a = 0; a < 3; a++) {
        const rows = await this.pullPages(count, timeoutMs, "uuF64");
        const joined = rows.join("");
        if (!b64ShapeValid(rows, count) || expectLen >= 0 && joined.length !== expectLen) {
          continue;
        }
        return rows;
      }
      throw new BridgeError(`\u6587\u4EF6\u8BFB\u53D6\u6821\u9A8C\u5931\u8D25(\u671F\u671B${expectLen}\u5B57\u7B26,3 \u6B21\u62C9\u53D6\u5747\u4E0D\u4E00\u81F4,\u6E32\u67D3\u6D41\u4E0D\u7A33\u5B9A)`);
    });
  }
  /**
   * 写文件:base64 分块经管道传输,末尾输出哨兵。
   * 上限约 512KB(协议吞吐 ~5KB/s,更大文件体验极差,直接拒绝)。
   */
  writeFile(path, content) {
    const MAX = 512 * 1024;
    return this.enqueue(async () => {
      if (content.length > MAX) {
        throw new BridgeError(`\u6587\u4EF6\u8FC7\u5927(${Math.round(content.length / 1024)}KB > 512KB),\u8FDC\u7A0B\u901A\u9053\u6682\u4E0D\u652F\u6301\u5199\u5165\u66F4\u5927\u6587\u4EF6`);
      }
      await this.ensureStarted();
      const b64 = Buffer.from(content).toString("base64");
      this.seq++;
      const sentry = `UU_W_${this.seq}`;
      const chunkSize = 512;
      const chunks = [];
      for (let i = 0; i < b64.length; i += chunkSize) {
        chunks.push(b64.slice(i, i + chunkSize));
      }
      if (chunks.length === 0) {
        chunks.push("");
      }
      const payload = this.protocol.writeFileB64(path, chunks, sentry) + "\r\n";
      this.send(payload);
      const t0 = Date.now();
      const timeoutMs = Math.max(3e4, content.length / 2);
      for (; ; ) {
        await new Promise((r) => setTimeout(r, 150));
        const failLine = this.screen.snapshotLines().find((l) => l.includes("UU_W_FAIL"));
        if (failLine) {
          throw new BridgeError(`\u8FDC\u7A0B\u5199\u5165\u5931\u8D25:${failLine.split("UU_W_FAIL|")[1] ?? "\u672A\u77E5\u9519\u8BEF"}`);
        }
        if (this.screen.contains(sentry)) {
          await this.settle();
          return;
        }
        if (!this.child || this.closed) {
          this.throwIfDead("(\u5199\u5165\u53EF\u80FD\u672A\u5B8C\u6210,\u8BF7\u68C0\u67E5\u8FDC\u7AEF\u6587\u4EF6)");
        }
        if (Date.now() - t0 > timeoutMs) {
          throw new BridgeError(`\u5199\u6587\u4EF6\u8D85\u65F6(${timeoutMs}ms)`);
        }
      }
    });
  }
  // -------------------------------------------------------------------------
  // 交互式终端原语(uu_pty_* 工具的底层,供 AI 处理交互提示:ssh 密码、y/n 确认等)
  // -------------------------------------------------------------------------
  /** 当前屏幕快照(非空行,行尾空白已修剪) */
  snapshot() {
    return this.screen.snapshotLines();
  }
  /** 原样写入输入(不做哨兵/冲刷处理);回车用 \r */
  writeRaw(keys) {
    if (!this.child || this.closed) {
      throw new BridgeError("\u8FDC\u7A0B\u7EC8\u7AEF\u4F1A\u8BDD\u672A\u542F\u52A8\u6216\u5DF2\u5173\u95ED");
    }
    this.child.stdin.write(keys);
  }
  /** 会话是否仍在运行 */
  isAlive() {
    return !!this.child && !this.closed;
  }
  /** 启动并等待就绪(交互式会话打开时使用;不占用串行队列) */
  ensureReady() {
    return this.ensureStarted();
  }
  /** 正常关闭:发送 exit 结束远程会话(避免会话在远程残留),再回收本地进程 */
  dispose() {
    return this.enqueue(async () => {
      this.closed = true;
      if (this.child) {
        try {
          this.child.stdin.write("exit\r\n");
        } catch {
        }
        await new Promise((r) => setTimeout(r, 600));
        this.child?.kill();
        this.child = void 0;
      }
    });
  }
};

// main.ts
var DEFAULT_CLI = "C:\\Program Files\\Netease\\GameViewer\\bin\\uuyc-cli.exe";
var cliPath = () => process.env["UU_CLI_PATH"] || DEFAULT_CLI;
function parseArgs(argv) {
  const shellIdx = argv.indexOf("--shell");
  let shell = "powershell";
  if (shellIdx >= 0) {
    shell = argv[shellIdx + 1];
    argv.splice(shellIdx, 2);
  }
  return { shell, args: argv };
}
async function main() {
  const { shell, args } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args;
  if (cmd === "list") {
    const devices = await listDevices(cliPath());
    for (const d of devices) {
      console.log(`${d.deviceId}	${d.deviceName}	online=${d.isOnline}	platform=${d.platform}`);
    }
    return;
  }
  const deviceId = rest[0];
  if (!deviceId) {
    console.error("device id required");
    process.exit(2);
  }
  if (cmd !== "pty" && shell === "cmd") {
    console.error("ERROR: exec/read/write \u4EC5\u652F\u6301 powershell(\u534F\u8BAE\u9650\u5236); cmd \u4F1A\u8BDD\u8BF7\u7528 pty \u4EA4\u4E92\u6A21\u5F0F");
    process.exit(2);
  }
  if (cmd === "sessions") {
    const { execCliText: execCliText2 } = await Promise.resolve().then(() => (init_cli(), cli_exports));
    const out = await execCliText2(cliPath(), ["term", "--device-id", deviceId, "--list-sessions"], { timeoutMs: 3e4 });
    console.log(out.trim() || "(no sessions)");
    return;
  }
  if (cmd === "kill") {
    const sid = rest[1];
    if (!sid) {
      console.error("usage: kill <device_id> <session_id>");
      process.exit(2);
    }
    const { execCliText: execCliText2 } = await Promise.resolve().then(() => (init_cli(), cli_exports));
    const out = await execCliText2(cliPath(), ["term", "--device-id", deviceId, "--kill-session", sid], { timeoutMs: 3e4 });
    console.log(out.trim() || `session ${sid} killed`);
    return;
  }
  if (cmd === "exec") {
    const command = rest.slice(1).join(" ");
    if (!command) {
      console.error("command required");
      process.exit(2);
    }
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    try {
      const rows = await bridge.execRows(command, { timeoutMs: 9e4 });
      console.log(rows.length > 0 ? rows.join("\n") : "(no output)");
    } finally {
      await bridge.dispose();
    }
    return;
  }
  if (cmd === "read") {
    const path = rest[1];
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    try {
      const rows = await bridge.readFileB64(path, 256 * 1024);
      const first = rows[0] ?? "";
      if (first === "UU_F_MISS") throw new Error(`\u8FDC\u7A0B\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BBF\u95EE: ${path}`);
      if (first === "ISDIR") throw new Error(`${path} is a directory`);
      if (first.startsWith("TOOBIG")) throw new Error(`file too large: ${first}`);
      const b64 = rows.map((r) => r.trim()).join("");
      process.stdout.write(Buffer.from(b64, "base64"));
    } finally {
      await bridge.dispose();
    }
    return;
  }
  if (cmd === "write") {
    const path = rest[1];
    const localFile = rest[2];
    if (!path || !localFile) {
      console.error("usage: write <device> <remote_path> <local_file>");
      process.exit(2);
    }
    const { readFileSync } = await import("fs");
    const content = readFileSync(localFile);
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    try {
      await bridge.writeFile(path, content);
      console.log(`written ${path} (${content.length} bytes)`);
    } finally {
      await bridge.dispose();
    }
    return;
  }
  if (cmd === "pty") {
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    await bridge.ensureReady();
    console.log('--- pty ready; type lines, Ctrl-D / "exit" to quit ---');
    const readline = await import("readline");
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (line === "exit" || line === "__quit__") break;
      bridge.writeRaw(line + "\r");
      await new Promise((r) => setTimeout(r, 800));
      console.log(bridge.snapshot().join("\n"));
    }
    await bridge.dispose();
    return;
  }
  console.error("unknown command:", cmd);
  process.exit(2);
}
main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
