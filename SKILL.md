---
description: "Use when the user wants to execute commands, read/write files, open interactive terminals, or manage devices on a REMOTE machine via NetEase UU Remote (网易UU远程/GameViewer/uuyc-cli) — e.g. 在admin上执行命令、连一下某台主机的终端、从远程机器拿文件、远程终端自动化. Runs commands on remote devices non-interactively from the local agent session; use when user mentions UU远程, uuyc-cli, or asks to operate a remote PC by device name."
origin: "Execution core from song-chaoyang/uu-remote-vscode (MIT); operational rules from yinren112/uu-remote-ops; official JSON/error-code conventions from NetEase vendor skill (uuyc.163.com/help/cli.html); merged & audited 2026-09-07"
---

# uu-remote-bridge

通过网易 UU远程 的官方 CLI 通道（`uuyc-cli term` 管道模式）在远程设备上非交互执行命令、传输小文件、处理交互式终端。无需 VSCode，无需在远程装任何东西（远程只需装有 UU远程被控端）。

**与其他通道的分工**：设备/云电脑/协助的管理操作（list/connect/cloudpc/assist）可直接用官方 CLI 命令（见 `vendor/uuyc-cli-official/`）；本 skill 专注 **term 通道的程序化执行**——这是官方 skill 未覆盖、其他方案最薄弱的部分。

## 前提

- 本机 UU远程主程序正在运行且已登录（CLI 经它与主应用通信，未运行则业务命令返回错误码 1002）
- Node.js（本机已有）

## 工具位置（自包含）

| 路径（相对本 skill 目录） | 说明 |
|---|---|
| `bin/uu-bridge.cjs` | 编译好的单文件 CLI（已审计：仅启动官方 uuyc-cli，无网络/eval/遥测） |
| `src/` | TypeScript 源码（可审计、可重编译） |
| `scripts/uu-doctor.ps1` | 只读体检：主程序通信、设备在线、现有会话（动手前先跑） |
| `scripts/uu-push-file.ps1` | 小文件分块推送：gzip+b64 幂等分块、SHA256 校验后替换、.bat 自动转 GBK+CRLF |
| `vendor/` | 本地参考件（网易官方 skill 原件，仓库不含，见 https://uuyc.163.com/help/cli.html ） |

Windows 上调用（skill 目录通常为 `%USERPROFILE%\.agents\skills\uu-remote-bridge`）：

```powershell
node "%USERPROFILE%\.agents\skills\uu-remote-bridge\bin\uu-bridge.cjs" <子命令> ...
```

## 命令速查

| 命令 | 说明 |
|---|---|
| `list` | 列出账号下所有设备（ID、名称、在线状态） |
| `exec <device_id> "<命令>"` | 远程执行一条命令，自动分页拉全输出（默认 powershell） |
| `read <device_id> <远程路径>` | 读远程文件到 stdout（base64 分页+长度强校验，≤256KB） |
| `write <device_id> <远程路径> <本地文件>` | 推送本地文件到远程（≤512KB，实测含中文路径/内容无损） |
| `pty <device_id>` | 交互模式：stdin 每行 → 远程屏幕快照（处理 ssh 密码、y/n 确认） |
| `sessions <device_id>` | 列出远程终端会话（运维清理用） |
| `kill <device_id> <session_id>` | 结束指定会话（只 kill 确认属于自己的） |

通用选项：exec/read/write **仅支持 `--shell powershell`**（cmd/zsh 会话用 `pty` 交互模式）。

通用选项：`--shell powershell|cmd|zsh|bash`（Windows 被控端用默认 powershell 即可）。

## 标准工作流

1. 动手前先跑只读体检：`pwsh -File scripts/uu-doctor.ps1`（确认主程序通信、设备在线、**无他人正在使用远程机**）
2. `list` 拿设备 ID（设备 ID 会变，不要硬编码记忆值）
3. `exec` 执行命令；结果判读用 `NAME=VALUE` 结构化标记（如 `HASH=...`、`COUNT=113`），不依赖整段文本
4. 任务结束清理自己产生的临时文件与残留，复核为空才算完成

示例：

```powershell
node ...\bin\uu-bridge.cjs list
node ...\bin\uu-bridge.cjs exec <device_id> "Get-PSDrive -PSProvider FileSystem"
node ...\bin\uu-bridge.cjs exec <device_id> "Get-Content C:\Users\xx\log.txt -Tail 20"
pwsh -File scripts\uu-push-file.ps1 -DeviceId <device_id> -LocalPath .\fix.ps1 -RemotePath 'C:\fix.ps1'
```

## 运营铁律（真实交付踩坑，违反必付代价）

### 会话卫生（409 的根源）
- 通道**同时只允许一个窗口附加**：他人正在用时报 "attached from another window"，此时**立即停手等待**，绝不抢占
- `--new-session` 报 `409 terminal session already exists` 时：`exited` 会话仍占服务端独占锁，按 `LAST_ACTIVE` 找最新会话 `--kill-session <id>` 再新建；**只 kill 确认属于自己的会话**，绝不误杀他人 running 会话
- 本工具每次 `exec`/`read`/`write` 会自动 `exit` 收尾，不留残留；但被 timeout 强杀的进程可能在远程留残留，需人工检查 `--list-sessions`

### 命令与输出
- 命令一律**单行**（`;` 连接）：多行 here-string 会被逐字符粘贴破坏（出现过 `exitforeach` 拼接事故）
- 终端输出混有 `[连接]` 日志和 ANSI 转义，判读前先过滤（本工具已处理；走原始 CLI 时需自行过滤）
- 复杂脚本不要内联：先 `write`/`uu-push-file.ps1` 落盘，再 `exec` 执行；远程 `.ps1` 被执行策略拒绝时用 `powershell -NoProfile -ExecutionPolicy Bypass -File ...`

### 版本与编码假故障
- **远程机多为 Windows PowerShell 5.1，本机可能是 PowerShell 7**：`Sort-Object` 等行为差异会制造"两端不一致"假故障，比对用顺序无关聚合（逐条哈希后异或）
- `.cmd`/`.bat` 落到远程前**必须转 GBK + CRLF**（`uu-push-file.ps1` 默认自动处理）
- 中文乱码：设 `PYTHONIOENCODING=utf-8`，远端文件统一 UTF-8，判读走结构化标记

### 官方 JSON 约定（管理面命令）
- 业务命令输出 JSON：先判 `.success`，成功读 `.data`，失败读 `.error.code/.error.message`——**很多失败仍以退出码 0 结束，不能只看退出码**
- 错误码：1001 未登录 / 1002 主应用未运行 / 1003 版本不匹配 / 1004 参数无效 / 1005 数据未刷新 / 1006 设备未找到 / 1008 多匹配 / 1010 设备离线
- 设备名模糊匹配必须用 `--m "名称"`（双横线），不要把名称当位置参数

## 协议硬限制（2026-09 生产验收实测，勿绕过）

- **性能基线（实测）**：单次 exec 全程 ~7s（含握手）；读吞吐 ~0.8-1KB/s（分页协议开销主导），写 ~1.7KB/s；64KB 读约 55s、写约 40s。长输出先在远程端过滤，减少传输量
- **read/write 实际上限**：read 256KB（分页化 + b64 长度强校验，不符自动重拉 3 次，仍不符显式报错，杜绝静默损坏）；write 512KB（失败带远程异常消息显式报错）；**更大文件走 UU 图形界面文件传输**，传完用 exec 核对 SHA256
- `scripts/uu-push-file.ps1`（上游脚本）在当前服务端版本下确认标记渲染丢失，**未适配**，暂用 write 替代；推 `.bat` 前先本地转 GBK+CRLF
- 每条命令 Clear-Host 冲刷 + BEGIN 标记隔离回显 + 26 行分页；内置限流退避（"操作过于频繁"/2005 自动重试）与静默确认（防渲染流被下一条命令打断）
- 会话结束自动 exit，但**服务端可能仍标记 detached running**（当前版本实测不阻塞新会话：40+ 连续调用零 409）；累积后用 `sessions` + `kill` 清理

## 故障排查

| 现象 | 原因/处理 |
|---|---|
| 业务命令失败但退出码 0 | 解析 JSON `.success/.error`，按错误码表处理 |
| "attached from another window" | 他人/别的窗口正占用通道，等待或协调，不抢占 |
| 「操作过于频繁」/ Streamer error 2005 | 建会话限流，工具已内置退避重试；仍失败则等 30s 再试 |
| 409 terminal session already exists | 僵尸会话占锁：`sessions` → `kill` 自己的会话 → 重试（当前版本实测罕见） |
| 「attached from another window」 | 他人/别的窗口正占用通道，等待或协调，不抢占 |
| 所有命令失败(错误码1002) | UU远程主程序未运行或未登录 |
| 「主控端版本过低」 | 升级本机 UU远程到与被控端相同或更新版本 |
| 「不支持远程终端管道通道」 | 本机 CLI 太旧，升级 UU远程主程序 |
| 「远程终端会话无法就绪」 | 设备离线/繁忙，`list` 确认在线后重试 |

## 重编译（修改 src 后）

```powershell
cd <skill-dir>/src
npx esbuild main.ts --bundle --platform=node --outfile=..\bin\uu-bridge.cjs
```

## 来源与溯源

- 执行核心：https://github.com/song-chaoyang/uu-remote-vscode （TermBridge/vt/capabilities，MIT）
- 运营规程：https://github.com/yinren112/uu-remote-ops （409/PS5.1/GBK/分块传输）
- 官方规范：https://uuyc.163.com/help/cli.html 及官方 skill zip（JSON 约定、错误码）
- 官方 CLI 文档还覆盖：`assist` 远程协助、CDP 端口映射（`vendor/` 内参考件）
- **2026-09 生产验收修复**（8 阶段 38 项测试驱动）：Clear-Host 冲刷替代 60 空行（服务端差分渲染器会丢宽行，只发 ECH 碎片）、VtScreen 补 ECH(CSI X)、限流退避重试、哨兵后静默确认（防渲染流被下一条命令打断）、分页自愈 + b64 长度强校验（杜绝静默损坏）、read/write 显式 MISS/FAIL 标记、新增 sessions/kill 子命令
