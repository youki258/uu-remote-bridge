/**
 * protocol-probe: uuyc-cli term 通道「服务端行为」只读取证工具（P1）。
 *
 * 定位：本项目全部健壮性建立在逆推的服务端渲染/握手行为上，此工具把那些经验值
 * 变成「带原始字节证据、可复验」的常量。**只发只读命令，不写远程文件、不改远程状态。**
 *
 * 用法（bundle 后）：
 *   node tools/protocol-probe.cjs rows   --device <id> --k 24,32,39,40,48
 *   node tools/protocol-probe.cjs flush  --device <id> --k 60
 *   node tools/protocol-probe.cjs wrap   --device <id> --len 200
 *   node tools/protocol-probe.cjs rt     --device <id> --rounds 5
 *
 * 产物（默认 %TEMP%\uu-evidence）：
 *   <scenario>-<stamp>.raw   纯 stdout 字节流（可离线重放，供 VtScreen 复核）
 *   <scenario>-<stamp>.log   带时间戳的事件流水（人读证据）
 *   <scenario>-<stamp>.json  结构化结论
 *
 * 复现：npx esbuild tools/protocol-probe.ts --bundle --platform=node --outfile=tools/protocol-probe.cjs
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VtScreen } from '../src/vt';

const CLI = process.env['UU_CLI_PATH'] ?? 'C:\\Program Files\\Netease\\GameViewer\\bin\\uuyc-cli.exe';
const POLL_MS = 120;
const CRLF = String.fromCharCode(13, 10);
const LF = String.fromCharCode(10);

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? '') : fallback;
}

const scenario = process.argv[2] ?? '';
const device = arg('device');
const outDir = arg('out', join(tmpdir(), 'uu-evidence'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = join(outDir, `${scenario}-${stamp}`);

if (!scenario || (!device && scenario !== 'analyze')) {
  console.error('usage: protocol-probe <rows|flush|pages|wrap|rt|analyze> --device <id> [--k 24,32] [--wide 200] [--pagerows 26] [--len 200] [--rounds 5] [--only blank60|clearhost] [--file <raw>] [--trim 0] [--out <dir>]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const raw: Buffer[] = [];
const events: string[] = [];
let lastDataAt = Date.now();
const t0 = Date.now();

function ev(line: string): void {
  const ms = Date.now() - t0;
  events.push(`[+${String(ms).padStart(6)}ms] ${line}`);
  console.log(`[+${ms}ms] ${line}`);
}

const results: Record<string, unknown> = { scenario, device, cli: CLI, startedAt: new Date().toISOString() };
const screen = new VtScreen();

// analyze 是纯离线模式：不建会话、不触通道
if (scenario === 'analyze') {
  analyzeFile(arg('file', ''));
  writeFileSync(`${base}.json`, JSON.stringify(results, null, 2));
  appendFileSync(`${base}.log`, events.join('\n') + '\n');
  process.exit(0);
}

const child = spawn(CLI, ['term', '--device-id', device, '--new-session', '--shell', 'powershell'], {
  windowsHide: true,
}) as ChildProcessWithoutNullStreams;
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d: string) => {
  lastDataAt = Date.now();
  raw.push(Buffer.from(d, 'utf8'));
  screen.feed(d);
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d: string) => {
  for (const l of d.split(/\r?\n/)) {
    if (l.trim()) {
      ev(`STDERR ${l.trim()}`);
    }
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 哨兵必须用「表达式拼接」下发：输入回显里不能出现完整哨兵字面量，
 * 否则 waitSentry 会被回显提前命中（假阳性）。这是 TermBridge 的实测经验，探针同样必须遵守。
 */
function sentryExpr(s: string): string {
  return `("${s.slice(0, 4)}" + "${s.slice(4)}")`;
}

/** 哨兵 + 服务端计数（计数表达式必须放在双引号字符串内部，否则 PS 解析报「意外的标记」） */
function sentryExprCount(s: string, expr: string): string {
  return `("${s.slice(0, 4)}" + "${s.slice(4)}${expr}")`;
}

function send(cmd: string): void {
  screen.reset();
  child.stdin.write(cmd + '\r\n');
}

async function waitSentry(sentry: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    await sleep(POLL_MS);
    if (screen.snapshotLines().some((l) => l.includes(sentry))) {
      return true;
    }
    if (Date.now() - start > timeoutMs) {
      return false;
    }
  }
}

/** 哨兵到达后等服务端渲染流静默(与 TermBridge.settle 同语义,便于对比) */
async function settle(quietMs = 500, maxMs = 2500): Promise<number> {
  const start = Date.now();
  for (;;) {
    const idle = Date.now() - lastDataAt;
    if (idle >= quietMs || Date.now() - start >= maxMs) {
      return Date.now() - start;
    }
    await sleep(60);
  }
}

function snap(): string[] {
  return screen.snapshotLines();
}

async function handshake(): Promise<boolean> {
  const ok = await (async () => {
    send(`Clear-Host; Write-Output ${sentryExpr('UU_R_0')}`);
    return waitSentry('UU_R_0', 20000);
  })();
  ev(`handshake=${ok}`);
  return ok;
}

/** S2/S5: 服务端屏幕临界行数与冲刷方式对比
 *  wideLen > 0 时每个 marker 行填充 wideLen 个 '#'，用于复现 F-3「宽行被差分渲染器替换为 ECH 碎片」 */
async function scenarioRows(ks: number[], mode: 'clearhost' | 'blank60', wideLen = 0): Promise<void> {
  const perK: unknown[] = [];
  for (const k of ks) {
    const sentry = `SENT_${k}_${Date.now() % 100000}`;
    const body = wideLen > 0 ? `'M' + $_.ToString('0000') + ('#' * ${wideLen})` : `'M' + $_.ToString('0000')`;
    const markers = `1..${k} | ForEach-Object { ${body} }`;
    const pre = mode === 'blank60' ? `Write-Output ("\`n" * 60); ` : 'Clear-Host; ';
    send(`${pre}${markers}; Write-Output ${sentryExpr(sentry)}`);
    const hit = await waitSentry(sentry, 120000);
    const quietFor = hit ? await settle() : -1;
    const lines = snap();
    const present = new Set<string>();
    for (const l of lines) {
      for (const m of l.match(/M\d{4}/g) ?? []) {
        present.add(m);
      }
    }
    // 行内容完整性：出现「前缀被擦」症状（空白 + 4 位数字）或行宽不符
    const erasedPrefix = lines.filter((l) => /^\s{1,}\d{4}/.test(l)).length;
    const markerLines = lines.filter((l) => /M\d{4}/.test(l));
    const lens = markerLines.map((l) => l.length);
    const expectedLen = wideLen > 0 ? wideLen + 5 : 5;
    const shortLines = lens.filter((n) => n < expectedLen).length;
    const firstPresent = present.has('M0001');
    const lastExpected = `M${String(k).padStart(4, '0')}`;
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
      tail: lines.slice(-3),
    });
    ev(
      `rows mode=${mode} wide=${wideLen} k=${k} hit=${hit} markers=${present.size} first=${firstPresent} last=${present.has(lastExpected)} erased=${erasedPrefix} shortLines=${shortLines} minLen=${perK[perK.length - 1] && (perK[perK.length - 1] as { minLineLen: number }).minLineLen}`,
    );
    await settle(300, 1000);
  }
  results['mode'] = mode;
  results['wideLen'] = wideLen;
  results['perK'] = perK;
}

/** 精确复刻 TermBridge 的 assign + pullPages 时序（含 BEGIN 标记、每页换新哨兵），逐页取证 */
async function scenarioPages(k: number, wide: number, pageRows = 26): Promise<void> {
  const countSentry = `CNT_${Date.now() % 100000}`;
  const body = wide > 0 ? `'P' + $_.ToString('00') + ('x' * ${wide})` : `'P' + $_.ToString('00')`;
  send(`Clear-Host; Write-Output ('UU_B' + 'EGIN'); $global:uuOut = @(1..${k} | ForEach-Object { ${body} }); ${sentryExprCount(countSentry, '$($global:uuOut.Count)')}`);
  const hit = await waitSentry(countSentry, 120000);
  await settle();
  const cntLine = snap().find((l) => l.includes(countSentry)) ?? '';
  const count = parseInt((new RegExp(`${countSentry}(\\d+)`).exec(cntLine) ?? [])[1] ?? '0', 10);
  ev(`assign sentryHit=${hit} reportedCount=${count} (expected ${k})`);

  const pages: unknown[] = [];
  for (let start = 0; start < k; start += pageRows) {
    const end = Math.min(start + pageRows - 1, k - 1);
    const sentry = `PG_${start}_${Date.now() % 100000}`;
    send(`Clear-Host; Write-Output ('UU_B' + 'EGIN'); $global:uuOut[${start}..${end}]; ${sentryExpr(sentry)}`);
    const phit = await waitSentry(sentry, 120000);
    await settle();
    const lines = snap();
    const present = new Set<string>();
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
      tail: lines.slice(-3),
    });
    ev(`page ${start}..${end} expected=${expected} sentry=${phit} screenRows=${lines.length} markers=${present.size} maxRowLen=${pages[pages.length - 1] && (pages[pages.length - 1] as { maxRowLen: number }).maxRowLen} first=${[...present].sort()[0] ?? '-'} last=${[...present].sort().slice(-1)[0] ?? '-'}`);
    await settle(300, 1000);
  }
  results['k'] = k;
  results['wide'] = wide;
  results['pageRows'] = pageRows;
  results['assignReportedCount'] = count;
  results['pages'] = pages;
}

/** S3: 单行长文本是否被折行渲染 */
async function scenarioWrap(len: number): Promise<void> {
  const sentry = `WEND_${Date.now() % 100000}`;
  send(`Clear-Host; Write-Output ('WWSTART' + ('A' * ${len}) + 'WWEND'); Write-Output ${sentryExpr(sentry)}`);
  const hit = await waitSentry(sentry, 60000);
  await settle();
  const lines = snap();
  const startLine = lines.findIndex((l) => l.includes('WWSTART'));
  const endLine = lines.findIndex((l) => l.includes('WWEND'));
  const startIdx = startLine >= 0 ? lines[startLine].indexOf('WWSTART') : -1;
  const endIdx = endLine >= 0 ? lines[endLine].indexOf('WWEND') : -1;
  const maxLen = lines.reduce((m, l) => Math.max(m, l.length), 0);
  results['len'] = len;
  results['sentryHit'] = hit;
  results['startLine'] = startLine;
  results['endLine'] = endLine;
  results['wrapped'] = startLine >= 0 && endLine >= 0 && endLine !== startLine;
  results['startIdx'] = startIdx;
  results['endIdx'] = endIdx;
  results['aCount'] = (lines.join('\n').match(/A/g) ?? []).length;
  results['maxLineLen'] = maxLen;
  results['snapshot'] = lines;
  ev(`wrap len=${len} hit=${hit} startLine=${startLine} endLine=${endLine} wrapped=${endLine !== startLine} aCount=${results['aCount']} maxLen=${maxLen}`);
}

/** S7: 命令往返延迟分布 */
async function scenarioRt(rounds: number): Promise<void> {
  const samples: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const sentry = `RT_${i}_${Date.now() % 100000}`;
    const t = Date.now();
    send(`Clear-Host; Write-Output ${sentryExpr(sentry)}`);
    const hit = await waitSentry(sentry, 60000);
    const dt = Date.now() - t;
    await settle();
    const total = Date.now() - t;
    samples.push(total);
    ev(`rt#${i} sentryHit=${hit} toSentry=${dt}ms settled=${total}ms`);
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
  results['rounds'] = rounds;
  results['toSettledMs'] = samples;
  results['min'] = min;
  results['avg'] = avg;
  results['max'] = max;
  ev(`rt summary min=${min} avg=${avg} max=${max}`);
}

/** 抓取 stdout 原始字节里的渲染事件统计（ECH / 全屏重绘 / CSI 总量） */
function analyzeRaw(): void {
  const buf = Buffer.concat(raw).toString('utf8');
  const count = (re: RegExp) => (buf.match(re) ?? []).length;
  results['rawStats'] = {
    bytes: Buffer.byteLength(buf),
    csiTotal: count(/\u001b\[/g),
    fullRedraw2J: count(/\u001b\[2J/g),
    eraseInLineK: count(/\u001b\[[0-9]*K/g),
    eraseCharX: count(/\u001b\[[0-9]*X/g),
    cursorHome: count(/\u001b\[H/g),
    maxEchRun: (buf.match(/\u001b\[(\d+)X/g) ?? []).reduce((m, s) => {
      const v = parseInt(s.replace(/[^0-9]/g, ''), 10);
      return Number.isFinite(v) ? Math.max(m, v) : m;
    }, 0),
  };
  ev(`rawStats ${JSON.stringify(results['rawStats'])}`);
}

/** 离线重放:把一份 .raw 字节流重新喂进 VtScreen，输出最终屏幕与行宽/擦除统计 */
function analyzeFile(file: string): void {
  if (!file) {
    ev('analyze 需要 --file <raw 路径>');
    return;
  }
  const text = readFileSync(file, 'utf8');
  const trim = parseInt(arg('trim', '0'), 10);
  const body = trim > 0 ? text.slice(0, Math.max(0, text.length - trim)) : text;
  const s = new VtScreen();
  s.feed(body);
  const lines = s.snapshotLines();
  const markerLines = lines.filter((l) => /M\d{4}/.test(l));
  const present = new Set<string>();
  for (const l of lines) {
    for (const m of l.match(/M\d{4}/g) ?? []) {
      present.add(m);
    }
  }
  const ech = text.match(/\u001b\[(\d+)X/g) ?? [];
  const echRuns = ech.map((s2) => parseInt(s2.replace(/[^0-9]/g, ''), 10));
  results['analyze'] = {
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
    tail: lines.slice(-6),
  };
  ev(`analyze rows=${lines.length} markers=${present.size} ech=${echRuns.length} echBig=${JSON.stringify(results['analyze'] && (results['analyze'] as { echBig: number[] }).echBig)}`);
}

async function main(): Promise<void> {
  ev(`start cli=${CLI} device=${device} scenario=${scenario}`);
  if (!(await handshake())) {
    ev('handshake FAILED -> abort');
    results['handshake'] = false;
  } else {
    results['handshake'] = true;
    if (scenario === 'rows') {
      const ks = arg('k', '24,32,39,40,48').split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite);
      await scenarioRows(ks, 'clearhost', parseInt(arg('wide', '0'), 10));
    } else if (scenario === 'flush') {
      const k = parseInt(arg('k', '60'), 10);
      const wide = parseInt(arg('wide', '0'), 10);
      const only = arg('only', '');
      if (only !== 'clearhost') {
        await scenarioRows([k], 'blank60', wide);
      }
      if (only !== 'blank60') {
        await scenarioRows([k], 'clearhost', wide);
      }
    } else if (scenario === 'pages') {
      await scenarioPages(
        parseInt(arg('k', '30'), 10),
        parseInt(arg('wide', '0'), 10),
        parseInt(arg('pagerows', '26'), 10),
      );
    } else if (scenario === 'wrap') {
      await scenarioWrap(parseInt(arg('len', '200'), 10));
    } else if (scenario === 'rt') {
      await scenarioRt(parseInt(arg('rounds', '5'), 10));
    } else {
      ev(`unknown scenario ${scenario}`);
    }
    analyzeRaw();
  }

  try {
    child.stdin.write('exit' + CRLF);
  } catch {
    /* 进程可能已退出 */
  }
  await sleep(600);
  child.kill();
  writeFileSync(`${base}.raw`, Buffer.concat(raw));
  writeFileSync(`${base}.json`, JSON.stringify(results, null, 2));
  appendFileSync(`${base}.log`, events.join(LF) + LF);
  ev(`artifacts: ${base}.raw / .json / .log`);
}

main().catch((e) => {
  ev(`ERROR ${e instanceof Error ? e.message : String(e)}`);
  // 异常路径也必须发 exit，否则远程会话会残留（实测泄漏 session2/session3）
  try {
    child.stdin.write('exit' + CRLF);
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }, 600);
  appendFileSync(`${base}.log`, events.join(LF) + LF);
  process.exit(1);
});
