/**
 * uu-bridge: standalone CLI for UU Remote (GameViewer) terminal channel.
 * Reuses TermBridge from song-chaoyang/uu-remote-vscode (MIT-style reuse for local automation).
 *
 * Usage:
 *   node uu-bridge.cjs list
 *   node uu-bridge.cjs exec  <device_id> "<command>" [--shell powershell|cmd|zsh|bash]
 *   node uu-bridge.cjs read  <device_id> <remote_path>
 *   node uu-bridge.cjs write <device_id> <remote_path> <local_file>
 *   node uu-bridge.cjs pty   <device_id>            (interactive: stdin lines -> screen snapshots, 'exit' quits)
 */
import { listDevices } from './cli';
import { TermBridge } from './termBridge';
import type { ShellKind } from './types';

const DEFAULT_CLI = 'C:\\Program Files\\Netease\\GameViewer\\bin\\uuyc-cli.exe';
const cliPath = () => process.env['UU_CLI_PATH'] || DEFAULT_CLI;

function parseArgs(argv: string[]) {
  const shellIdx = argv.indexOf('--shell');
  let shell: ShellKind = 'powershell';
  if (shellIdx >= 0) {
    shell = argv[shellIdx + 1] as ShellKind;
    argv.splice(shellIdx, 2);
  }
  return { shell, args: argv };
}

async function main() {
  const { shell, args } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args;

  if (cmd === 'list') {
    const devices = await listDevices(cliPath());
    for (const d of devices) {
      console.log(`${d.deviceId}\t${d.deviceName}\tonline=${d.isOnline}\tplatform=${d.platform}`);
    }
    return;
  }

  const deviceId = rest[0];
  if (!deviceId) {
    console.error('device id required');
    process.exit(2);
  }

  if (cmd !== 'pty' && shell === 'cmd') {
    console.error('ERROR: exec/read/write 仅支持 powershell(协议限制); cmd 会话请用 pty 交互模式');
    process.exit(2);
  }

  if (cmd === 'sessions') {
    const { execCliText } = await import('./cli');
    const out = await execCliText(cliPath(), ['term', '--device-id', deviceId, '--list-sessions'], { timeoutMs: 30000 });
    console.log(out.trim() || '(no sessions)');
    return;
  }

  if (cmd === 'kill') {
    const sid = rest[1];
    if (!sid) {
      console.error('usage: kill <device_id> <session_id>');
      process.exit(2);
    }
    const { execCliText } = await import('./cli');
    const out = await execCliText(cliPath(), ['term', '--device-id', deviceId, '--kill-session', sid], { timeoutMs: 30000 });
    console.log(out.trim() || `session ${sid} killed`);
    return;
  }

  if (cmd === 'exec') {
    const command = rest.slice(1).join(' ');
    if (!command) {
      console.error('command required');
      process.exit(2);
    }
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    try {
      const rows = await bridge.execRows(command, { timeoutMs: 90000 });
      console.log(rows.length > 0 ? rows.join('\n') : '(no output)');
    } finally {
      await bridge.dispose();
    }
    return;
  }

  if (cmd === 'read') {
    const path = rest[1];
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    try {
      const rows = await bridge.readFileB64(path, 256 * 1024);
      const first = rows[0] ?? '';
      if (first === 'UU_F_MISS') throw new Error(`远程文件不存在或不可访问: ${path}`);
      if (first === 'ISDIR') throw new Error(`${path} is a directory`);
      if (first.startsWith('TOOBIG')) throw new Error(`file too large: ${first}`);
      const b64 = rows.map((r) => r.trim()).join('');
      process.stdout.write(Buffer.from(b64, 'base64'));
    } finally {
      await bridge.dispose();
    }
    return;
  }

  if (cmd === 'write') {
    const path = rest[1];
    const localFile = rest[2];
    if (!path || !localFile) {
      console.error('usage: write <device> <remote_path> <local_file>');
      process.exit(2);
    }
    const { readFileSync } = await import('fs');
    const content = readFileSync(localFile);
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    try {
      await bridge.writeFile(path, content);
      console.log(`written ${path} (${content.length} bytes)`);
    } finally {
      await bridge.dispose();
    }
    return;
  }

  if (cmd === 'pty') {
    const bridge = new TermBridge(cliPath(), deviceId, shell);
    await bridge.ensureReady();
    console.log('--- pty ready; type lines, Ctrl-D / "exit" to quit ---');
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (line === 'exit' || line === '__quit__') break;
      bridge.writeRaw(line + '\r');
      await new Promise((r) => setTimeout(r, 800));
      console.log(bridge.snapshot().join('\n'));
    }
    await bridge.dispose();
    return;
  }

  console.error('unknown command:', cmd);
  process.exit(2);
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
