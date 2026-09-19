/**
 * TermBridge:基于 uuyc-cli term 通道的可编程远程执行桥。
 *
 * 实测协议事实(v4.39.2,Windows 被控端 + powershell):
 * - term 通道在管道模式下完全可交互:stdin 写命令 → 远程执行 → stdout 返回
 *   服务端"虚拟屏幕"渲染流(CSI 定位 + 文本,无 \n)
 * - 服务端屏幕约 39 行;超出屏幕的输出会被丢弃(不重发),因此必须分页
 * - 长行(>~90 列)会被服务端折行渲染,但折行子行数据无损,可按页内拼接还原
 * - 输入回显会写入屏幕:命令文本中的哨兵字面会立即出现在屏幕上造成误判,
 *   因此哨兵必须用表达式拼接生成,回显中不出现完整字面
 * - 每条命令前输出 60 个换行强制滚动清屏,保证提取窗口干净
 * - 页往返固定延迟 ~600-800ms,吞吐 ~5KB/s(协议固有限制)
 * - 连接日志([连接] ...)走 stderr,与 stdout 终端数据天然分离;
 *   stderr 中的错误行(如"主控端版本过低")会并入握手失败提示
 * - 退出会话必须显式发送 exit(仅 kill 本地进程会让会话在远程残留)
 *
 * Shell 协议(powershell 已实测;zsh/bash 为 macOS/Linux 被控端的实验性实现):
 * - powershell:Write-Output ("`n" * 60) 冲刷;$uuOut=@(...) 数组;[0..25] 分页;
 *   [Convert]::ToBase64String + List[string] 传输
 * - zsh/bash:for 循环 echo 冲刷;/tmp/uuOut.$$ 临时文件 + sed -n 'a,bp' 分页;
 *   base64 + fold -w 76 传输;哨兵用相邻字符串拼接(echo "A""B")避免回显误判
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { probeCliFeatures } from './capabilities';
import { classifyTermDiagnostic } from './doctor';
import { VtScreen, VIEWPORT_COLS, VIEWPORT_ROWS } from './vt';
import type { ShellKind } from './types';

/** 正则字面量转义（把哨兵拼进 RegExp 时用） */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** PowerShell 单引号字面量转义 */
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** POSIX shell 单引号字面量转义 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface ExecOptions {
  timeoutMs?: number;
}

export class BridgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

/** 每页最大输出行数(≤ 视口 39 行,留哨兵/prompt/回显余量) */
const PAGE_ROWS = 26;
/** 单页允许占用的最大「屏行数」——折行行按 ceil(len/120) 折算；39 行视口留 4 行余量 */
const PAGE_SCREEN_ROWS = 35;

/** 行提取起始标记(与哨兵同理,拆开拼接防回显误匹配) */
const BEGIN_MARKER = 'UU_BEGIN';

interface ShellProtocol {
  /** 冲刷命令前缀(输出 FLUSH_ROWS 个空行) */
  flush(): string;
  /**
   * 会话初始化时一次性下发的远端辅助函数定义。
   * 目的：分页命令必须**短**——命令过长会在回显处折行，折行碎片被当成输出（2026-09-19 实测踩中）。
   * 长定义只在握手阶段出现，而握手输出不参与解析。
   */
  helpers(): string;
  /** 哨兵生成命令:输出 sentry,且回显中不出现完整哨兵字面 */
  sentry(sentry: string): string;
  /** 执行命令并把输出存为行数组,输出 "计数哨兵"(<countSentry><count>) */
  assignRows(cmd: string, countSentry: string): string;
  /** 分页读取已存数组的第 [start, end] 行并输出页哨兵(varName 指定服务端变量名,默认 uuOut) */
  pageRows(start: number, end: number, sentry: string, varName?: string, token?: string): string;
  /** 文件 b64 分页读取:先存入 $global:varName 数组,输出状态标记与行数哨兵 */
  storeFileB64(path: string, countSentry: string, limit: number, varName?: string): string;
  /** 写入 base64 内容(多行 chunk),输出哨兵 */
  writeFileB64(path: string, chunks: string[], sentry: string): string;
  quote(s: string): string;
}

/** 提示符/回显行过滤(PowerShell 实测;zsh 哨兵提取不依赖此项,仅防御) */
/** 冲刷命令回显的前缀残片(实测 4.41 偶发只渲染出 "Cl" 这类前缀) */
function isFlushFragment(t: string, fullCmd: string): boolean {
  const cmd = fullCmd.trim();
  return t.length >= 2 && t.length <= 24 && cmd.startsWith(t);
}

/** 回显里夹带的桥内部脚手架 token(不可能属于用户输出；含分页/读取/写入哨兵前缀) */
const SCAFFOLD_RE = /uuOut|uuF64|uuPg|uuRows|UU_B|UU_E_|UU_N_|UU_P_|UU_F_|UU_R_|UU_W_/;

function isNoiseLine(t: string, fullCmd: string): boolean {
  if (t === '' || /^PS [^>]*>\s*$/.test(t) || /^\s*[A-Za-z]:\\[^>]*>\s*$/.test(t)) {
    return true;
  }
  const em = /^PS [^>]*>\s?(.*)$/.exec(t);
  if (em && (fullCmd.startsWith(em[1].slice(0, 16)) || em[1].startsWith(fullCmd.slice(0, 16)))) {
    return true; // 输入回显行
  }
  if (SCAFFOLD_RE.test(t) || isFlushFragment(t, fullCmd)) {
    return true; // 冲刷残片 / 回显夹带的内部 token
  }
  return false;
}

const powershellProtocol: ShellProtocol = {
  flush() {
    // 实测(2026-09,当前安装版本): 60 空行滚动冲刷触发服务端差分渲染器丢行
    // (宽行内容不传输,只发 ECH 碎片);Clear-Host 强制全屏重绘,每行完整下发。
    return `Clear-Host; `;
  },
  helpers() {
    // uuPg <start> <end> <sentry> <varName> <token>：
    // 每个元素后附 token 作为「元素结束」标记（宽行会被服务端折行，客户端靠 token 重组），
    // 并回报「元素数,占屏行数」。
    return (
      `function global:uuPg($s, $e, $sn, $v, $tk) { ` +
      `$a = (Get-Variable -Name $v -ValueOnly); $p = @($a[$s..$e]); ` +
      `$r = 0; foreach ($x in $p) { $t = [string]$x; Write-Output ($t + $tk); $r += [Math]::Max(1, [Math]::Ceiling(($t.Length + $tk.Length) / ${VIEWPORT_COLS})) }; ` +
      `Write-Output ($sn + '=' + $p.Count + ',' + $r) }; `
    );
  },
  sentry(s) {
    return `("${s.slice(0, 4)}" + "${s.slice(4)}")`;
  },
  assignRows(cmd, countSentry) {
    return `Write-Output ('UU_B' + 'EGIN'); $global:uuOut = @(${cmd}); ("${countSentry.slice(0, 4)}" + "${countSentry.slice(4)}$($global:uuOut.Count)")`;
  },
  pageRows(start, end, s, varName = 'uuOut', token = '#t#') {
    // 保持短小（<120 列，否则回显折行会污染输出）；细节在 helpers() 里
    return `Write-Output ('UU_B' + 'EGIN'); uuPg ${start} ${end} ("${s.slice(0, 4)}" + "${s.slice(4)}") ${varName} ("${token.slice(0, 4)}" + "${token.slice(4)}")`;
  },
  storeFileB64(path, countSentry, limit, varName = 'uuF64') {
    // 单行 PS 语法严格:语句间必须有分号;Get-Item 失败发 MISS 标记而非静默。
    // 每条分支都必须下发：
    //   UU_ST=<OK|MISS|ISDIR|TOOBIG>  显式状态（客户端必须看到它，否则报错而非推断）
    //   UU_FLEN<len>                  b64 字符数（长度校验）
    return [
      `Write-Output ('UU_B' + 'EGIN');`,
      `$uuSt = 'OK'; $uuLen = 0; $f = $null; try { $f = Get-Item -Force -LiteralPath ${psQuote(path)} -ErrorAction Stop } catch { }`,
      `if (-not $f) { $uuSt = 'MISS'; $global:${varName} = @() }`,
      `elseif ($f.PSIsContainer) { $uuSt = 'ISDIR'; $global:${varName} = @() }`,
      `elseif ($f.Length -gt ${limit}) { $uuSt = 'TOOBIG'; $uuLen = $f.Length; $global:${varName} = @() }`,
      `else { $s2 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName)); $uuLen = $s2.Length; $L2 = New-Object 'System.Collections.Generic.List[string]'; for ($j = 0; $j -lt $s2.Length; $j += 76) { $L2.Add($s2.Substring($j, [Math]::Min(76, $s2.Length - $j))) }; $global:${varName} = @($L2) }`,
      `; Write-Output ('UU_ST=' + $uuSt); Write-Output ('UU_FL' + 'EN' + $uuLen); ("${countSentry.slice(0, 4)}" + "${countSentry.slice(4)}$($global:${varName}.Count)")`,
    ].join(' ');
  },
  writeFileB64(path, chunks, s) {
    const lines = ["Write-Output ('UU_B' + 'EGIN');", "$L = New-Object 'System.Collections.Generic.List[string]'"];
    for (const chunk of chunks) {
      lines.push(`$L.Add('${chunk}')`);
    }
    lines.push(`$okW = $true; try { [IO.File]::WriteAllBytes(${psQuote(path)}, [Convert]::FromBase64String(($L -join ''))) } catch { $okW = $false; Write-Output ('UU_W' + '_FAIL|' + $_.Exception.Message) }; $L = $null; if ($okW) { ("${s.slice(0, 4)}" + "${s.slice(4)}") }`);
    return lines.join('\r\n');
  },
  quote: psQuote,
};

/** zsh / bash(实验性:针对 macOS/Linux 被控端) */
function posixProtocol(tmpPrefix: string): ShellProtocol {
  return {
    flush() {
      return `printf '\\033[H\\033[2J'; `;
    },
    helpers() {
      return ''; // POSIX 侧分页命令已足够短，无需远端函数
    },
    sentry(s) {
      // 相邻字符串拼接,输入回显中不出现完整哨兵字面
      return `echo "${s.slice(0, 4)}""${s.slice(4)}"`;
    },
    assignRows(cmd, countSentry) {
      return `echo "UU_B""EGIN"; eval ${shQuote(cmd)} > ${tmpPrefix}uuOut 2>/dev/null; echo "${countSentry.slice(0, 4)}""${countSentry.slice(4)}$(wc -l < ${tmpPrefix}uuOut | tr -d ' ')"`;
    },
    pageRows(start, end, s, varName = 'uuOut', token = '#t#') {
      const file = shQuote(tmpPrefix + varName);
      // 同样用 token 标记元素结束；元素数直接由区间推出
      const want = end - start + 1;
      return (
        `echo "UU_B""EGIN"; sed -n '${start + 1},${end + 1}p' ${file} | sed 's/$/${token}/'; ` +
        `echo "${s.slice(0, 4)}""${s.slice(4)}=${want},0"`
      );
    },
    storeFileB64(path, countSentry, limit, varName = 'uuF64') {
      return [
        `echo "UU_B""EGIN";`,
        `sz=$(wc -c < ${shQuote(path)} 2>/dev/null | tr -d ' ')`,
        `if [ -d ${shQuote(path)} ]; then echo ISDIR; : > ${shQuote(tmpPrefix + varName)}`,
        `elif [ "$sz" -gt ${limit} ] 2>/dev/null; then echo "TOOBIG|$sz"; : > ${shQuote(tmpPrefix + varName)}`,
        `else base64 < ${shQuote(path)} | fold -w 76 > ${shQuote(tmpPrefix + varName)} 2>/dev/null; fi`,
        `; echo "${countSentry.slice(0, 4)}""${countSentry.slice(4)}$(wc -l < ${shQuote(tmpPrefix + varName)} | tr -d ' ')"`,
      ].join(' ');
    },
    writeFileB64(path, chunks, s) {
      const lines = ['echo "UU_B""EGIN";', ': > ' + shQuote(tmpPrefix + 'uuIn')];
      for (const chunk of chunks) {
        lines.push(`printf '%s' ${shQuote(chunk)} >> ${shQuote(tmpPrefix + 'uuIn')}`);
      }
      lines.push(`base64 -d < ${shQuote(tmpPrefix + 'uuIn')} > ${shQuote(path)} && rm -f ${shQuote(tmpPrefix + 'uuIn')}; echo "${s.slice(0, 4)}""${s.slice(4)}"`);
      return lines.join('\n');
    },
    quote: shQuote,
  };
}

/** 把「带 token 结尾的屏上多行」重组为逻辑行。
 * 服务端按 120 列自动折行，一条 203 字符的输出会变成 2 个屏幕行；
 * 远端在肉个元素末尾附 token（可能被折行切开），因此用「累积字符串以 token 结尾」判定边界。
 * 末尾残缺累积（token 丢失）不静默返回，交由调用方的计数校验报错。 */
export function joinByToken(rows: string[], token: string): string[] {
  const out: string[] = [];
  let acc = '';
  for (const r of rows) {
    acc += r;
    if (acc.endsWith(token)) {
      out.push(acc.slice(0, -token.length));
      acc = '';
    }
  }
  return out;
}

/** b64 行形态校验: 除末行外每行 76 字符;count 为服务端报告的行数 */
function b64ShapeValid(rows: string[], count: number): boolean {
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

export class TermBridge {
  private child: ChildProcessWithoutNullStreams | undefined;
  private screen = new VtScreen();
  private seq = 0;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly protocol: ShellProtocol;
  private readonly stderrTail: string[] = [];
  /** 元素结束标记（会话级随机；避免鹅哥内容尾与常规噪声冲突） */
  private readonly token = '#zq' + Math.random().toString(16).slice(2, 8) + '#';
  /** 最近一次收到渲染流的时间(静默检测用) */
  private lastDataAt = 0;

  constructor(
    private readonly cliPath: string,
    private readonly deviceId: string,
    private readonly shell: ShellKind = 'powershell',
    private readonly onStderr?: (line: string) => void,
  ) {
    this.protocol =
      shell === 'powershell'
        ? powershellProtocol
        : posixProtocol(`/tmp/uu-${process.pid}-`);
  }

  /** 串行化所有远程操作,避免命令交叉 */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run as Promise<T>;
  }

  private ensureStarted(): Promise<void> {
    if (this.child && !this.closed) {
      return Promise.resolve();
    }
    if (this.closed) {
      return Promise.reject(new BridgeError('桥已关闭'));
    }
    return this.start();
  }

  /**
   * 静默确认:哨兵命中后,服务端可能还在流式渲染剩余输出;此时写入下一条
   * 命令会打断渲染(实测:输入触发 2J 重绘,未完成的输出被丢弃)。
   * 等到输出流静默 quietMs 或到达 maxMs 才返回。
   */
  private async settle(quietMs = 500, maxMs = 2500): Promise<void> {
    const start = Date.now();
    for (;;) {
      const idle = Date.now() - this.lastDataAt;
      if (idle >= quietMs || Date.now() - start >= maxMs) {
        return;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  /** 发送新命令前清空本地屏幕模型:避免上一命令的标记/哨兵残留误匹配 */
  private send(cmd: string): void {
    if (!this.child || this.closed) {
      this.throwIfDead();
    }
    this.screen.reset();
    this.child.stdin.write(cmd);
  }

  private recordStderr(line: string): void {
    this.stderrTail.push(line);
    if (this.stderrTail.length > 12) {
      this.stderrTail.shift();
    }
    this.onStderr?.(line);
  }

  /** stderr 中的关键错误行(过滤连接进度噪声;含错因关键词的行永远保留),用于超时诊断 */
  private stderrDiagnosis(): string {
    const noise = /^\[连接\]|^\[系统\]|^\[终端\]|^─+$|^\[提示\]|^Warning:/i;
    // 不按前缀一刀切:如「[终端] 主控端版本过低…」前缀是噪声类但内容是真正的错因
    const signal = /版本|不兼容|过低|失败|错误|拒绝|不存在|超时|无效|未找到|不支持|Error/i;
    const meaningful = this.stderrTail.filter((l) => signal.test(l) || !noise.test(l));
    return meaningful.length > 0 ? meaningful.join(';').slice(0, 200) : '';
  }

  private diagnosticHint(text: string): string {
    return classifyTermDiagnostic(text).hint ?? '';
  }

  /** 进程已断开时抛错;带上 stderr 中的关键错误行(如「主控端版本过低」),让用户看到真实原因 */
  private throwIfDead(detail = ''): never {
    const diag = this.stderrDiagnosis();
    const hint = this.diagnosticHint(diag);
    throw new BridgeError(`远程终端会话已断开${detail}${diag ? ` —— ${diag}` : ''}${hint ? `；建议：${hint}` : ''}`);
  }

  private async start(): Promise<void> {
    // 服务端对连续建会话有限流("操作过于频繁"/Streamer error 2005),退避重试
    const delays = [0, 8000, 16000];
    let lastErr: unknown;
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
          // 忽略清理错误
        }
        this.child = undefined;
      }
    }
    throw lastErr;
  }

  private async attemptStart(): Promise<void> {
    // 旧版 CLI(如本机 macOS UURemote 4.39.1 自带的 CLI 1.0.0)的 term 仅有
    // open/exit 子命令(打开主程序终端窗口),无 --device-id/--new-session 管道通道。
    // 启动前探测一次(结果缓存),避免 spawn 后挂 20 秒超时才失败。
    const feats = await probeCliFeatures(this.cliPath);
    if (!feats.termChannel) {
      throw new BridgeError(
        '当前 uuyc-cli 版本不支持远程终端管道通道(term --device-id)。这是本机 UU远程主程序版本限制:' +
          '请升级主程序到支持该通道的版本(可在主程序内检查更新),或直接在 UU远程主程序中使用远程终端。',
      );
    }

    this.screen.reset();
    this.stderrTail.length = 0;
    this.child = spawn(this.cliPath, ['term', '--device-id', this.deviceId, '--new-session', '--shell', this.shell], {
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d: string) => {
      this.lastDataAt = Date.now();
      this.screen.feed(d);
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d: string) => {
      for (const line of d.split(/\r?\n/)) {
        if (line.trim()) {
          this.recordStderr(line.trim());
        }
      }
    });
    this.child.on('close', () => {
      this.child = undefined;
    });
    // 等待会话就绪:握手时一并定义远端辅助函数(长定义只在这里出现,不污染后续解析)
    try {
      await this.waitSentry(this.protocol.flush() + this.protocol.helpers() + this.protocol.sentry('UU_R_0'), 'UU_R_0', 20000);
    } catch (e) {
      const diag = this.stderrDiagnosis();
      const hint = this.diagnosticHint(diag);
      throw diag
        ? new BridgeError(`远程终端会话无法就绪:${diag}${hint ? `；建议：${hint}` : ''}`)
        : e instanceof Error
          ? e
          : new BridgeError(String(e));
    }
  }

  private async waitSentry(fullCmd: string, sentry: string, timeoutMs: number): Promise<void> {
    this.send(fullCmd + '\r\n');
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 120));
      if (this.screen.contains(sentry)) {
        await this.settle();
        return;
      }
      if (!this.child || this.closed) {
        this.throwIfDead();
      }
      if (Date.now() - t0 > timeoutMs) {
        const diag = this.stderrDiagnosis();
        const hint = this.diagnosticHint(diag);
        throw new BridgeError(
          `命令超时(${timeoutMs}ms),设备可能繁忙或离线${diag ? ` —— ${diag}` : ''}${hint ? `；建议：${hint}` : ''}`,
        );
      }
    }
  }

  /**
   * 执行单条命令,返回其输出行(已剔除提示符/回显)。
   * 适合输出行数确定较少的命令;行数可能超过一屏的请用 execRows。
   */
  exec(cmd: string, opts: ExecOptions = {}): Promise<string[]> {
    return this.enqueue(async () => {
      await this.ensureStarted();
      return this.runOnce(cmd, opts.timeoutMs ?? 15000);
    });
  }

  private async runOnce(cmd: string, timeoutMs: number): Promise<string[]> {
    this.seq++;
    const sentry = `UU_E_${this.seq}`;
    const full = this.protocol.flush() + `Write-Output ('UU_B' + 'EGIN'); ` + cmd + '; ' + this.protocol.sentry(sentry);
    this.send(full + '\r\n');
    const t0 = Date.now();
    for (;;) {
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
        throw new BridgeError(`远程命令超时(${timeoutMs}ms):${cmd.slice(0, 50)}${diag ? `(${diag})` : ''}`);
      }
    }
  }

  private extract(sentry: string, fullCmd: string): string[] {
    const lines = this.screen.snapshotLines();
    const idx = lines.findIndex((l) => l.includes(sentry));
    if (idx < 0) {
      return [];
    }
    // BEGIN 标记之后才是命令输出,彻底隔离输入回显(含折行碎片)
    const beginIdx = lines.findIndex((l) => l.trim() === BEGIN_MARKER);
    const start = beginIdx >= 0 && beginIdx < idx ? beginIdx + 1 : 0;
    const out: string[] = [];
    for (const line of lines.slice(start, idx)) {
      const t = line.replace(/\s+$/, '');
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
  execRows(cmd: string, opts: ExecOptions = {}): Promise<string[]> {
    return this.enqueue(async () => {
      await this.ensureStarted();
      const timeoutMs = opts.timeoutMs ?? 30000;
      this.seq++;
      const countSentry = `UU_N_${this.seq}`;
      const assign = this.protocol.flush() + this.protocol.assignRows(cmd, countSentry);
      this.send(assign + '\r\n');
      const t0 = Date.now();
      for (;;) {
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
          throw new BridgeError(`远程命令超时(${timeoutMs}ms):${cmd.slice(0, 50)}`);
        }
      }
    });
  }

  private async pullPages(count: number, timeoutMs: number, varName = 'uuOut'): Promise<string[]> {
    const rows: string[] = [];
    // 页大小自适应：宽行会折行，一页 26 个元素可能占 >35 个屏行而溢出视口。
    // 对端每页回报「非空行数」与「屏行数」，解析行数不足则缩小页大小并用新哨兵重拉。
    let pageSize = Math.min(PAGE_ROWS, count);
    let start = 0;
    while (start < count) {
      let accepted: string[] | undefined;
      let lastParsed = -1;
      let lastReported = -1;
      let lastRequested = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const end = Math.min(start + pageSize - 1, count - 1);
        lastRequested = end - start + 1;
        this.seq++;
        // 每次重试必须换新哨兵：旧哨兵仍在屏上会造成假成功
        const sentry = `UU_P_${this.seq}`;
        const cmd =
          this.protocol.flush() + this.protocol.pageRows(start, end, sentry, varName, this.token);
        this.send(cmd + '\r\n');
        const t0 = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 130));
          if (this.screen.contains(sentry)) {
            break;
          }
          if (!this.child || this.closed) {
            this.throwIfDead();
          }
          if (Date.now() - t0 > timeoutMs) {
            throw new BridgeError(`分页读取超时(第 ${start} 行起)`);
          }
        }
        await this.settle();
        // 屏上行 → 逻辑行：宽行折行产生的续行在此合并
        const pageRows = joinByToken(this.extract(sentry, cmd), this.token);
        const reported = this.reportedPage(sentry);
        lastParsed = pageRows.length;
        lastReported = reported?.nonEmpty ?? -1;
        const screenCost = pageRows.reduce((a, l) => a + Math.max(1, Math.ceil((l.length + this.token.length) / VIEWPORT_COLS)), 0);
        // 无对端回报 = 无法校验 → 不信任本页
        if (reported && pageRows.length >= reported.nonEmpty) {
          accepted = pageRows;
          pageSize =
            screenCost > PAGE_SCREEN_ROWS / 2 ? pageSize : Math.min(PAGE_ROWS, count - start);
          break;
        }
        // 校验不通过：缩小页大小重试同一区间
        pageSize = Math.max(1, Math.floor(pageSize / 2));
      }
      if (!accepted) {
        throw new BridgeError(
          `分页校验失败(第 ${start} 行起)：解析 ${lastParsed} 行 < 对端回报 ${lastReported} 行，3 次重试仍不一致——拒绝返回可能残缺的数据`,
        );
      }
      rows.push(...accepted);
      start += lastRequested;
    }
    return rows;
  }

  /** 读取某页哨兵行附带的对端回报(形如 UU_P_12=26,34)；无回报返回 undefined */
  private reportedPage(sentry: string): { nonEmpty: number; screenRows: number } | undefined {
    const hit = this.screen.snapshotLines().find((l) => l.includes(`${sentry}=`));
    if (!hit) {
      return undefined;
    }
    const m = new RegExp(`${escapeRe(sentry)}=(\\d+),(\\d+)`).exec(hit);
    if (!m) {
      return undefined;
    }
    return { nonEmpty: parseInt(m[1], 10), screenRows: parseInt(m[2], 10) };
  }

  /**
   * 读取文件为 base64(分页拉取): 先存入服务端数组(附状态标记), 再按页读取。
   * 返回行数组;首行可能是 ISDIR / TOOBIG|<size> / UU_F_MISS 状态标记。
   */
  readFileB64(path: string, limitBytes = 256 * 1024, opts: ExecOptions = {}): Promise<string[]> {
    return this.enqueue(async () => {
      await this.ensureStarted();
      const timeoutMs = opts.timeoutMs ?? 240000;
      let count = 0;
      let head: string[] = [];
      // 阶段一: 存入服务端数组 + 报告行数与 b64 总长(最多重试 2 次)
      let missSeen = false;
      let sawCount = false;
      // 单轮存储等待预算：标记未渲染时提前进入下一轮重试，而不是死等整个 timeoutMs（F-18）
      const storeWaitMs = Math.min(timeoutMs, 45_000);
      for (let a = 0; a < 3; a++) {
        head = [];
        this.seq++;
        const countSentry = `UU_F_${this.seq}`;
        const cmd = this.protocol.flush() + this.protocol.storeFileB64(path, countSentry, limitBytes);
        this.send(cmd + '\r\n');
        const t0 = Date.now();
        for (;;) {
          await new Promise((r) => setTimeout(r, 130));
          // MISS 可能是渲染流重写 echo 行造成的假阳性:重发 store 确认一次
          if (this.screen.contains('UU_F_MISS')) {
            if (missSeen) {
              await this.settle();
              return ['UU_F_MISS'];
            }
            missSeen = true;
            break;
          }
          const hit = this.screen.snapshotLines().find((l) => l.includes(countSentry));
          if (hit) {
            const m = new RegExp(`${countSentry}(\\d+)`).exec(hit);
            count = m ? parseInt(m[1], 10) : 0;
            sawCount = m !== null;
            await this.settle();
            head = this.extract(countSentry, cmd);
            missSeen = false;
            break;
          }
          if (!this.child || this.closed) {
            this.throwIfDead();
          }
          if (Date.now() - t0 > storeWaitMs) {
            break; // 本轮没拿到标记 → 直接重试，不在这里抛超时
          }
        }
        // 状态标记优先判定：ISDIR/TOOBIG/MISS 都会伴随 count=0，必须先看状态
        const st = /UU_ST=([A-Z]+)/.exec(head.join('\n'));
        if (st) {
          if (st[1] === 'MISS') {
            return ['UU_F_MISS'];
          }
          if (st[1] === 'ISDIR' || st[1] === 'TOOBIG') {
            const lenRow = head.find((l) => l.startsWith('UU_FLEN'));
            const size = lenRow ? lenRow.slice('UU_FLEN'.length).replace(/\D/g, '') : '';
            return [st[1] === 'TOOBIG' && size ? `TOOBIG|${size}` : st[1]];
          }
        }
        if (head.length > 0 && (st !== null || count > 0)) {
          break;
        }
        // 标记缺失/空结果 → 重存一次
      }
      const lenRow = head.find((l) => l.startsWith('UU_FLEN'));
      const expectLen = lenRow ? parseInt(lenRow.slice('UU_FLEN'.length), 10) : -1;
      // 「校验缺失」必须表现为失败，而不是静默跳过：
      // 2026-09-19 实测：UU_FLEN 未被渲染时旧实现把 expectLen 置 -1 直接跳过校验，
      // 导致 32KB 读取返回变长错误数据且 exit=0（F-19）。
      if (head.length === 0) {
        throw new BridgeError(`文件读取失败:未取到远端状态标记(渲染丢失),拒绝返回未校验的数据:${path}`);
      }
      if (!sawCount || !Number.isFinite(expectLen) || expectLen < 0) {
        throw new BridgeError(
          `文件读取校验失败:未取到远端长度标记 UU_FLEN(或行数标记)，无法校验完整性，拒绝返回数据:${path}`,
        );
      }
      if (count === 0) {
        return [];
      }
      // 阶段二: 分页拉取 + 长度精确校验,不符则重拉(最多 3 次),仍不符则显式报错
      for (let a = 0; a < 3; a++) {
        const rows = await this.pullPages(count, timeoutMs, 'uuF64');
        const joined = rows.join('');
        if (!b64ShapeValid(rows, count) || joined.length !== expectLen) {
          continue;
        }
        const decoded = Buffer.from(joined, 'base64');
        if (decoded.length !== Math.floor((expectLen / 4) * 3) - (joined.endsWith('==') ? 2 : joined.endsWith('=') ? 1 : 0)) {
          continue;
        }
        return rows;
      }
      throw new BridgeError(`文件读取校验失败(期望${expectLen}字符,3 次拉取均不一致,渲染流不稳定)`);
    });
  }

  /**
   * 写文件:base64 分块经管道传输,末尾输出哨兵。
   * 上限约 512KB(协议吞吐 ~5KB/s,更大文件体验极差,直接拒绝)。
   */
  writeFile(path: string, content: Uint8Array): Promise<void> {
    const MAX = 512 * 1024;
    return this.enqueue(async () => {
      if (content.length > MAX) {
        throw new BridgeError(`文件过大(${Math.round(content.length / 1024)}KB > 512KB),远程通道暂不支持写入更大文件`);
      }
      await this.ensureStarted();
      const b64 = Buffer.from(content).toString('base64');
      this.seq++;
      const sentry = `UU_W_${this.seq}`;
      const chunkSize = 512;
      const chunks: string[] = [];
      for (let i = 0; i < b64.length; i += chunkSize) {
        chunks.push(b64.slice(i, i + chunkSize));
      }
      if (chunks.length === 0) {
        chunks.push('');
      }
      const payload = this.protocol.writeFileB64(path, chunks, sentry) + '\r\n';
      this.send(payload);
      const t0 = Date.now();
      // 超时预算按实测吞吐（~1.7KB/s）× 1.5 余量，且不低于 60s。
      // 旧预算 max(30000, len/2) 低于实测所需时间，导致 32KB 写入实际成功却报超时（F-17）。
      const timeoutMs = Math.max(60_000, Math.ceil((content.length / 1024) * 1.5 * 1000));
      for (;;) {
        await new Promise((r) => setTimeout(r, 150));
        const failLine = this.screen.snapshotLines().find((l) => l.includes('UU_W_FAIL'));
        if (failLine) {
          throw new BridgeError(`远程写入失败:${failLine.split('UU_W_FAIL|')[1] ?? '未知错误'}`);
        }
        if (this.screen.contains(sentry)) {
          await this.settle();
          return;
        }
        if (!this.child || this.closed) {
          this.throwIfDead('(写入可能未完成,请检查远端文件)');
        }
        if (Date.now() - t0 > timeoutMs) {
          throw new BridgeError(
            `写文件超时(${timeoutMs}ms)：远端文件状态**未知**（可能已写入、可能残缺）。` +
              `请先核对再决定是否重写：exec <device> "if (Test-Path '${path}') { (Get-FileHash -Algorithm SHA256 '${path}').Hash }"`,
          );
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // 交互式终端原语(uu_pty_* 工具的底层,供 AI 处理交互提示:ssh 密码、y/n 确认等)
  // -------------------------------------------------------------------------

  /** 当前屏幕快照(非空行,行尾空白已修剪) */
  snapshot(): string[] {
    return this.screen.snapshotLines();
  }

  /** 原样写入输入(不做哨兵/冲刷处理);回车用 \r */
  writeRaw(keys: string): void {
    if (!this.child || this.closed) {
      throw new BridgeError('远程终端会话未启动或已关闭');
    }
    this.child.stdin.write(keys);
  }

  /** 会话是否仍在运行 */
  isAlive(): boolean {
    return !!this.child && !this.closed;
  }

  /** 启动并等待就绪(交互式会话打开时使用;不占用串行队列) */
  ensureReady(): Promise<void> {
    return this.ensureStarted();
  }

  /** 正常关闭:发送 exit 结束远程会话(避免会话在远程残留),再回收本地进程 */
  dispose(): Promise<void> {
    return this.enqueue(async () => {
      this.closed = true;
      if (this.child) {
        try {
          this.child.stdin.write('exit\r\n');
        } catch {
          // 进程可能已退出
        }
        await new Promise((r) => setTimeout(r, 600));
        this.child?.kill();
        this.child = undefined;
      }
    });
  }
}
