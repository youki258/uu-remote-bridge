/**
 * 简化 ANSI/VT 屏幕模拟器。
 *
 * uuyc-cli term 通道的实测行为(v4.39.2):
 * - CLI 在服务端维护一个 24 行的虚拟屏幕,stdout 发送的是屏幕渲染事件流
 *   (光标定位 CSI H + 文本、清屏 CSI 2J、清行 CSI K、SGR 颜色等)
 * - 输出超过屏幕高度会被服务端丢弃(滚出屏幕的行不会再下发)
 * - 超长行不会被按 80 列折行(2000 字符单行完整保留)
 * - 交互输入会触发一次 2J + 全屏重绘
 * - 连接日志([连接] ...)走 stderr,stdout 只有终端数据
 *
 * 因此解析 term 输出必须以"屏幕快照"为单位,而非简单行流。
 */

/** 从文本中剔除 ANSI 转义序列(CSI + OSC + 单字符转义) */
export function stripAnsiSequences(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/(?:\u001B\[[0-9;?]*[ -/]*[@-~])|(?:\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\))|(?:\u001B[@-Z\\-_])/g, '');
}

export class VtScreen {
  private rows = new Map<number, string>();
  private cursorRow = 1;
  private cursorCol = 1;
  private pending = '';

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
        this.cursorRow++;
        // CLI 输出里 \n 后列归 1 是安全的简化(定位均靠 CSI H)
        this.cursorCol = 1;
      } else if (ch !== '\u0007' && ch !== '\u0000') {
        this.writeChar(ch);
      }
      i++;
    }
  }

  private writeChar(ch: string): void {
    const row = this.getRow(this.cursorRow);
    const col = this.cursorCol; // 1-based
    const before = row.substring(0, col - 1);
    const after = row.length >= col ? row.substring(col) : '';
    const padded = before.padEnd(col - 1, ' ');
    this.rows.set(this.cursorRow, padded + ch + after);
    this.cursorCol++;
  }

  private getRow(r: number): string {
    return this.rows.get(r) ?? '';
  }

  private applyEscape(seq: string): void {
    // OSC(\u001b]...\u0007)与单字符转义(\u001bc 等):忽略
    if (!seq.startsWith('\u001B[')) {
      return;
    }
    const body = seq.slice(2, -1); // 去掉 ESC [ 与 final
    const final = seq[seq.length - 1];
    const params = body.replace(/^\?/, '');
    switch (final) {
      case 'H':
      case 'f': {
        const [r, c] = params.split(';');
        this.cursorRow = Math.max(1, parseInt(r || '1', 10) || 1);
        this.cursorCol = Math.max(1, parseInt(c || '1', 10) || 1);
        break;
      }
      case 'J': {
        const mode = params || '0';
        if (mode === '2' || mode === '3') {
          this.rows.clear();
          this.cursorRow = 1;
          this.cursorCol = 1;
        } else if (mode === '0') {
          // 光标到屏幕末尾清除:简化为清空当前行光标之后 + 其余行
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
      case 'K': {
        const mode = params || '0';
        const row = this.getRow(this.cursorRow);
        if (mode === '0') {
          this.rows.set(this.cursorRow, row.substring(0, this.cursorCol - 1));
        } else if (mode === '1') {
          this.rows.set(this.cursorRow, row.padEnd(this.cursorCol - 1, ' '));
        } else {
          this.rows.delete(this.cursorRow);
        }
        break;
      }
      case 'X': {
        // ECH(CSI X): 从光标处擦除 N 个字符,光标不动
        const n = parseInt(params || '1', 10) || 1;
        const row = this.getRow(this.cursorRow);
        const before = row.substring(0, this.cursorCol - 1);
        const after = row.substring(this.cursorCol - 1 + n);
        this.rows.set(this.cursorRow, before.padEnd(this.cursorCol - 1, ' ') + ' '.repeat(n) + after);
        break;
      }
      case 'A':
        this.cursorRow = Math.max(1, this.cursorRow - (parseInt(params || '1', 10) || 1));
        break;
      case 'B':
        this.cursorRow += parseInt(params || '1', 10) || 1;
        break;
      case 'C':
        this.cursorCol += parseInt(params || '1', 10) || 1;
        break;
      case 'D':
        this.cursorCol = Math.max(1, this.cursorCol - (parseInt(params || '1', 10) || 1));
        break;
      default:
        // SGR(m)、模式、光标样式等:忽略
        break;
    }
  }

  /** 当前屏幕快照:非空行数组(行尾空白已修剪) */
  snapshotLines(): string[] {
    const maxRow = Math.max(0, ...this.rows.keys());
    const lines: string[] = [];
    for (let r = 1; r <= maxRow; r++) {
      const line = (this.rows.get(r) ?? '').replace(/\s+$/, '');
      lines.push(line);
    }
    // 去掉末尾连续空行
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines;
  }

  /** 判定屏幕是否包含某文本(忽略颜色等转义后逐行查找) */
  contains(needle: string): boolean {
    return this.snapshotLines().some((l) => l.includes(needle));
  }

  reset(): void {
    this.rows.clear();
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
