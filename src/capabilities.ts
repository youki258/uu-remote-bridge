/**
 * uuyc-cli 能力探测(纯 Node,不依赖 vscode)。
 *
 * 背景:不同版本的 uuyc-cli 能力差异较大,扩展需要兼容两种主要形态:
 * - 新版(v4.39.2+ 配套):`-d`、`input-diag`、`term --device-id/--shell/--new-session/--list-sessions/...`
 *   等扩展首发时实测的命令形态,term 支持可编程管道通道(TermBridge 依赖)。
 * - 旧版(本机实测 CLI 1.0.0,macOS UURemote 4.39.1 自带):无 `-d`(本机 ID 走 `assist id`)、
 *   无 `input-diag`、term 仅 `open/exit` 子命令(打开主程序终端窗口,无管道通道)、
 *   `--set-bitrate-limit/--disable-lite-punch/--reset-custom-code` 均不存在、
 *   `lterm ls` 输出 JSON 而非 TSV 表格。
 *
 * probeCliFeatures() 只读探测各项能力并按 CLI 路径缓存,供命令层决定
 * 兼容回退(fallback)或优雅降级(clear 提示),不改变新版 CLI 上的行为。
 */
import { execFile } from 'child_process';

export interface CliFeatures {
  /** term 支持 `--device-id/--shell/--new-session/--list-sessions` 等可编程选项(提供管道交互通道) */
  termChannel: boolean;
  /** 存在 `-d`(直接输出本机设备 ID 纯文本) */
  dashD: boolean;
  /** 存在 `input-diag` 子命令 */
  inputDiag: boolean;
  /** 存在 `--set-bitrate-limit` / `--disable-lite-punch` 全局选项 */
  bitrateAndPunch: boolean;
  /** `echo` 输出 JSON 信封(需解包 data.message)而非纯文本 */
  echoJson: boolean;
  /** `lterm ls` 输出 JSON(新版 CLI 输出 TSV 表格) */
  ltermLsJson: boolean;
}

/** 探测失败/超时的保守默认(视为新版全功能,保证行为不回退) */
function unknownFeatures(): CliFeatures {
  return {
    termChannel: true,
    dashD: true,
    inputDiag: true,
    bitrateAndPunch: true,
    echoJson: false,
    ltermLsJson: false,
  };
}

function runCli(cliPath: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    const child = execFile(cliPath, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        // 退出码非零或 spawn 失败:返回 stderr + stdout 拼接,由调用方分析
        resolve(`${stdout}\n${stderr}`);
        return;
      }
      resolve(`${stdout}\n${stderr}`);
    });
    child.on('error', () => resolve(''));
  });
}

/** 帮助文本中是否出现任意标记(用于判断子命令/选项存在) */
function hasMarker(help: string, markers: string[]): boolean {
  return markers.some((m) => help.includes(m));
}

/** 粗略判定「参数不被支持」:帮助输出会出现 Unknown option / Unexpected argument / Unrecognized */
function isUnsupportedArgs(out: string): boolean {
  return /unknown option|unexpected argument|unrecognized|doesn't exist|no such option/i.test(out);
}

/**
 * 探测 CLI 能力(结果按 cliPath 缓存,单次会话内稳定)。
 * 探测失败或超时(如主应用未运行导致 help 也卡住)时保守返回 UNKNOWN(视为新版全功能)。
 */
let cachedPath: string | undefined;
let cachedFeatures: CliFeatures | undefined;

export async function probeCliFeatures(cliPath: string): Promise<CliFeatures> {

  if (cachedPath === cliPath && cachedFeatures) {

    return cachedFeatures;

  }

  cachedPath = cliPath;

  try {

    return await doProbe(cliPath);

  } catch {

    // 探测异常(如 CLI 崩溃):保守视为新版全功能,保证行为不回退

    cachedFeatures = unknownFeatures();

    return cachedFeatures;

  }

}


async function doProbe(cliPath: string): Promise<CliFeatures> {

  const [rootHelp, termHelp, termOpenHelp, inputDiagHelp] = await Promise.all([

    runCli(cliPath, ['--help']),

    runCli(cliPath, ['term', '--help']),

    runCli(cliPath, ['term', 'open', '--help']),

    runCli(cliPath, ['input-diag', '--help']),

  ]);


  const init: CliFeatures = {

    termChannel: hasMarker(`${termHelp}\n${termOpenHelp}`, ['--device-id', '--new-session', '--list-sessions', '--shell']),

    dashD: false,

    // root help 是权威的子命令清单(旧版 CLI 对未知子命令 --help 会静默回退到 status help,

    // 因此不能单看子命令 help,必须确认 root help 确实列出了 input-diag)

    inputDiag: hasMarker(rootHelp, ['input-diag']),

    bitrateAndPunch: hasMarker(rootHelp, ['--set-bitrate-limit', '--disable-lite-punch']),

    echoJson: false, // 由运行时探测确认(见 probeEchoFormat)

    ltermLsJson: false, // 由运行时探测确认(见 listLtermSessions 双解析)

  };

  init.dashD = await isSupportedFlag(cliPath);


  // 兜底:即便 root help 未列出 input-diag,只要子命令 help 明确输出自身 usage(非 status 回退)

  // 且不报未知参数,仍视为存在(覆盖 root help 不完备的 CLI 版本)

  if (!init.inputDiag && /input-diag|输入诊断/i.test(inputDiagHelp) && !isUnsupportedArgs(inputDiagHelp) && !/^USAGE: uuyc-cli status/m.test(inputDiagHelp.trim())) {

    init.inputDiag = true;

  }


  cachedFeatures = init;

  return init;

}

/** `-d` 是否作为全局选项存在(执行 `-d` 校验:不存在时输出 Unknown option) */
async function isSupportedFlag(cliPath: string): Promise<boolean> {
  const out = await runCli(cliPath, ['-d'], 3000);
  return !isUnsupportedArgs(out) && out.trim().length > 0 && !/^error:/i.test(out.trim());
}

/**
 * 运行时探测 echo 输出形态:
 * 新版 CLI 输出纯文本回显,旧版输出 JSON 信封 {data:{message:"echo: xxx"}}。
 * 返回 true 表示 JSON 信封(需解包)。
 */
export async function probeEchoFormat(cliPath: string): Promise<boolean> {
  const out = await runCli(cliPath, ['echo', '__uu_probe__'], 5000);
  const json = tryParseJsonLoose(out);
  return json !== undefined && typeof json === 'object' && (json as { data?: { message?: unknown } }).data?.message !== undefined;
}

/** 宽松 JSON 解析(容忍前后缀文本) */
export function tryParseJsonLoose(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
}

/** 清空能力缓存(测试用) */
export function resetCliFeatureCache(): void {
  cachedPath = undefined;
  cachedFeatures = undefined;
}