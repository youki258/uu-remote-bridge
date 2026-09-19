/**
 * 简化 ANSI/VT 屏幕模拟器。
 *
 * uuyc-cli term 通道的实测行为(4.41.0.2311,2026-09-19 逆推,详见 PROTOCOL.md):
 * - 服务端虚拟屏为 **39 行 × 120 列**（二分实测：k=37 全在 / k=38 首行即丢；`ESC[8;30;120t`）
 * - 超长行按 120 列**自动折行**（服务端依赖终端 autowrap），因此模型必须实现折行与滚动逐出，
 *   否则宽行内容会被拼进同一“行”（旧实现实测 maxRowLen=4450）
 * - 输出超过屏幕高度会被服务端丢弃(滚出屏幕的行不会再下发) → 必须分页读取
 * - 交互输入会触发一次 2J + 全屏重绘
 * - 连接日志([连接] ...)走 stderr,stdout 只有终端数据
 *
 * 因此解析 term 输出必须以"屏幕快照"为单位,而非简单行流。
 */

/** 服务端虚拟屏几何（2026-09-19 实测逆推：PROTOCOL.md §1）——二分实测容量 39 行；
 * `ESC[8;30;120t` 与「118 列不折 / 121 列折」定出 120 列。 */
export const VIEWPORT_ROWS = 39;
export const VIEWPORT_COLS = 120;

/** 从文本中剔除 ANSI 转义序列(CSI + OSC + 单字符转义) */
export function stripAnsiSequences(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/(?:\u001B\[[0-9;?]*[ -/]*[@-~])|(?:\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\))|(?:\u001B[@-Z\\-_])/g, '');
}

export class VtScreen {
  /** 视口行（index 0 = 屏上第 1 行），长度恒 ≤ VIEWPORT_ROWS，溢出时从顶部逐出 */
  private rows: string[] = [];
  private cursorRow = 1;
  private cursorCol = 1;
  private pending = '';
  /** 自上次 reset() 后被写过的行（脏行跟踪，用于区分「本命令输出」与「残留」） */
  private dirty = new Set<number>();

  /** 喂入原始字节流(可分多次;转义序列跨 chunk 也安全,残留在 pending 中) */
  feed(chunk: string): void {
    let text = this.pending + chunk;
    this.pending = '';
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\u001B') {
        const seq = matchEscape(text, i);
        if (seq) {
          this.applyEscape(seq.seq);
          i += seq.len;
          continue;
        }
        // 转义序列不完整(跨 chunk 边界),留待下一个 chunk
        this.pending = text.slice(i);
        return;
      }
      if (ch === '\r') {
        this.cursorCol = 1;
      } else if (ch === '\n') {
        this.cursorCol = 1;
        this.lineFeed();
      } else if (ch !== '\u0007' && ch !== '\u0000') {
        this.writeChar(ch);
      }
      i++;
    }
  }

  private getRow(r: number): string {
    return this.rows[r - 1] ?? '';
  }

  private setRow(r: number, value: string): void {
    while (this.rows.length < r) {
      this.rows.push('');
    }
    this.rows[r - 1] = value;
    this.dirty.add(r);
  }

  /** 光标下移一行；超出视口底部时整屏上移并从顶部逐出（真终端的滚动语义） */
  private lineFeed(): void {
    this.cursorRow++;
    if (this.cursorRow > VIEWPORT_ROWS) {
      this.rows.shift();
      this.rows.push('');
      this.cursorRow = VIEWPORT_ROWS;
      // 逐出后行号整体上移，脏标记需同步左移
      const moved = new Set<number>();
      for (const d of this.dirty) {
        if (d > 1) {
          moved.add(d - 1);
        }
      }
      this.dirty = moved;
    }
  }

  private writeChar(ch: string): void {
    // 自动折行：到达 120 列后再写字符 → 换到下一行第 1 列（服务端依赖终端 autowrap）
    if (this.cursorCol > VIEWPORT_COLS) {
      this.cursorCol = 1;
      this.lineFeed();
    }
    const col = this.cursorCol;
    const row = this.getRow(this.cursorRow);
    const before = row.substring(0, col - 1).padEnd(col - 1, ' ');
    const after = row.length >= col ? row.substring(col) : '';
    this.setRow(this.cursorRow, before + ch + after);
    this.cursorCol++;
  }

  private applyEscape(seq: string): void {
    // OSC(\u001b]...\u0007)与单字符转义(\u001bc 等):忽略
    if (!seq.startsWith('\u001B[')) {
      return;
    }
    const body = seq.slice(2, -1); // 去掉 ESC [ 与 final
    const final = seq[seq.length - 1];
    const params = body.replace(/^\?/, '');
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const arg = (s: string | undefined, dflt = 1) => parseInt(s || String(dflt), 10) || dflt;
    switch (final) {
      case 'H':
      case 'f': {
        const [r, c] = params.split(';');
        this.cursorRow = clamp(arg(r, 1), 1, VIEWPORT_ROWS);
        this.cursorCol = clamp(arg(c, 1), 1, VIEWPORT_COLS + 1); // +1：允许停在待折行位
        break;
      }
      case 'J': {
        const mode = params || '0';
        if (mode === '2' || mode === '3') {
          this.rows = [];
          this.dirty.clear();
          this.cursorRow = 1;
          this.cursorCol = 1;
        } else if (mode === '0') {
          // 光标到屏幕末尾清除：当前行光标之后 + 其余行
          this.setRow(this.cursorRow, this.getRow(this.cursorRow).substring(0, this.cursorCol - 1));
          for (let r = this.cursorRow + 1; r <= this.rows.length; r++) {
            this.setRow(r, '');
          }
        }
        break;
      }
      case 'K': {
        const mode = params || '0';
        const row = this.getRow(this.cursorRow);
        if (mode === '0') {
          this.setRow(this.cursorRow, row.substring(0, this.cursorCol - 1));
        } else if (mode === '1') {
          // 仅擦除光标之前：保留尾部内容
          const tail = row.substring(this.cursorCol - 1);
          this.setRow(this.cursorRow, ' '.repeat(this.cursorCol - 1) + tail);
        } else {
          this.setRow(this.cursorRow, '');
        }
        break;
      }
      case 'X': {
        // ECH(CSI X): 从光标处擦除 N 个字符,光标不动
        const n = Math.min(arg(params, 1), VIEWPORT_COLS);
        const row = this.getRow(this.cursorRow);
        const start = this.cursorCol - 1;
        const before = row.substring(0, start).padEnd(start, ' ');
        const after = row.substring(start + n);
        this.setRow(this.cursorRow, (before + ' '.repeat(n) + after).replace(/\s+$/, ''));
        break;
      }
      case 'A':
        this.cursorRow = clamp(this.cursorRow - arg(params, 1), 1, VIEWPORT_ROWS);
        break;
      case 'B':
        // 光标下移不触发滚动（真终端语义），仅限在视口内
        this.cursorRow = clamp(this.cursorRow + arg(params, 1), 1, VIEWPORT_ROWS);
        break;
      case 'C':
        this.cursorCol = clamp(this.cursorCol + arg(params, 1), 1, VIEWPORT_COLS + 1);
        break;
      case 'D':
        this.cursorCol = clamp(this.cursorCol - arg(params, 1), 1, VIEWPORT_COLS);
        break;
      default:
        // SGR(m)、模式、光标样式等:忽略
        break;
    }
  }

  /** 当前屏幕快照:非空行数组(行尾空白已修剪)，最多 VIEWPORT_ROWS 行 */
  snapshotLines(): string[] {
    const lines: string[] = [];
    for (let r = 1; r <= this.rows.length; r++) {
      lines.push((this.rows[r - 1] ?? '').replace(/\s+$/, ''));
    }
    // 去掉末尾连续空行
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  }

  /** 自上次 reset() 后被写过的行（行号 1-based，已按屏上顺序），用于区分本命令输出与残留 */
  dirtyLines(): string[] {
    return [...this.dirty]
      .sort((a, b) => a - b)
      .map((r) => (this.rows[r - 1] ?? '').replace(/\s+$/, ''));
  }

  /** 判定屏幕是否包含某文本(忽略颜色等转义后逐行查找) */
  contains(needle: string): boolean {
    return this.snapshotLines().some((l) => l.includes(needle));
  }

  /**
   * 本地模型重置。
   * 注意：服务端是**差分渲染**，本地模型必须与服务端保持一致；
   * 本方法只用于「已知服务端即将全屏重绘（如 Clear-Host）」的场合。
   */
  reset(): void {
    this.rows = [];
    this.dirty.clear();
    this.pending = '';
    this.cursorRow = 1;
    this.cursorCol = 1;
  }
}

interface EscapeMatch {
  seq: string;
  len: number;
}

/** 尝试在 text 的 i 位置匹配一个完整转义序列;不完整时返回 null */
function matchEscape(text: string, i: number): EscapeMatch | null {
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

/**
 * 从屏幕行中提取哨兵之前的"命令输出":
 * - 定位哨兵行(完全等于哨兵文本的行优先,其次为包含哨兵的行)
 * - 哨兵之上的行中剔除:PowerShell 提示符行、发送命令的回显行、空行
 */
export function extractOutput(lines: string[], sentry: string, commandEchoPrefixes: string[]): string[] {
  const idx = lines.findIndex((l) => l.trim() === sentry);
  const sentryIdx = idx >= 0 ? idx : lines.findIndex((l) => l.includes(sentry));
  if (sentryIdx < 0) {
    return [];
  }
  const out: string[] = [];
  for (const line of lines.slice(0, sentryIdx)) {
    const t = line.replace(/\s+$/, '');
    if (t === '') {
      continue;
    }
    if (/^PS [^>]*>\s*$/.test(t)) {
      continue;
    }
    if (commandEchoPrefixes.some((p) => p.length > 0 && t.startsWith(p))) {
      continue;
    }
    out.push(t);
  }
  return out;
}
