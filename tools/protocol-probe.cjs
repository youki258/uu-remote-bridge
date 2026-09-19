// tools/protocol-probe.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");

// src/vt.ts
var VIEWPORT_ROWS = 39;
var VIEWPORT_COLS = 120;
var VtScreen = class {
  /** 视口行（index 0 = 屏上第 1 行），长度恒 ≤ VIEWPORT_ROWS，溢出时从顶部逐出 */
  rows = [];
  cursorRow = 1;
  cursorCol = 1;
  pending = "";
  /** 自上次 reset() 后被写过的行（脏行跟踪，用于区分「本命令输出」与「残留」） */
  dirty = /* @__PURE__ */ new Set();
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
        this.cursorCol = 1;
        this.lineFeed();
      } else if (ch !== "\x07" && ch !== "\0") {
        this.writeChar(ch);
      }
      i++;
    }
  }
  getRow(r) {
    return this.rows[r - 1] ?? "";
  }
  setRow(r, value) {
    while (this.rows.length < r) {
      this.rows.push("");
    }
    this.rows[r - 1] = value;
    this.dirty.add(r);
  }
  /** 光标下移一行；超出视口底部时整屏上移并从顶部逐出（真终端的滚动语义） */
  lineFeed() {
    this.cursorRow++;
    if (this.cursorRow > VIEWPORT_ROWS) {
      this.rows.shift();
      this.rows.push("");
      this.cursorRow = VIEWPORT_ROWS;
      const moved = /* @__PURE__ */ new Set();
      for (const d of this.dirty) {
        if (d > 1) {
          moved.add(d - 1);
        }
      }
      this.dirty = moved;
    }
  }
  writeChar(ch) {
    if (this.cursorCol > VIEWPORT_COLS) {
      this.cursorCol = 1;
      this.lineFeed();
    }
    const col = this.cursorCol;
    const row = this.getRow(this.cursorRow);
    const before = row.substring(0, col - 1).padEnd(col - 1, " ");
    const after = row.length >= col ? row.substring(col) : "";
    this.setRow(this.cursorRow, before + ch + after);
    this.cursorCol++;
  }
  applyEscape(seq) {
    if (!seq.startsWith("\x1B[")) {
      return;
    }
    const body = seq.slice(2, -1);
    const final = seq[seq.length - 1];
    const params = body.replace(/^\?/, "");
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const arg2 = (s, dflt = 1) => parseInt(s || String(dflt), 10) || dflt;
    switch (final) {
      case "H":
      case "f": {
        const [r, c] = params.split(";");
        this.cursorRow = clamp(arg2(r, 1), 1, VIEWPORT_ROWS);
        this.cursorCol = clamp(arg2(c, 1), 1, VIEWPORT_COLS + 1);
        break;
      }
      case "J": {
        const mode = params || "0";
        if (mode === "2" || mode === "3") {
          this.rows = [];
          this.dirty.clear();
          this.cursorRow = 1;
          this.cursorCol = 1;
        } else if (mode === "0") {
          this.setRow(this.cursorRow, this.getRow(this.cursorRow).substring(0, this.cursorCol - 1));
          for (let r = this.cursorRow + 1; r <= this.rows.length; r++) {
            this.setRow(r, "");
          }
        }
        break;
      }
      case "K": {
        const mode = params || "0";
        const row = this.getRow(this.cursorRow);
        if (mode === "0") {
          this.setRow(this.cursorRow, row.substring(0, this.cursorCol - 1));
        } else if (mode === "1") {
          const tail = row.substring(this.cursorCol - 1);
          this.setRow(this.cursorRow, " ".repeat(this.cursorCol - 1) + tail);
        } else {
          this.setRow(this.cursorRow, "");
        }
        break;
      }
      case "X": {
        const n = Math.min(arg2(params, 1), VIEWPORT_COLS);
        const row = this.getRow(this.cursorRow);
        const start = this.cursorCol - 1;
        const before = row.substring(0, start).padEnd(start, " ");
        const after = row.substring(start + n);
        this.setRow(this.cursorRow, (before + " ".repeat(n) + after).replace(/\s+$/, ""));
        break;
      }
      case "A":
        this.cursorRow = clamp(this.cursorRow - arg2(params, 1), 1, VIEWPORT_ROWS);
        break;
      case "B":
        this.cursorRow = clamp(this.cursorRow + arg2(params, 1), 1, VIEWPORT_ROWS);
        break;
      case "C":
        this.cursorCol = clamp(this.cursorCol + arg2(params, 1), 1, VIEWPORT_COLS + 1);
        break;
      case "D":
        this.cursorCol = clamp(this.cursorCol - arg2(params, 1), 1, VIEWPORT_COLS);
        break;
      default:
        break;
    }
  }
  /** 当前屏幕快照:非空行数组(行尾空白已修剪)，最多 VIEWPORT_ROWS 行 */
  snapshotLines() {
    const lines = [];
    for (let r = 1; r <= this.rows.length; r++) {
      lines.push((this.rows[r - 1] ?? "").replace(/\s+$/, ""));
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }
  /** 自上次 reset() 后被写过的行（行号 1-based，已按屏上顺序），用于区分本命令输出与残留 */
  dirtyLines() {
    return [...this.dirty].sort((a, b) => a - b).map((r) => (this.rows[r - 1] ?? "").replace(/\s+$/, ""));
  }
  /** 判定屏幕是否包含某文本(忽略颜色等转义后逐行查找) */
  contains(needle) {
    return this.snapshotLines().some((l) => l.includes(needle));
  }
  /**
   * 本地模型重置。
   * 注意：服务端是**差分渲染**，本地模型必须与服务端保持一致；
   * 本方法只用于「已知服务端即将全屏重绘（如 Clear-Host）」的场合。
   */
  reset() {
    this.rows = [];
    this.dirty.clear();
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

// tools/protocol-probe.ts
var CLI = process.env["UU_CLI_PATH"] ?? "C:\\Program Files\\Netease\\GameViewer\\bin\\uuyc-cli.exe";
var POLL_MS = 120;
var CRLF = String.fromCharCode(13, 10);
var LF = String.fromCharCode(10);
function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? "" : fallback;
}
var scenario = process.argv[2] ?? "";
var device = arg("device");
var outDir = arg("out", (0, import_path.join)((0, import_os.tmpdir)(), "uu-evidence"));
var stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
var base = (0, import_path.join)(outDir, `${scenario}-${stamp}`);
if (!scenario || !device && scenario !== "analyze") {
  console.error("usage: protocol-probe <rows|flush|pages|wrap|rt|analyze> --device <id> [--k 24,32] [--wide 200] [--pagerows 26] [--len 200] [--rounds 5] [--only blank60|clearhost] [--file <raw>] [--trim 0] [--out <dir>]");
  process.exit(2);
}
(0, import_fs.mkdirSync)(outDir, { recursive: true });
var raw = [];
var events = [];
var lastDataAt = Date.now();
var t0 = Date.now();
function ev(line) {
  const ms = Date.now() - t0;
  events.push(`[+${String(ms).padStart(6)}ms] ${line}`);
  console.log(`[+${ms}ms] ${line}`);
}
var results = { scenario, device, cli: CLI, startedAt: (/* @__PURE__ */ new Date()).toISOString() };
var screen = new VtScreen();
if (scenario === "analyze") {
  analyzeFile(arg("file", ""));
  (0, import_fs.writeFileSync)(`${base}.json`, JSON.stringify(results, null, 2));
  (0, import_fs.appendFileSync)(`${base}.log`, events.join("\n") + "\n");
  process.exit(0);
}
var child = (0, import_child_process.spawn)(CLI, ["term", "--device-id", device, "--new-session", "--shell", "powershell"], {
  windowsHide: true
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (d) => {
  lastDataAt = Date.now();
  raw.push(Buffer.from(d, "utf8"));
  screen.feed(d);
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (d) => {
  for (const l of d.split(/\r?\n/)) {
    if (l.trim()) {
      ev(`STDERR ${l.trim()}`);
    }
  }
});
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sentryExpr(s) {
  return `("${s.slice(0, 4)}" + "${s.slice(4)}")`;
}
function sentryExprCount(s, expr) {
  return `("${s.slice(0, 4)}" + "${s.slice(4)}${expr}")`;
}
function send(cmd) {
  screen.reset();
  child.stdin.write(cmd + "\r\n");
}
async function waitSentry(sentry, timeoutMs) {
  const start = Date.now();
  for (; ; ) {
    await sleep(POLL_MS);
    if (screen.snapshotLines().some((l) => l.includes(sentry))) {
      return true;
    }
    if (Date.now() - start > timeoutMs) {
      return false;
    }
  }
}
async function settle(quietMs = 500, maxMs = 2500) {
  const start = Date.now();
  for (; ; ) {
    const idle = Date.now() - lastDataAt;
    if (idle >= quietMs || Date.now() - start >= maxMs) {
      return Date.now() - start;
    }
    await sleep(60);
  }
}
function snap() {
  return screen.snapshotLines();
}
async function handshake() {
  const ok = await (async () => {
    send(`Clear-Host; Write-Output ${sentryExpr("UU_R_0")}`);
    return waitSentry("UU_R_0", 2e4);
  })();
  ev(`handshake=${ok}`);
  return ok;
}
async function scenarioRows(ks, mode, wideLen = 0) {
  const perK = [];
  for (const k of ks) {
    const sentry = `SENT_${k}_${Date.now() % 1e5}`;
    const body = wideLen > 0 ? `'M' + $_.ToString('0000') + ('#' * ${wideLen})` : `'M' + $_.ToString('0000')`;
    const markers = `1..${k} | ForEach-Object { ${body} }`;
    const pre = mode === "blank60" ? `Write-Output ("\`n" * 60); ` : "Clear-Host; ";
    send(`${pre}${markers}; Write-Output ${sentryExpr(sentry)}`);
    const hit = await waitSentry(sentry, 12e4);
    const quietFor = hit ? await settle() : -1;
    const lines = snap();
    const present = /* @__PURE__ */ new Set();
    for (const l of lines) {
      for (const m of l.match(/M\d{4}/g) ?? []) {
        present.add(m);
      }
    }
    const erasedPrefix = lines.filter((l) => /^\s{1,}\d{4}/.test(l)).length;
    const markerLines = lines.filter((l) => /M\d{4}/.test(l));
    const lens = markerLines.map((l) => l.length);
    const expectedLen = wideLen > 0 ? wideLen + 5 : 5;
    const shortLines = lens.filter((n) => n < expectedLen).length;
    const firstPresent = present.has("M0001");
    const lastExpected = `M${String(k).padStart(4, "0")}`;
    perK.push({
      k,
      wideLen,
      sentryHit: hit,
      quietFor,
      distinctMarkers: present.size,
      firstPresent,
      lastPresent: present.has(lastExpected),
      erasedPrefix,
      markerLines: markerLines.length,
      minLineLen: lens.length ? Math.min(...lens) : 0,
      maxLineLen: lens.length ? Math.max(...lens) : 0,
      shortLines,
      tail: lines.slice(-3)
    });
    ev(
      `rows mode=${mode} wide=${wideLen} k=${k} hit=${hit} markers=${present.size} first=${firstPresent} last=${present.has(lastExpected)} erased=${erasedPrefix} shortLines=${shortLines} minLen=${perK[perK.length - 1] && perK[perK.length - 1].minLineLen}`
    );
    await settle(300, 1e3);
  }
  results["mode"] = mode;
  results["wideLen"] = wideLen;
  results["perK"] = perK;
}
async function scenarioPages(k, wide, pageRows = 26) {
  const countSentry = `CNT_${Date.now() % 1e5}`;
  const body = wide > 0 ? `'P' + $_.ToString('00') + ('x' * ${wide})` : `'P' + $_.ToString('00')`;
  send(`Clear-Host; Write-Output ('UU_B' + 'EGIN'); $global:uuOut = @(1..${k} | ForEach-Object { ${body} }); ${sentryExprCount(countSentry, "$($global:uuOut.Count)")}`);
  const hit = await waitSentry(countSentry, 12e4);
  await settle();
  const cntLine = snap().find((l) => l.includes(countSentry)) ?? "";
  const count = parseInt((new RegExp(`${countSentry}(\\d+)`).exec(cntLine) ?? [])[1] ?? "0", 10);
  ev(`assign sentryHit=${hit} reportedCount=${count} (expected ${k})`);
  const pages = [];
  for (let start = 0; start < k; start += pageRows) {
    const end = Math.min(start + pageRows - 1, k - 1);
    const sentry = `PG_${start}_${Date.now() % 1e5}`;
    send(`Clear-Host; Write-Output ('UU_B' + 'EGIN'); $global:uuOut[${start}..${end}]; ${sentryExpr(sentry)}`);
    const phit = await waitSentry(sentry, 12e4);
    await settle();
    const lines = snap();
    const present = /* @__PURE__ */ new Set();
    for (const l of lines) {
      for (const m of l.match(/P\d{2}/g) ?? []) {
        present.add(m);
      }
    }
    const expected = end - start + 1;
    pages.push({
      range: `${start}..${end}`,
      expected,
      sentryHit: phit,
      rowsOnScreen: lines.length,
      markersFound: present.size,
      markerList: [...present].sort(),
      maxRowLen: lines.reduce((m, l) => Math.max(m, l.length), 0),
      tail: lines.slice(-3)
    });
    ev(`page ${start}..${end} expected=${expected} sentry=${phit} screenRows=${lines.length} markers=${present.size} maxRowLen=${pages[pages.length - 1] && pages[pages.length - 1].maxRowLen} first=${[...present].sort()[0] ?? "-"} last=${[...present].sort().slice(-1)[0] ?? "-"}`);
    await settle(300, 1e3);
  }
  results["k"] = k;
  results["wide"] = wide;
  results["pageRows"] = pageRows;
  results["assignReportedCount"] = count;
  results["pages"] = pages;
}
async function scenarioWrap(len) {
  const sentry = `WEND_${Date.now() % 1e5}`;
  send(`Clear-Host; Write-Output ('WWSTART' + ('A' * ${len}) + 'WWEND'); Write-Output ${sentryExpr(sentry)}`);
  const hit = await waitSentry(sentry, 6e4);
  await settle();
  const lines = snap();
  const startLine = lines.findIndex((l) => l.includes("WWSTART"));
  const endLine = lines.findIndex((l) => l.includes("WWEND"));
  const startIdx = startLine >= 0 ? lines[startLine].indexOf("WWSTART") : -1;
  const endIdx = endLine >= 0 ? lines[endLine].indexOf("WWEND") : -1;
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  results["len"] = len;
  results["sentryHit"] = hit;
  results["startLine"] = startLine;
  results["endLine"] = endLine;
  results["wrapped"] = startLine >= 0 && endLine >= 0 && endLine !== startLine;
  results["startIdx"] = startIdx;
  results["endIdx"] = endIdx;
  results["aCount"] = (lines.join("\n").match(/A/g) ?? []).length;
  results["maxLineLen"] = maxLen;
  results["snapshot"] = lines;
  ev(`wrap len=${len} hit=${hit} startLine=${startLine} endLine=${endLine} wrapped=${endLine !== startLine} aCount=${results["aCount"]} maxLen=${maxLen}`);
}
async function scenarioRt(rounds) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const sentry = `RT_${i}_${Date.now() % 1e5}`;
    const t = Date.now();
    send(`Clear-Host; Write-Output ${sentryExpr(sentry)}`);
    const hit = await waitSentry(sentry, 6e4);
    const dt = Date.now() - t;
    await settle();
    const total = Date.now() - t;
    samples.push(total);
    ev(`rt#${i} sentryHit=${hit} toSentry=${dt}ms settled=${total}ms`);
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  results["rounds"] = rounds;
  results["toSettledMs"] = samples;
  results["min"] = min;
  results["avg"] = avg;
  results["max"] = max;
  ev(`rt summary min=${min} avg=${avg} max=${max}`);
}
function analyzeRaw() {
  const buf = Buffer.concat(raw).toString("utf8");
  const count = (re) => (buf.match(re) ?? []).length;
  results["rawStats"] = {
    bytes: Buffer.byteLength(buf),
    csiTotal: count(/\u001b\[/g),
    fullRedraw2J: count(/\u001b\[2J/g),
    eraseInLineK: count(/\u001b\[[0-9]*K/g),
    eraseCharX: count(/\u001b\[[0-9]*X/g),
    cursorHome: count(/\u001b\[H/g),
    maxEchRun: (buf.match(/\u001b\[(\d+)X/g) ?? []).reduce((m, s) => {
      const v = parseInt(s.replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(v) ? Math.max(m, v) : m;
    }, 0)
  };
  ev(`rawStats ${JSON.stringify(results["rawStats"])}`);
}
function analyzeFile(file) {
  if (!file) {
    ev("analyze \u9700\u8981 --file <raw \u8DEF\u5F84>");
    return;
  }
  const text = (0, import_fs.readFileSync)(file, "utf8");
  const trim = parseInt(arg("trim", "0"), 10);
  const body = trim > 0 ? text.slice(0, Math.max(0, text.length - trim)) : text;
  const s = new VtScreen();
  s.feed(body);
  const lines = s.snapshotLines();
  const markerLines = lines.filter((l) => /M\d{4}/.test(l));
  const present = /* @__PURE__ */ new Set();
  for (const l of lines) {
    for (const m of l.match(/M\d{4}/g) ?? []) {
      present.add(m);
    }
  }
  const ech = text.match(/\u001b\[(\d+)X/g) ?? [];
  const echRuns = ech.map((s2) => parseInt(s2.replace(/[^0-9]/g, ""), 10));
  results["analyze"] = {
    file,
    trimmed: trim,
    finalRows: lines.length,
    markers: [...present].sort(),
    markerCount: present.size,
    rowLens: lines.map((l) => l.length),
    erasedPrefixRows: lines.filter((l) => /^\s{1,}\d{4}/.test(l)),
    echCount: echRuns.length,
    echTotal: echRuns.reduce((a, b) => a + b, 0),
    echBig: echRuns.filter((n) => n >= 20).sort((a, b) => b - a).slice(0, 10),
    tail: lines.slice(-6)
  };
  ev(`analyze rows=${lines.length} markers=${present.size} ech=${echRuns.length} echBig=${JSON.stringify(results["analyze"] && results["analyze"].echBig)}`);
}
async function main() {
  ev(`start cli=${CLI} device=${device} scenario=${scenario}`);
  if (!await handshake()) {
    ev("handshake FAILED -> abort");
    results["handshake"] = false;
  } else {
    results["handshake"] = true;
    if (scenario === "rows") {
      const ks = arg("k", "24,32,39,40,48").split(",").map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
      await scenarioRows(ks, "clearhost", parseInt(arg("wide", "0"), 10));
    } else if (scenario === "flush") {
      const k = parseInt(arg("k", "60"), 10);
      const wide = parseInt(arg("wide", "0"), 10);
      const only = arg("only", "");
      if (only !== "clearhost") {
        await scenarioRows([k], "blank60", wide);
      }
      if (only !== "blank60") {
        await scenarioRows([k], "clearhost", wide);
      }
    } else if (scenario === "pages") {
      await scenarioPages(
        parseInt(arg("k", "30"), 10),
        parseInt(arg("wide", "0"), 10),
        parseInt(arg("pagerows", "26"), 10)
      );
    } else if (scenario === "wrap") {
      await scenarioWrap(parseInt(arg("len", "200"), 10));
    } else if (scenario === "rt") {
      await scenarioRt(parseInt(arg("rounds", "5"), 10));
    } else {
      ev(`unknown scenario ${scenario}`);
    }
    analyzeRaw();
  }
  try {
    child.stdin.write("exit" + CRLF);
  } catch {
  }
  await sleep(600);
  child.kill();
  (0, import_fs.writeFileSync)(`${base}.raw`, Buffer.concat(raw));
  (0, import_fs.writeFileSync)(`${base}.json`, JSON.stringify(results, null, 2));
  (0, import_fs.appendFileSync)(`${base}.log`, events.join(LF) + LF);
  ev(`artifacts: ${base}.raw / .json / .log`);
}
main().catch((e) => {
  ev(`ERROR ${e instanceof Error ? e.message : String(e)}`);
  try {
    child.stdin.write("exit" + CRLF);
  } catch {
  }
  setTimeout(() => {
    try {
      child.kill();
    } catch {
    }
  }, 600);
  (0, import_fs.appendFileSync)(`${base}.log`, events.join(LF) + LF);
  process.exit(1);
});
