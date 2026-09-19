# uu-remote-bridge

让 AI Agent（Claude Code / Codex / pi / 任意 CLI agent）**非交互驱动网易 UU远程（GameViewer）的远程终端**——在远程电脑上执行命令、读写文件、处理交互式终端，无需 VSCode、无需在远程装任何东西。

> UU远程自带的 `uuyc-cli term` 是交互式 TUI，管道重定向会挂起；官方 CLI SKILL 只覆盖设备/云电脑管理，不覆盖远程终端执行。本项目补齐这一层。

## 功能

| 命令 | 说明 |
|---|---|
| `list` | 列出账号下所有设备（ID / 名称 / 在线状态） |
| `exec <device_id> "<命令>"` | 远程执行命令，哨兵同步 + 分页自动拉全输出（不截断一屏） |
| `read <device_id> <路径>` | 读远程文件（base64 分页 + 行数/总长**双强校验**，杜绝静默损坏） |
| `write <device_id> <路径> <本地文件>` | 推送本地文件（失败携带远程异常消息显式报错） |
| `pty <device_id>` | 交互模式：stdin 每行 → 远程屏幕快照（ssh 密码、y/n 确认等） |
| `sessions` / `kill` | 会话运维（列表 / 清理残留） |

内置可靠性工程（生产验收实测驱动）：
- 建会话限流退避重试（"操作过于频繁" / Streamer error 2005）
- Clear-Host 冲刷（绕开服务端差分渲染器丢宽行的问题）+ VT 屏幕解析含 ECH(CSI X)
- 哨兵命中后静默确认（防渲染流被下一条命令打断）
- 读文件完整性双校验（行数 + 总长），不符自动重拉 3 次，仍不符显式报错

## 安装

```powershell
git clone https://github.com/youki258/uu-remote-bridge.git
```

**前置**（官方要求）：

- UU远程 主程序**运行且已登录**，与被控端**同账号**（未运行 → 退出码 2，未登录 → 错误码 1001）
- **主控端与被控端均为 V4.39.0 及以上**（旧版主控端不能连新版被控端）；本项目不绑定版本，能力运行时探测
- 被控端**仅支持 Windows**；锁屏时进终端需一次系统账户验证（Windows 主控端发起需手动输入被控端系统账户密码）
- Node.js ≥ 20

作为 agent skill 使用：整个目录拷到 `%USERPROFILE%\.agents\skills\uu-remote-bridge`（Claude Code / pi / Codex 的 skill 目录），`SKILL.md` 会自动生效。

## 用法

```powershell
node bin\uu-bridge.cjs list
node bin\uu-bridge.cjs exec  <device_id> "Get-PSDrive -PSProvider FileSystem"
node bin\uu-bridge.cjs exec  <device_id> "1..200 | ForEach-Object { \"LINE-$_\" }"   # 200 行完整拉回
node bin\uu-bridge.cjs read  <device_id> "C:\remote\path\file.txt" > local.txt
node bin\uu-bridge.cjs write <device_id> "C:\remote\path\file.txt" .\local.txt
node bin\uu-bridge.cjs pty   <device_id>          # 交互模式
node bin\uu-bridge.cjs sessions <device_id>       # 会话运维
node bin\uu-bridge.cjs kill <device_id> <session_id>
```

## 版本与兼容

本项目**不绑定 UU远程 版本**：`term` 通道能力运行时探测（`term --help` 是否含 `--device-id` / `--new-session` / `--list-sessions` / `--shell`），升级后无需改配置。升级后先跑 `node bin\uu-bridge.cjs doctor`。

| 能力 | 实测版本 | 证据 | 状态 |
|---|---|---|---|
| 管理面（`list` / `device list` / `echo` / `version` / `-d` / 能力探测） | 4.41.0.2311 | 2026-09-18 本机 `list` → 退出码 0 | ✅ |
| term 管道通道（`exec` / `read` / `write` / `pty`） | 4.39.2 | `TEST-REPORT.md` 38 项验收（2026-09-09 ~ 09-10） | ✅ |
| term 管道通道（`exec` / `read` / `write`） | 主控端 4.41.0.2311 × 被控端 <device> | 2026-09-19 `exec` 8/8 正确、`write`/`read` 700B 字节级一致 + SHA256 双向吻合 | ✅ |

低于 V4.39.0 的主控端不能连接，且旧版 CLI 的 `term` 只有 `open/exit`、没有本项目依赖的管道通道。**V4.39.0 是必要非充分条件：主控端必须不低于被控端**——被控端自动静默升级后，旧主控端会直接报「主控端版本过低」。未列出的版本不等于不支持，先跑 `doctor` 再动手。

## 实测性能与限制（Windows → Windows）

| 项 | 实测值 |
|---|---|
| 单次 exec 全程 | ~7s（含握手） |
| 读吞吐 | ~0.8-1.2KB/s（64KB ≈ 55s） |
| 写吞吐 | ~1.7KB/s（64KB ≈ 40s） |
| read 上限 | 256KB（分页化 + 强校验） |
| write 上限 | 512KB |

- `exec/read/write` 仅支持 `--shell powershell`；cmd/zsh 会话请用 `pty`
- 更大文件请走 UU远程 图形界面文件传输，传完用 `exec` 核对 SHA256（官方「端口映射」虽是 GUI 能力、可用于映射远端 TCP 服务，但明确「关闭端口映射面板后映射不会继续」，不适合无人值守，故未纳入本工具）
- 版本兼容与升级排查见下文「版本与兼容」「升级 UU远程 后 CLI 不工作？」

## 升级 UU远程 后 CLI 不工作？

先跑只读体检 `node bin\uu-bridge.cjs doctor`（或 `pwsh -File scripts\uu-doctor.ps1`），再对照下表。

| 现象 | 原因 | 处理 |
|---|---|---|
| 退出码 2 / 错误码 1002 | 主程序未运行（官方：除 `version` 外所有命令都要求客户端后台运行） | 打开 UU远程 并保持后台运行 |
| 错误码 1001 | 未登录 | 在客户端登录账号 |
| 「主控端版本过低，被控端不再兼容此协议版本」（退出码 6） | 实测该报文**不可作为版本不兼容的判据**：2026-09-18 同版本对报此错，09-19 未升级任何一端即恢复正常 | ① 先用 GUI 进 [设备详情]→[终端] 交叉验证；② 关掉 GUI 终端窗口、清掉遗留会话（`sessions` → 只 kill 自己的）后重试；③ 只有 GUI 也不可用且两端版本确实不等时，才按版本不匹配处理（升级较低一端） |
| `无法启动 CLI` / `ENOENT` | CLI 不在默认安装目录（官方：CLI 位于安装目录 `bin` 下，默认不在 PATH） | 本项目已内置多盘符 / `LOCALAPPDATA` / PATH 探测；仍失败则设环境变量 `UU_CLI_PATH=<完整路径>` |
| 「远程终端会话无法就绪」 | 被控端离线 / 被控端锁屏待系统账户验证 / 通道被他人占用 | `list` 确认在线；锁屏时先完成系统账户验证；出现 `attached from another window` **立即停手等待**，绝不抢占 |
| 「当前 uuyc-cli 版本不支持远程终端管道通道」 | 本机 CLI 太旧（`term` 只有 `open/exit`） | 升级 UU远程 主程序 |

## 推 `.bat` 注意

`.bat/.cmd` 落到远程 Windows 前需转 GBK + CRLF（PowerShell 示例）：

```powershell
$t = [IO.File]::ReadAllText('.\run.bat'); [IO.File]::WriteAllText('.\run-gbk.bat', ($t -replace "`r`n","`n" -replace "`n","`r`n"), [Text.Encoding]::GetEncoding(936))
```

## 官方文档

| 主题 | 链接 |
|---|---|
| CLI 命令行教程（退出码表、命令清单、主程序常驻要求） | https://uuyc.163.com/blog/20260625-cli.html |
| 终端功能说明（版本门槛、平台限制、同账号、锁屏验证） | https://uuyc.163.com/help/20260509/40220_1299599.html |
| 端口映射说明（GUI 能力，非 CLI） | https://uuyc.163.com/help/20260423/40220_1297526.html |

> 本地全文存档见 `vendor/official-docs/`（该目录被 `.gitignore` 忽略，不进 Git），其中 `INDEX.md` 提炼了与本项目直接相关的硬约束与待验未知项。

## 致谢与来源

- [song-chaoyang/uu-remote-vscode](https://github.com/song-chaoyang/uu-remote-vscode)（MIT）——本项目的 TermBridge/VT 屏幕解析核心由此提取
- [yinren112/uu-remote-ops](https://github.com/yinren112/uu-remote-ops)（无许可证，仅致谢思路，未 redistribute 其代码）——会话卫生/409/PS 5.1 差异等运营知识
- [网易 UU远程 官方 CLI 文档](https://uuyc.163.com/help/cli.html) 与官方 CLI SKILL——管理面规范与 JSON/错误码约定

## 免责声明

非官方项目，与网易无关联。`uuyc-cli` 为 UU远程 官方随主程序发布的命令行工具，本项目仅做本地进程编排。请只对你有授权的设备执行操作。协议行为随 UU远程 版本变化，升级后建议先跑 `node bin\uu-bridge.cjs doctor` 只读体检，再用 `exec <device_id> "hostname"` 验证链路。

## License

MIT（见 [LICENSE](LICENSE)）
