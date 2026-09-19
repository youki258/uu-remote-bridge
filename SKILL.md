---
name: uu-remote-bridge
description: "Use when the user wants to execute commands, read/write files, open interactive terminals, or manage devices on a REMOTE machine via NetEase UU Remote (网易UU远程/GameViewer/uuyc-cli) — e.g. 在某台远程电脑上执行命令、连接一台主机的终端、从远程机器拿文件、远程终端自动化. Runs commands on remote devices non-interactively from the local agent session; use when user mentions UU远程, uuyc-cli, or asks to operate a remote PC by device name."
origin: "Execution core from song-chaoyang/uu-remote-vscode (MIT); operational rules from yinren112/uu-remote-ops; official JSON/error-code conventions from NetEase vendor skill (uuyc.163.com/help/cli.html); merged & audited 2026-09-07"
---

# uu-remote-bridge

通过官方 `uuyc-cli term` 管道通道，在远程设备上非交互执行命令、读写小文件、处理交互式终端。本机无需 VSCode，远程无需装任何东西（只需 UU远程 被控端）。

## 前提（官方要求）

- 本机 UU远程 主程序**运行且已登录**，账号与被控端**同账号**（未运行 → 退出码 2 / 错误码 1002，未登录 → 1001）
- **主控端与被控端均为 V4.39.0 及以上**（旧版主控端不能连新版被控端）。本项目**不绑定版本**：`term` 通道能力运行时探测，升级 UU远程 后无需改配置
- 被控端**仅支持 Windows**；被控端锁屏时进终端需一次系统账户验证（Windows 主控端发起需手动输入被控端系统账户密码）
- Node.js ≥ 20

## 工具位置（自包含）

| 路径 | 说明 |
|---|---|
| `bin/uu-bridge.cjs` | 编译好的单文件 CLI（仅启动官方 uuyc-cli，无网络/eval/遥测） |
| `src/` | TypeScript 源码（可审计、可重编译） |
| `scripts/uu-doctor.ps1` | 只读体检：CLI 存在性、主程序通信、设备在线、现有会话（动手前先跑） |
| `scripts/uu-push-file.ps1` | 小文件分块推送（上游脚本，当前版本标记渲染未适配，暂用 `write` 替代） |
| `vendor/official-docs/` | 官方文档全文存档 + `INDEX.md`（硬约束/待验项）。**不进 Git** |

Windows 上调用（skill 目录通常为 `%USERPROFILE%\.agents\skills\uu-remote-bridge`）：

```powershell
node "%USERPROFILE%\.agents\skills\uu-remote-bridge\bin\uu-bridge.cjs" <子命令> ...
```

## 命令速查

| 命令 | 说明 |
|---|---|
| `doctor` | 只读预检：CLI 路径/版本、主程序连通、设备在线、≥V4.39.0 判定（不触碰 term 通道） |
| `list` | 列出账号下所有设备（ID、名称、在线状态） |
| `exec <device_id> "<命令>"` | 远程执行一条命令，自动分页拉全输出（默认 powershell） |
| `read <device_id> <远程路径>` | 读远程文件到 stdout（base64 分页+长度强校验，≤256KB） |
| `write <device_id> <远程路径> <本地文件>` | 推送本地文件到远程（≤512KB，含中文路径/内容无损） |
| `pty <device_id>` | 交互模式：stdin 每行 → 远程屏幕快照（处理 ssh 密码、y/n 确认） |
| `sessions <device_id>` | 列出远程终端会话（运维清理用） |
| `kill <device_id> <session_id>` | 结束指定会话（只 kill 确认属于自己的） |

`exec`/`read`/`write` 仅支持 `--shell powershell`；cmd/zsh 会话请用 `pty`。

## 标准工作流

1. 动手前跑只读体检：`node bin\uu-bridge.cjs doctor` 或 `pwsh -File scripts/uu-doctor.ps1`（确认主程序通信、设备在线、**无他人正在使用远程机**）
2. `list` 拿设备 ID（设备 ID 会变，不要硬编码记忆值）
3. `exec` 执行命令；判读用 `NAME=VALUE` 结构化标记（如 `HASH=...`、`COUNT=113`），不依赖整段文本
4. 任务结束清理自己产生的临时文件与残留，复核为空才算完成

```powershell
node ...\bin\uu-bridge.cjs list
node ...\bin\uu-bridge.cjs exec <device_id> "Get-PSDrive -PSProvider FileSystem"
node ...\bin\uu-bridge.cjs exec <device_id> "Get-Content C:\Users\xx\log.txt -Tail 20"
pwsh -File scripts\uu-push-file.ps1 -DeviceId <device_id> -LocalPath .\fix.ps1 -RemotePath 'C:\fix.ps1'
```

## 运营铁律

### 会话卫生（409 的根源）

- 通道**同时只允许一个窗口附加**：他人正在用时立即停手等待，绝不抢占
- `--new-session` 报 `409 terminal session already exists`：`exited` 会话仍占服务端独占锁，按 `LAST_ACTIVE` 找最新会话 `--kill-session <id>` 再新建；**只 kill 确认属于自己的会话**
- 每次 `exec`/`read`/`write` 会自动 `exit` 收尾；被 timeout 强杀的进程可能在远程留残留，用 `sessions` 检查

### 命令与输出

- 命令一律**单行**（`;` 连接）：多行 here-string 会被逐字符粘贴破坏
- 复杂脚本不要内联：先 `write` 落盘再 `exec`；远程 `.ps1` 被执行策略拒绝时用 `powershell -NoProfile -ExecutionPolicy Bypass -File ...`
- 走原始 CLI 时需自行过滤 `[连接]` 日志与 ANSI 转义（本工具已处理）

### 编码与假故障

- **远程机多为 PowerShell 5.1，本机可能是 7**：`Sort-Object` 等行为差异会制造"两端不一致"假故障，比对用顺序无关聚合
- `.cmd`/`.bat` 落到远程前**必须转 GBK + CRLF**
- 中文乱码：设 `PYTHONIOENCODING=utf-8`，远端文件统一 UTF-8

### 官方 JSON 约定（管理面命令）

- 先判 `.success`，成功读 `.data`，失败读 `.error.code/.error.message`——**很多失败仍以退出码 0 结束，不能只看退出码**
- 错误码：1001 未登录 / 1002 主应用未运行 / 1003 版本不匹配 / 1004 参数无效 / 1005 数据未刷新 / 1006 设备未找到 / 1008 多匹配 / 1010 设备离线
- 设备名模糊匹配用 `--m "名称"`（双横线），不要把名称当位置参数

## 故障排查

| 现象 | 原因/处理 |
|---|---|
| 业务命令失败但退出码 0 | 解析 JSON `.success/.error`，按错误码表处理 |
| 退出码 2 / 错误码 1002 / 1001 | 主程序未运行或未登录。官方：除 `version` 外所有命令都要求客户端后台运行 |
| 「主控端版本过低，被控端不再兼容此协议版本」（退出码 6） | 被控端版本高于主控端 → **升级主控端**（【更多】→【检查更新】或开启自动更新） |
| `无法启动 CLI` / `ENOENT` | CLI 不在默认安装目录（官方：CLI 在安装目录 `bin` 下，默认不在 PATH）→ 设 `UU_CLI_PATH=<完整路径>` |
| 「不支持远程终端管道通道」 | 本机 CLI 太旧（`term` 只有 `open/exit`），升级 UU远程 主程序 |
| 「远程终端会话无法就绪」 | 被控端离线；被控端锁屏待系统账户验证；通道被他人占用（**立即停手，不抢占**） |
| 锁屏后进终端要验证 | 官方：进终端前需完成一次系统账户验证（仅验证身份，不解锁屏幕）；Windows 主控端发起时需手动输入被控端系统账户密码 |
| 非同账号/协助场景要用终端 | 官方：终端仅支持**同账号远控**，远程协助暂不支持 |
| "attached from another window" | 他人/别的窗口正占用通道，等待或协调，不抢占 |
| 「操作过于频繁」/ Streamer error 2005 | 建会话限流，工具已内置退避重试；仍失败则等 30s 再试 |
| 409 terminal session already exists | 僵尸会话占锁：`sessions` → `kill` 自己的会话 → 重试 |

## 协议硬限制（2026-09 生产验收实测）

- **性能基线**：单次 exec 全程 ~7s（含握手）；读吞吐 ~0.8-1KB/s、写 ~1.7KB/s；64KB 读约 55s、写约 40s。长输出先在远程端过滤
- **read/write 上限**：read 256KB（b64 长度强校验，不符自动重拉 3 次，仍不符显式报错）；write 512KB（失败带远程异常消息）；**更大文件走 UU 图形界面文件传输**，传完用 exec 核对 SHA256
- 每条命令 Clear-Host 冲刷 + BEGIN 标记隔离回显 + 26 行分页；内置限流退避与哨兵后静默确认
- 会话结束自动 exit，但**服务端可能仍标记 detached running**（实测不阻塞新会话：40+ 连续调用零 409）；累积后用 `sessions` + `kill` 清理
- 官方「端口映射」是 **GUI 能力、无 CLI 命令**，且关闭面板即失效，不作自动化通道
- 实测版本矩阵见 `README.md`「版本与兼容」

## 重编译（修改 src 后）

```powershell
cd <skill-dir>/src
npx esbuild main.ts --bundle --platform=node --outfile=..\bin\uu-bridge.cjs
```

## 来源与溯源

- 执行核心：https://github.com/song-chaoyang/uu-remote-vscode （TermBridge/vt/capabilities，MIT）
- 运营规程：https://github.com/yinren112/uu-remote-ops （409/PS5.1/GBK/分块传输）
- 官方规范：https://uuyc.163.com/help/cli.html 及官方 skill zip（JSON 约定、错误码）
- 官方文档（版本门槛/平台限制/退出码）：[CLI 教程](https://uuyc.163.com/blog/20260625-cli.html)、[终端说明](https://uuyc.163.com/help/20260509/40220_1299599.html)、[端口映射](https://uuyc.163.com/help/20260423/40220_1297526.html)
- **2026-09 生产验收修复**（8 阶段 38 项测试驱动）：Clear-Host 冲刷替代 60 空行（服务端差分渲染器会丢宽行）、VtScreen 补 ECH(CSI X)、限流退避重试、哨兵后静默确认、分页自愈 + b64 长度强校验（杜绝静默损坏）、read/write 显式 MISS/FAIL 标记、新增 sessions/kill 子命令
