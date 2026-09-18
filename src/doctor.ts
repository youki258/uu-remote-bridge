/**
 * 只读环境预检(doctor):CLI 路径/版本、主程序连通性、设备在线情况、版本门槛判定。
 *
 * 官方依据(https://uuyc.163.com/blog/20260625-cli.html):
 * - 除 `version` 外,所有命令都要求 UU远程 主程序后台运行;未运行返回退出码 2
 * - 退出码:0 成功 / 1 配置文件读取错误 / 2 无法连接主程序 / 3 参数错误 /
 *   4 请求数据不可用、设备不存在 / 5 接口执行超时 / 6 远程终端内部执行失败 / 99 未知异常
 * 官方要求(https://uuyc.163.com/help/20260509/40220_1299599.html):
 * - 终端功能要求主控端与被控端均为 V4.39.0 及以上
 *
 * 只读约束:不创建会话、不 kill 会话、不列出会话(不触碰 term 独占通道)。
 */
import { execCli, listDevices, resolveCliPath } from './cli';

/** 官方退出码 → 可读原因 */
export const EXIT_CODE_HINTS: Record<number, string> = {
  0: '成功',
  1: '配置文件读取错误',
  2: '无法连接 UU远程主程序(客户端未打开或未登录)',
  3: '输入无效命令/参数错误',
  4: '请求数据不可用、设备不存在',
  5: '接口执行超时',
  6: '远程终端内部执行失败',
  99: '未知异常错误',
};

export function hintForExitCode(code: number): string {
  return EXIT_CODE_HINTS[code] ?? `未知退出码(${code})`;
}

/** 终端功能官方要求的最低版本(主控端与被控端均为该版本及以上) */
export const TERM_MIN_VERSION = '4.39.0';

/** 版本号是否满足终端最低要求;无法解析时返回 undefined */
export function meetsTermMinVersion(version: string): boolean | undefined {
  const m = version.match(/(\d+)\.(\d+)/);
  if (!m) {
    return undefined;
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const [minMajor, minMinor] = TERM_MIN_VERSION.split('.').map(Number);
  return major > minMajor || (major === minMajor && minor >= minMinor);
}

/**
 * 执行只读预检并打印结构化 NAME=VALUE 行。
 * @returns 0 正常 / 1 找不到 CLI / 2 主程序不可达
 */
export async function runDoctor(configured?: string): Promise<number> {
  const out = (line: string) => console.log(line);

  let cliPath: string;
  try {
    cliPath = await resolveCliPath(configured);
  } catch (e) {
    out('CLI_FOUND=False');
    out(`HINT=${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  out('CLI_FOUND=True');
  out(`CLI_PATH=${cliPath}`);

  // `version` 无需主程序运行(官方),主程序未开时也能拿到 CLI 版本
  const ver = await execCli(cliPath, ['version'], { timeoutMs: 8000 });
  const version = ver.stdout.split(/\r?\n/)[0]?.trim() ?? '';
  out(`CLI_VERSION=${version || '(未知)'}`);
  const minOk = version ? meetsTermMinVersion(version) : undefined;
  out(`TERM_MIN_VERSION=${TERM_MIN_VERSION}`);
  out(`TERM_VERSION_OK=${minOk === undefined ? 'UNKNOWN' : minOk}`);

  const echo = await execCli(cliPath, ['echo', 'uu-doctor'], { timeoutMs: 8000 });
  out(`MAIN_APP_OK=${echo.code === 0}`);
  if (echo.code !== 0) {
    out(`MAIN_APP_EXIT_CODE=${echo.code}`);
    out(`HINT=${hintForExitCode(echo.code)}`);
    if (minOk === false) {
      out('HINT_UPGRADE=主控端版本低于 V4.39.0,终端功能不可用;请升级到与被控端相同或更新版本');
    }
    return 2;
  }

  try {
    const devices = await listDevices(cliPath);
    const online = devices.filter((d) => d.isOnline);
    out(`DEVICE_COUNT=${devices.length}`);
    out(`DEVICE_ONLINE_COUNT=${online.length}`);
    for (const d of devices) {
      out(`DEVICE=${d.deviceId}\t${d.deviceName}\tonline=${d.isOnline}\tplatform=${d.platform}`);
    }
    if (online.length === 0) {
      out('HINT=没有在线设备,exec/read/write 无法执行');
    }
  } catch (e) {
    out('DEVICE_LIST_OK=False');
    out(`HINT=${e instanceof Error ? e.message : String(e)}`);
  }

  out('SESSIONS=用 sessions <device_id> 查看(会触碰 term 独占通道,确认无人占用再执行)');
  return 0;
}
