/**
 * protocol-regress: 离线回归基线（不触远程）。
 *
 * 输入：tests/fixtures/*.raw —— 真机抓取的**原始 stdout 字节流**（2026-09-19，4.41.0.2311）。
 * 做法：把 raw 重放进 VtScreen，断言「结构不变量」与「证据读数」。
 *
 * 用法：node tools/protocol-regress.cjs [--verbose]
 * 复现：npx esbuild tools/protocol-regress.ts --bundle --platform=node --outfile=tools/protocol-regress.cjs
 *
 * 断言分两类：
 *  1. 结构不变量（模型正确性）：屏上行数 ≤ 39、行宽 ≤ 120、marker 不跨行粘连
 *  2. 证据读数（与真机观测对齐）：存在/缺失的 marker、marker 数量
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { VtScreen, VIEWPORT_COLS, VIEWPORT_ROWS } from '../src/vt';

interface Fixture {
  /** 文件名（tests/fixtures/ 下） */
  file: string;
  /** 说明 */
  what: string;
  /** 会话退出序列会清屏，必须裁掉；这里给出裁剪锚点（取最后一个命中的锚点之前的内容） */
  /** 可选：自定义裁剪锚点（默认用最后一次 OSC 标题） */
  cutAt?: number;
  /** marker 提取正则 */
  marker: string;
  /** 必须存在的 marker */
  present?: string[];
  /** 必须不存在的 marker */
  absent?: string[];
  /** marker 精确数量 */
  count?: number;
  /** marker 数量区间（宽行场景随模型而变，只约束边界） */
  countRange?: [number, number];
  /** marker 必须是完整序列的后缀（滚动语义：活下来的一定是尾部） */
  suffixOf?: { prefix: string; from: number; to: number; pad: number };
  /** 附加断言 */
  singleRowContains?: string;
}

const DIR = join(__dirname, '..', 'tests', 'fixtures');

const FIXTURES: Fixture[] = [
  {
    file: 'rows-capacity-k38.raw',
    what: '容量二分：k=38（超出 39 行视口，首行应被逐出）',
    marker: 'M\\d{4}',
    count: 37,
    absent: ['M0001'],
    present: ['M0038'],
  },
  {
    file: 'rows-capacity-k48.raw',
    what: '容量二分：k=48（远超视口，仅保留尾部连续段）',
    marker: 'M\\d{4}',
    countRange: [34, 39],
    absent: ['M0001'],
    present: ['M0048'],
    suffixOf: { prefix: 'M', from: 1, to: 48, pad: 4 },
  },
  {
    file: 'rows-wide100-k37.raw',
    what: '短行（100 列）37 行：视口内，应全部保留',
    marker: 'M\\d{4}',
    count: 37,
    present: ['M0001', 'M0037'],
  },
  {
    file: 'rows-wide200-k26.raw',
    what: '宽行（205 列）26 行：折行后 52 屏行 > 39，仅尾部存活',
    marker: 'M\\d{4}',
    countRange: [10, 26],
    suffixOf: { prefix: 'M', from: 1, to: 26, pad: 4 },
  },
  {
    file: 'rows-wide200-k39.raw',
    what: '宽行（205 列）39 行：折行后 78 屏行 > 39，仅尾部存活',
    marker: 'M\\d{4}',
    countRange: [8, 39],
    suffixOf: { prefix: 'M', from: 1, to: 39, pad: 4 },
  },
  {
    file: 'flush-short-k60.raw',
    what: '短行 k=60（blank60 + Clear-Host）：容量上限 37',
    marker: 'M\\d{4}',
    count: 37,
    absent: ['M0001'],
  },
  {
    file: 'flush-wide200-k45.raw',
    what: '宽行 k=45：折行溢出，只保留尾部',
    marker: 'M\\d{4}',
    countRange: [8, 45],
    suffixOf: { prefix: 'M', from: 1, to: 45, pad: 4 },
  },
  {
    file: 'pages-short-control.raw',
    what: '分页对照（短行）：page 26..29 之前有 Clear-Host，必须没有 page 1 残留',
    marker: 'P\\d{2}',
    present: ['P27', 'P28', 'P29', 'P30'],
    absent: ['P01', 'P10', 'P26'],  // 旧模型在此把 page1 残留当成当前输出
  },
  {
    file: 'pages-wide.raw',
    what: '分页宽行：page 1 的残留必须被 Clear-Host 清掉（旧模型在此失败）',
    marker: 'P\\d{2}',
    absent: ['P01', 'P10', 'P26'],
  },
  {
    file: 'wrap-104.raw',
    what: '单行 116 列（≤120）：不应折行，WWSTART/WWEND 同一行',
    marker: 'WWSTART',
    singleRowContains: 'WWSTART',
  },
];

/** 剥掉末尾的擦除/定位/空白序列（teardown 遗留，不含内容） */
/** 剥掉末尾的擦除/定位/空白序列（teardown 遗留，不含内容） */
function stripTrailingErases(s: string): string {
  const tailRe = /(?:\u001b\[[0-9;?]*[HKJ]|\s)+$/;
  let prev = '';
  let cur = s;
  while (prev !== cur) {
    prev = cur;
    cur = cur.replace(tailRe, '');
  }
  return cur;
}

function check(f: Fixture): { ok: boolean; lines: string[] } {
  const raw = readFileSync(join(DIR, f.file), 'utf8');
  // 会话退出会自带一段「擦行 + ESC[H + OSC 标题」的 teardown；不裁掉会把回放结果清空。
  // 锚点 = 最后一次 OSC 标题（teardown 特征），再剥掉紧邻的擦除/定位序列。
  // teardown 特征 = ESC[H 紧跟 OSC 标题；没有这个特征的文件不该裁（否则会把整段内容裁掉）
  const teardownIdx = raw.lastIndexOf('\u001b[H\u001b]0;');
  const cut = f.cutAt !== undefined ? f.cutAt : teardownIdx;
  const trimmed = cut > 0 ? raw.slice(0, cut) : raw;
  const body = stripTrailingErases(trimmed);
  const screen = new VtScreen();
  screen.feed(body);
  const rows = screen.snapshotLines();
  const lens = rows.map((l) => l.length);
  const maxRowLen = lens.length ? Math.max(...lens) : 0;
  const re = new RegExp(f.marker, 'g');
  const found = new Set<string>();
  for (const l of rows) {
    for (const m of l.match(re) ?? []) {
      found.add(m);
    }
  }
  const markers = [...found].sort();
  const out: string[] = [];
  let ok = true;

  const fail = (msg: string) => {
    ok = false;
    out.push(`    ✗ ${msg}`);
  };

  if (rows.length > VIEWPORT_ROWS) {
    fail(`屏上行数 ${rows.length} > ${VIEWPORT_ROWS}（模型未做视口裁剪）`);
  }
  if (maxRowLen > VIEWPORT_COLS) {
    fail(`最大行宽 ${maxRowLen} > ${VIEWPORT_COLS}（模型未折行）`);
  }
  if (f.count !== undefined && markers.length !== f.count) {
    fail(`marker 数量 ${markers.length} ≠ 期望 ${f.count}`);
  }
  if (f.countRange && (markers.length < f.countRange[0] || markers.length > f.countRange[1])) {
    fail(`marker 数量 ${markers.length} 不在区间 [${f.countRange[0]}, ${f.countRange[1]}]`);
  }
  for (const p of f.present ?? []) {
    if (!found.has(p)) {
      fail(`缺少 marker ${p}`);
    }
  }
  for (const a of f.absent ?? []) {
    if (found.has(a)) {
      fail(`不应存在 marker ${a}（旧内容残留/未逐出）`);
    }
  }
  if (f.suffixOf) {
    const want = new Set<string>();
    for (let i = f.suffixOf.from; i <= f.suffixOf.to; i++) {
      want.add(f.suffixOf.prefix + String(i).padStart(f.suffixOf.pad, '0'));
    }
    const sorted = markers.filter((m) => want.has(m));
    const fullOrder = [...want].sort();
    const lastIdx = fullOrder.indexOf(sorted[sorted.length - 1]);
    const expected = fullOrder.slice(lastIdx - sorted.length + 1, lastIdx + 1);
    if (JSON.stringify(expected) !== JSON.stringify(sorted)) {
      fail(`存活 marker 不是尾部连续段：${sorted[0]}..${sorted[sorted.length - 1]}（期望 ${expected[0]}..${expected[expected.length - 1]}）`);
    }
  }
  if (f.singleRowContains) {
    const hits = rows.filter((l) => l.includes(f.singleRowContains));
    if (hits.length !== 1) {
      fail(`应恰有 1 行含 ${f.singleRowContains}，实得 ${hits.length}`);
    }
  }
  out.unshift(`  ${ok ? 'PASS' : 'FAIL'} ${f.file} — ${f.what}`);
  out.push(`    rows=${rows.length} maxRowLen=${maxRowLen} markers=${markers.length}${markers.length ? ` [${markers[0]}..${markers[markers.length - 1]}]` : ''}`);
  return { ok, lines: out };
}

const verbose = process.argv.includes('--verbose');
const results = FIXTURES.map(check);
for (const r of results) {
  if (verbose || !r.ok) {
    for (const l of r.lines) {
      console.log(l);
    }
  } else {
    console.log(r.lines[0]);
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== ${results.length - failed}/${results.length} PASS（视口常量 ${VIEWPORT_ROWS} 行 × ${VIEWPORT_COLS} 列） ==`);
process.exit(failed > 0 ? 1 : 0);
