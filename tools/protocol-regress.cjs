// tools/protocol-regress.ts
var import_fs = require("fs");
var import_path = require("path");

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
    const arg = (s, dflt = 1) => parseInt(s || String(dflt), 10) || dflt;
    switch (final) {
      case "H":
      case "f": {
        const [r, c] = params.split(";");
        this.cursorRow = clamp(arg(r, 1), 1, VIEWPORT_ROWS);
        this.cursorCol = clamp(arg(c, 1), 1, VIEWPORT_COLS + 1);
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
        const n = Math.min(arg(params, 1), VIEWPORT_COLS);
        const row = this.getRow(this.cursorRow);
        const start = this.cursorCol - 1;
        const before = row.substring(0, start).padEnd(start, " ");
        const after = row.substring(start + n);
        this.setRow(this.cursorRow, (before + " ".repeat(n) + after).replace(/\s+$/, ""));
        break;
      }
      case "A":
        this.cursorRow = clamp(this.cursorRow - arg(params, 1), 1, VIEWPORT_ROWS);
        break;
      case "B":
        this.cursorRow = clamp(this.cursorRow + arg(params, 1), 1, VIEWPORT_ROWS);
        break;
      case "C":
        this.cursorCol = clamp(this.cursorCol + arg(params, 1), 1, VIEWPORT_COLS + 1);
        break;
      case "D":
        this.cursorCol = clamp(this.cursorCol - arg(params, 1), 1, VIEWPORT_COLS);
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

// tools/protocol-regress.ts
var DIR = (0, import_path.join)(__dirname, "..", "tests", "fixtures");
var FIXTURES = [
  {
    file: "rows-capacity-k38.raw",
    what: "\u5BB9\u91CF\u4E8C\u5206\uFF1Ak=38\uFF08\u8D85\u51FA 39 \u884C\u89C6\u53E3\uFF0C\u9996\u884C\u5E94\u88AB\u9010\u51FA\uFF09",
    marker: "M\\d{4}",
    count: 37,
    absent: ["M0001"],
    present: ["M0038"]
  },
  {
    file: "rows-capacity-k48.raw",
    what: "\u5BB9\u91CF\u4E8C\u5206\uFF1Ak=48\uFF08\u8FDC\u8D85\u89C6\u53E3\uFF0C\u4EC5\u4FDD\u7559\u5C3E\u90E8\u8FDE\u7EED\u6BB5\uFF09",
    marker: "M\\d{4}",
    countRange: [34, 39],
    absent: ["M0001"],
    present: ["M0048"],
    suffixOf: { prefix: "M", from: 1, to: 48, pad: 4 }
  },
  {
    file: "rows-wide100-k37.raw",
    what: "\u77ED\u884C\uFF08100 \u5217\uFF0937 \u884C\uFF1A\u89C6\u53E3\u5185\uFF0C\u5E94\u5168\u90E8\u4FDD\u7559",
    marker: "M\\d{4}",
    count: 37,
    present: ["M0001", "M0037"]
  },
  {
    file: "rows-wide200-k26.raw",
    what: "\u5BBD\u884C\uFF08205 \u5217\uFF0926 \u884C\uFF1A\u6298\u884C\u540E 52 \u5C4F\u884C > 39\uFF0C\u4EC5\u5C3E\u90E8\u5B58\u6D3B",
    marker: "M\\d{4}",
    countRange: [10, 26],
    suffixOf: { prefix: "M", from: 1, to: 26, pad: 4 }
  },
  {
    file: "rows-wide200-k39.raw",
    what: "\u5BBD\u884C\uFF08205 \u5217\uFF0939 \u884C\uFF1A\u6298\u884C\u540E 78 \u5C4F\u884C > 39\uFF0C\u4EC5\u5C3E\u90E8\u5B58\u6D3B",
    marker: "M\\d{4}",
    countRange: [8, 39],
    suffixOf: { prefix: "M", from: 1, to: 39, pad: 4 }
  },
  {
    file: "flush-short-k60.raw",
    what: "\u77ED\u884C k=60\uFF08blank60 + Clear-Host\uFF09\uFF1A\u5BB9\u91CF\u4E0A\u9650 37",
    marker: "M\\d{4}",
    count: 37,
    absent: ["M0001"]
  },
  {
    file: "flush-wide200-k45.raw",
    what: "\u5BBD\u884C k=45\uFF1A\u6298\u884C\u6EA2\u51FA\uFF0C\u53EA\u4FDD\u7559\u5C3E\u90E8",
    marker: "M\\d{4}",
    countRange: [8, 45],
    suffixOf: { prefix: "M", from: 1, to: 45, pad: 4 }
  },
  {
    file: "pages-short-control.raw",
    what: "\u5206\u9875\u5BF9\u7167\uFF08\u77ED\u884C\uFF09\uFF1Apage 26..29 \u4E4B\u524D\u6709 Clear-Host\uFF0C\u5FC5\u987B\u6CA1\u6709 page 1 \u6B8B\u7559",
    marker: "P\\d{2}",
    present: ["P27", "P28", "P29", "P30"],
    absent: ["P01", "P10", "P26"]
    // 旧模型在此把 page1 残留当成当前输出
  },
  {
    file: "pages-wide.raw",
    what: "\u5206\u9875\u5BBD\u884C\uFF1Apage 1 \u7684\u6B8B\u7559\u5FC5\u987B\u88AB Clear-Host \u6E05\u6389\uFF08\u65E7\u6A21\u578B\u5728\u6B64\u5931\u8D25\uFF09",
    marker: "P\\d{2}",
    absent: ["P01", "P10", "P26"]
  },
  {
    file: "wrap-104.raw",
    what: "\u5355\u884C 116 \u5217\uFF08\u2264120\uFF09\uFF1A\u4E0D\u5E94\u6298\u884C\uFF0CWWSTART/WWEND \u540C\u4E00\u884C",
    marker: "WWSTART",
    singleRowContains: "WWSTART"
  }
];
function stripTrailingErases(s) {
  const tailRe = /(?:\u001b\[[0-9;?]*[HKJ]|\s)+$/;
  let prev = "";
  let cur = s;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(tailRe, "");
  }
  return cur;
}
function check(f) {
  const raw = (0, import_fs.readFileSync)((0, import_path.join)(DIR, f.file), "utf8");
  const teardownIdx = raw.lastIndexOf("\x1B[H\x1B]0;");
  const cut = f.cutAt !== void 0 ? f.cutAt : teardownIdx;
  const trimmed = cut > 0 ? raw.slice(0, cut) : raw;
  const body = stripTrailingErases(trimmed);
  const screen = new VtScreen();
  screen.feed(body);
  const rows = screen.snapshotLines();
  const lens = rows.map((l) => l.length);
  const maxRowLen = lens.length ? Math.max(...lens) : 0;
  const re = new RegExp(f.marker, "g");
  const found = /* @__PURE__ */ new Set();
  for (const l of rows) {
    for (const m of l.match(re) ?? []) {
      found.add(m);
    }
  }
  const markers = [...found].sort();
  const out = [];
  let ok = true;
  const fail = (msg) => {
    ok = false;
    out.push(`    \u2717 ${msg}`);
  };
  if (rows.length > VIEWPORT_ROWS) {
    fail(`\u5C4F\u4E0A\u884C\u6570 ${rows.length} > ${VIEWPORT_ROWS}\uFF08\u6A21\u578B\u672A\u505A\u89C6\u53E3\u88C1\u526A\uFF09`);
  }
  if (maxRowLen > VIEWPORT_COLS) {
    fail(`\u6700\u5927\u884C\u5BBD ${maxRowLen} > ${VIEWPORT_COLS}\uFF08\u6A21\u578B\u672A\u6298\u884C\uFF09`);
  }
  if (f.count !== void 0 && markers.length !== f.count) {
    fail(`marker \u6570\u91CF ${markers.length} \u2260 \u671F\u671B ${f.count}`);
  }
  if (f.countRange && (markers.length < f.countRange[0] || markers.length > f.countRange[1])) {
    fail(`marker \u6570\u91CF ${markers.length} \u4E0D\u5728\u533A\u95F4 [${f.countRange[0]}, ${f.countRange[1]}]`);
  }
  for (const p of f.present ?? []) {
    if (!found.has(p)) {
      fail(`\u7F3A\u5C11 marker ${p}`);
    }
  }
  for (const a of f.absent ?? []) {
    if (found.has(a)) {
      fail(`\u4E0D\u5E94\u5B58\u5728 marker ${a}\uFF08\u65E7\u5185\u5BB9\u6B8B\u7559/\u672A\u9010\u51FA\uFF09`);
    }
  }
  if (f.suffixOf) {
    const want = /* @__PURE__ */ new Set();
    for (let i = f.suffixOf.from; i <= f.suffixOf.to; i++) {
      want.add(f.suffixOf.prefix + String(i).padStart(f.suffixOf.pad, "0"));
    }
    const sorted = markers.filter((m) => want.has(m));
    const fullOrder = [...want].sort();
    const lastIdx = fullOrder.indexOf(sorted[sorted.length - 1]);
    const expected = fullOrder.slice(lastIdx - sorted.length + 1, lastIdx + 1);
    if (JSON.stringify(expected) !== JSON.stringify(sorted)) {
      fail(`\u5B58\u6D3B marker \u4E0D\u662F\u5C3E\u90E8\u8FDE\u7EED\u6BB5\uFF1A${sorted[0]}..${sorted[sorted.length - 1]}\uFF08\u671F\u671B ${expected[0]}..${expected[expected.length - 1]}\uFF09`);
    }
  }
  if (f.singleRowContains) {
    const hits = rows.filter((l) => l.includes(f.singleRowContains));
    if (hits.length !== 1) {
      fail(`\u5E94\u6070\u6709 1 \u884C\u542B ${f.singleRowContains}\uFF0C\u5B9E\u5F97 ${hits.length}`);
    }
  }
  out.unshift(`  ${ok ? "PASS" : "FAIL"} ${f.file} \u2014 ${f.what}`);
  out.push(`    rows=${rows.length} maxRowLen=${maxRowLen} markers=${markers.length}${markers.length ? ` [${markers[0]}..${markers[markers.length - 1]}]` : ""}`);
  return { ok, lines: out };
}
var verbose = process.argv.includes("--verbose");
var results = FIXTURES.map(check);
for (const r of results) {
  if (verbose || !r.ok) {
    for (const l of r.lines) {
      console.log(l);
    }
  } else {
    console.log(r.lines[0]);
  }
}
var failed = results.filter((r) => !r.ok).length;
console.log(`
== ${results.length - failed}/${results.length} PASS\uFF08\u89C6\u53E3\u5E38\u91CF ${VIEWPORT_ROWS} \u884C \xD7 ${VIEWPORT_COLS} \u5217\uFF09 ==`);
process.exit(failed > 0 ? 1 : 0);
