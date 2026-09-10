/**
 * uuyc-cli 封装层(纯 Node,不依赖 vscode,便于脱离 VSCode 冒烟测试)。
 *
 * CLI 事实(实测 v4.39.2.1561):
 * - 查询类命令输出 JSON:{"data": {...}, "success": bool, "timestamp": ...}
 * - 部分命令输出纯文本(echo / -d / --version / lterm ls 表格)
 * - 错误输出 "Error: xxx" 且 exit code 不可靠(部分错误仍返回 0),
 *   因此错误检测同时看 exit code、stderr 与 stdout 中的 "Error:" 前缀
 */
import { execFile, spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import type {
  CliEnvelope,
  CloudPC,
  CloudPcListData,
  ConnectedDevice,
  Device,
  DeviceListData,
  DeviceStatusData,
  LtermSession,
  ShellKind,
  TermSessionInfo,
  UserInfo,
  WalletData,
} from './types';

export class CliError extends Error {
  constructor(
    message: string,
    public readonly stdout: string = '',
    public readonly stderr: string = '',
    public readonly code: number | undefined = undefined,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export interface CliRunResult {
  /** ANSI 已剥离并 trim 的 stdout */
  stdout: string;
  stderr: string;
  code: number;
}

const ANSI_RE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export const CLI_FILE_NAME = process.platform === 'win32' ? 'uuyc-cli.exe' : 'uuyc-cli';

/** 常见安装位置的候选路径 */
export function candidateCliPaths(): string[] {
  const candidates: string[] = [];
  const drives = process.platform === 'win32' ? ['C:', 'D:', 'E:'] : [];
  for (const drive of drives) {
    for (const pf of ['Program Files', 'Program Files (x86)']) {
      candidates.push(join(drive, '\\', pf, 'Netease', 'GameViewer', 'bin', CLI_FILE_NAME));
    }
  }
  const local = process.env['LOCALAPPDATA'];
  if (local) {
    candidates.push(join(local, 'Netease', 'GameViewer', 'bin', CLI_FILE_NAME));
  }
  const home = process.env['HOME'] ?? process.env['USERPROFILE'];
  if (home) {
    // macOS:UU远程 / GameViewer 安装到 /Applications(应用包内)
    candidates.push(join('/Applications', 'UU远程.app', 'Contents', 'MacOS', CLI_FILE_NAME));
    candidates.push(join('/Applications', 'GameViewer.app', 'Contents', 'MacOS', CLI_FILE_NAME));
    candidates.push(join(home, 'Applications', 'UU远程.app', 'Contents', 'MacOS', CLI_FILE_NAME));
    candidates.push(join('/usr/local/bin', CLI_FILE_NAME));
    candidates.push(join('/opt/homebrew/bin', CLI_FILE_NAME));
    candidates.push(join(home, '.local', 'bin', CLI_FILE_NAME));
    candidates.push(join(home, 'bin', CLI_FILE_NAME));
  }
  return candidates;
}

function whereCli(): Promise<string[]> {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  return new Promise((resolve) => {
    execFile(finder, [CLI_FILE_NAME], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      );
    });
  });
}

/**
 * 解析 CLI 路径:显式配置优先;否则探测常见安装目录,最后回退 PATH 查找。
 * @param configured 用户配置的 uu.cliPath(可为空字符串)
 */
export async function resolveCliPath(configured?: string): Promise<string> {
  if (configured && configured.trim()) {
    const p = configured.trim();
    if (existsSync(p)) {
      return p;
    }
    throw new CliError(`配置的 uu.cliPath 不存在:${p}`);
  }
  for (const p of candidateCliPaths()) {
    if (existsSync(p)) {
      return p;
    }
  }
  for (const p of await whereCli()) {
    if (existsSync(p)) {
      return p;
    }
  }
  throw new CliError(
    '未找到 uuyc-cli。请确认已安装 UU远程主程序,或在设置 "uu.cliPath" 中指定 CLI 完整路径(通常位于 UU远程安装目录的 bin\\uuyc-cli.exe)。',
  );
}

/** 执行 CLI 并收集输出。超时强制终止(默认 15s,防止主应用无响应时挂死)。 */
export async function execCli(
  cliPath: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<CliRunResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, { windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill();
        settled = true;
        reject(new CliError(`命令超时(${timeoutMs}ms):${args.join(' ')}`));
      }
    }, timeoutMs);

    child.stdout?.on('data', (d: Buffer) => stdoutChunks.push(d));
    child.stderr?.on('data', (d: Buffer) => stderrChunks.push(d));
    child.on('error', (e) => {
      if (!settled) {
        clearTimeout(timer);
        settled = true;
        reject(new CliError(`无法启动 CLI:${e.message}`));
      }
    });
    child.on('close', (code) => {
      if (!settled) {
        clearTimeout(timer);
        settled = true;
        const stdout = stripAnsi(Buffer.concat(stdoutChunks).toString('utf8')).trim();
        const stderr = stripAnsi(Buffer.concat(stderrChunks).toString('utf8')).trim();
        resolve({ stdout, stderr, code: code ?? -1 });
      }
    });
  });
}

/** 提取 CLI 输出中第一处 "Error:" 行;无则取首行 */
export function firstErrorLine(r: CliRunResult): string {
  for (const text of [r.stderr, r.stdout]) {
    const m = text.match(/(?:^|\r?\n)\s*Error:\s*(.+)/);
    if (m) {
      return m[1].trim();
    }
  }
  if (r.stderr) {
    return r.stderr.split(/\r?\n/)[0].trim();
  }
  return r.stdout.split(/\r?\n/)[0].trim() || `退出码 ${r.code}`;
}

/** CLI 错误判定:exit code 非零,或 stderr/stdout 中出现 "Error:" 前缀 */
export function looksLikeError(r: CliRunResult): boolean {
  if (r.code !== 0) {
    return true;
  }
  const errRe = /(?:^|\r?\n)\s*Error:/;
  return errRe.test(r.stderr) || errRe.test(r.stdout);
}

function toCliError(r: CliRunResult): CliError {
  return new CliError(firstErrorLine(r), r.stdout, r.stderr, r.code ?? undefined);
}

/**
 * 从文本中提取第一个括号配平的 JSON 对象(容忍与日志文本混排,如 term 的 "[连接] ..." 前缀)。
 * 返回 undefined 表示无 JSON。
 */
export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // 继续尝试提取子串
  }
  const start = trimmed.indexOf('{');
  if (start < 0) {
    return undefined;
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
    if (ch === '\\') {
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
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** 执行命令并返回纯文本 stdout(检测到错误则抛 CliError) */
export async function execCliText(cliPath: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<string> {
  const r = await execCli(cliPath, args, opts);
  if (looksLikeError(r)) {
    throw toCliError(r);
  }
  return r.stdout;
}

/** 执行命令并解析 JSON envelope(检测到错误或非 JSON 输出则抛 CliError) */
export async function execCliJson<T>(
  cliPath: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<CliEnvelope<T>> {
  const r = await execCli(cliPath, args, opts);
  if (looksLikeError(r)) {
    throw toCliError(r);
  }
  const obj = tryParseJson(r.stdout);
  if (obj === undefined || typeof obj !== 'object' || obj === null) {
    throw new CliError(`CLI 输出不是合法 JSON:${r.stdout.split(/\r?\n/)[0] || '(空)'}`);
  }
  return obj as CliEnvelope<T>;
}

/** 将 stdout 转成用户可读结果:JSON success=true → "成功";否则原文 */
export function friendlyResult(stdout: string): string {
  const obj = tryParseJson(stdout);
  if (obj && typeof obj === 'object' && 'success' in obj) {
    const success = (obj as { success: unknown }).success;
    if (success === true) {
      return '操作成功';
    }
    if (success === false) {
      return `操作失败:${stdout.split(/\r?\n/)[0]}`;
    }
  }
  return stdout.split(/\r?\n/).filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// 类型化查询 API
// ---------------------------------------------------------------------------

export async function listDevices(cliPath: string): Promise<Device[]> {
  const env = await execCliJson<DeviceListData>(cliPath, ['device', 'list']);
  return env.data?.devices ?? [];
}

export async function getDeviceStatus(cliPath: string): Promise<ConnectedDevice[]> {
  const env = await execCliJson<DeviceStatusData>(cliPath, ['device', 'status']);
  // 新版 CLI 用 connected_devices,旧版 CLI 用 connections(字段名不同)
  const raw = env.data?.connected_devices ?? env.data?.connections ?? [];
  const list: ConnectedDevice[] = [];
  for (const c of raw) {
    const rec = c as Record<string, unknown>;
    const targetId = String(rec['targetId'] ?? rec['deviceId'] ?? rec['id'] ?? '');
    const targetName = String(rec['targetName'] ?? rec['deviceName'] ?? rec['name'] ?? '');
    if (targetId || targetName) {
      list.push({ targetId, targetName });
    }
  }
  return list;
}

export async function listCloudPCs(cliPath: string): Promise<CloudPC[]> {
  const env = await execCliJson<CloudPcListData>(cliPath, ['cloudpc', 'list']);
  return env.data?.cloudPCs ?? [];
}

export async function getUserInfo(cliPath: string): Promise<UserInfo> {
  const env = await execCliJson<UserInfo>(cliPath, ['user', 'info']);
  if (!env.data?.userId) {
    throw new CliError('未获取到用户信息,可能尚未登录 UU远程主应用。');
  }
  return env.data;
}

export async function getWallet(cliPath: string): Promise<WalletData> {
  const env = await execCliJson<WalletData>(cliPath, ['user', 'wallet']);
  return env.data ?? { coinBalance: 0 };
}

export async function getVersion(cliPath: string): Promise<string> {
  return execCliText(cliPath, ['--version']);
}

export async function getLocalDeviceId(cliPath: string): Promise<string> {
  // 新版 CLI:-d 直接输出本机设备 ID(纯文本)
  try {
    const id = await execCliText(cliPath, ['-d']);
    if (id.trim()) {
      return id.trim();
    }
  } catch (e) {
    // 旧版 CLI 无 -d,回退 assist id(JSON data.deviceId)
    if (e instanceof CliError && /unknown option|unexpected argument/i.test(`${e.message} ${e.stderr}`)) {
      const env = await execCliJson<{ deviceId?: string }>(cliPath, ['assist', 'id']);
      const id = env.data?.deviceId;
      if (id && id.trim()) {
        return id.trim();
      }
    }
    throw e;
  }
  throw new CliError('未能获取本机设备 ID');
}

export async function resetCustomCode(cliPath: string, code: string): Promise<string> {
  const r = await execCli(cliPath, ['--reset-custom-code', code]);
  if (looksLikeError(r)) {
    // 旧版 CLI:无 --reset-custom-code,回退 assist set-code
    const err = firstErrorLine(r) + r.stderr;
    if (/unknown option|unexpected argument/i.test(err)) {
      const r2 = await execCli(cliPath, ['assist', 'set-code', code]);
      if (looksLikeError(r2)) {
        return Promise.reject(toCliError(r2));
      }
      return friendlyResult(r2.stdout);
    }
    return Promise.reject(toCliError(r));
  }
  return friendlyResult(r.stdout);
}

export async function setBitrateLimit(cliPath: string, mbps: number): Promise<string> {
  const r = await execCli(cliPath, ['--set-bitrate-limit', String(mbps)]);
  return looksLikeError(r) ? Promise.reject(toCliError(r)) : friendlyResult(r.stdout);
}

export async function setLitePunch(cliPath: string, disabled: boolean): Promise<string> {
  const r = await execCli(cliPath, ['--disable-lite-punch', disabled ? 'true' : 'false']);
  return looksLikeError(r) ? Promise.reject(toCliError(r)) : friendlyResult(r.stdout);
}

export async function echo(cliPath: string, message: string): Promise<string> {
  // 新版 CLI:echo 输出纯文本;旧版 CLI:输出 JSON 信封 {data:{message:"echo: xxx"}}
  const text = await execCliText(cliPath, ['echo', message]);
  const obj = tryParseJson(text);
  if (obj && typeof obj === 'object') {
    const msg = (obj as { data?: { message?: unknown }; message?: unknown }).data?.message;
    if (typeof msg === 'string' && msg) {
      return msg.replace(/^echo:\s*/i, '');
    }
  }
  return text.replace(/^echo:\s*/i, '');
}

/** `lterm ls` 表格解析:NAME  SHELL  STATE  CREATED_AT_MS(列间 2+ 空格) */
export function parseLtermLs(text: string): LtermSession[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0 || !/^NAME\b/.test(lines[0].trim())) {
    return [];
  }
  const sessions: LtermSession[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length < 2) {
      continue;
    }
    const createdAt = cols.length >= 4 ? Number(cols[cols.length - 1]) : NaN;
    sessions.push({
      name: cols[0],
      shell: cols[1] ?? '',
      state: cols[2] ?? '',
      createdAtMs: Number.isFinite(createdAt) ? createdAt : undefined,
      raw: line.trim(),
    });
  }
  return sessions;
}

export async function listLtermSessions(cliPath: string): Promise<LtermSession[]> {
  const text = await execCliText(cliPath, ['lterm', 'ls']);
  // 新版 CLI:TSV 表格;旧版 CLI:JSON 信封 data.sessions(name/shell/state/created_at_ms)
  const fromTsv = parseLtermLs(text);
  if (fromTsv.length > 0 || /^NAME\b/.test(text.trim())) {
    return fromTsv;
  }
  const obj = tryParseJson(text);
  if (obj && typeof obj === 'object') {
    const sessions = (obj as { data?: { sessions?: Array<Record<string, unknown>> } }).data?.sessions;
    if (Array.isArray(sessions)) {
      return sessions
        .map((s) => ({
          name: String(s['name'] ?? ''),
          shell: String(s['shell'] ?? ''),
          state: String(s['state'] ?? ''),
          createdAtMs: typeof s['created_at_ms'] === 'number' ? (s['created_at_ms'] as number) : undefined,
          raw: JSON.stringify(s),
        }))
        .filter((s) => s.name.length > 0);
    }
  }
  return [];
}

/**
 * 解析 `term --list-sessions` 输出(实测为 TSV 表格,前置可能有少量日志行):
 * SESSION_ID\tNAME\tSHELL\tSTATE\tLAST_ACTIVE;无会话时输出 "No active sessions."
 */
export function parseTermSessions(stdout: string): TermSessionInfo[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  const headerIdx = lines.findIndex((l) => /^SESSION_ID\b/.test(l));
  if (headerIdx < 0) {
    return [];
  }
  const sessions: TermSessionInfo[] = [];
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
      lastActiveMs: /^\d+$/.test(lastActive ?? '') ? Number(lastActive) : undefined,
      raw: line,
    });
  }
  return sessions;
}

/** 远程终端 shell 合法性:term 支持 powershell/cmd/zsh/bash,lterm 仅 powershell/cmd */
export const REMOTE_SHELLS: ShellKind[] = ['powershell', 'cmd', 'zsh', 'bash'];
export const LOCAL_SHELLS: ShellKind[] = ['powershell', 'cmd'];

export function isValidShell(shell: string, shells: ShellKind[]): shell is ShellKind {
  return (shells as string[]).includes(shell);
}

/** 设备 platform 字段的可读名(数字:1 与 4 均实测为 Windows;字符串:windows/mac/linux 直接映射) */
export function platformName(platform?: number | string): string {
  if (platform === undefined || platform === '') {
    return '';
  }
  if (typeof platform === 'number') {
    const known: Record<number, string> = { 1: 'Windows', 4: 'Windows' };
    return known[platform] ?? `platform ${platform}`;
  }
  const known: Record<string, string> = {
    windows: 'Windows',
    win32: 'Windows',
    macos: 'macOS',
    mac: 'macOS',
    linux: 'Linux',
    android: 'Android',
    ios: 'iOS',
  };
  const name = known[platform.toLowerCase()];
  return name ?? platform;
}

/**
 * 跨平台启动 UU远程主程序:
 * - Windows:CLI 位于 <install>\bin\uuyc-cli.exe,主程序为 <install>\GameViewer.exe
 * - macOS:CLI 位于 <App>.app/Contents/MacOS/,用 open -a 启动应用包
 */
export function launchMainApp(cliPath: string): { command: string; args: string[] } | undefined {
  if (process.platform === 'win32') {
    const installDir = dirname(dirname(cliPath));
    const exe = [join(installDir, 'GameViewer.exe'), join(installDir, 'uuyc.exe')].find((p) => existsSync(p));
    return exe ? { command: exe, args: [] } : undefined;
  }
  if (process.platform === 'darwin') {
    // CLI 在 <App>.app/Contents/MacOS/ 下 → 应用包为向上三级目录
    const macDir = dirname(cliPath);
    const contentsDir = dirname(macDir);
    const appBundle = dirname(contentsDir);
    if (appBundle.endsWith('.app') && existsSync(appBundle)) {
      return { command: 'open', args: ['-a', appBundle] };
    }
    // CLI 不在 .app 内时,尝试常见应用名(macOS 安装包为 UURemote.app,部分版本为 UU远程.app)
    for (const app of ['/Applications/UURemote.app', '/Applications/UU远程.app', '/Applications/GameViewer.app']) {
      if (existsSync(app)) {
        return { command: 'open', args: ['-a', app] };
      }
    }
    return undefined;
  }
  return undefined;
}

/** 云电脑状态的可读名(未列举的状态原样展示) */
export const CLOUDPC_STATUS_NAMES: Record<string, string> = {
  shutdown: '已关机',
  running: '运行中',
  starting: '开机中',
  stopping: '关机中',
};

export function cloudPcStatusName(status: string): string {
  return CLOUDPC_STATUS_NAMES[status] ?? status;
}
