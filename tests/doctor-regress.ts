import assert from 'node:assert/strict';
import { classifyTermDiagnostic } from '../src/doctor';

const cases = [
  {
    name: 'suggests GUI activation for compatibility-shaped failures',
    text: '[终端] 主控端版本过低，被控端不再兼容此协议版本',
    status: 'NEEDS_ACTIVATION_OR_VERSION_MISMATCH',
    hint: '请先在 UU远程主程序中打开该设备的终端窗口',
  },
  {
    name: 'recognizes locked devices',
    text: '[系统] 检测到被控端已锁屏，请输入被控端账户密码验证身份',
    status: 'LOCKED',
    hint: '请先完成被控端系统账户验证',
  },
  {
    name: 'recognizes sessions attached elsewhere',
    text: 'attached from another window',
    status: 'BUSY',
    hint: '当前终端已被其他窗口占用，请等待后重试',
  },
  {
    name: 'recognizes unavailable devices',
    text: '设备离线，无法建立远程终端',
    status: 'UNAVAILABLE',
    hint: '请确认设备在线且 UU远程主程序已登录',
  },
  {
    name: 'recognizes unsupported old CLIs',
    text: '当前 uuyc-cli 版本不支持远程终端管道通道',
    status: 'UNSUPPORTED_CLI',
    hint: '请升级 UU远程主程序',
  },
  {
    name: 'falls back to unknown diagnostics',
    text: 'some unexpected failure',
    status: 'UNKNOWN',
    hint: undefined,
  },
] as const;

for (const testCase of cases) {
  const result = classifyTermDiagnostic(testCase.text);
  assert.equal(result.status, testCase.status, testCase.name);
  if (testCase.hint) {
    assert.match(result.hint ?? '', new RegExp(testCase.hint));
  } else {
    assert.equal(result.hint, undefined, testCase.name);
  }
}

assert.equal(classifyTermDiagnostic('').status, 'UNKNOWN');
console.log(`doctor diagnostics: ${cases.length + 1} cases passed`);
