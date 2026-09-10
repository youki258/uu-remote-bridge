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

**前置**：本机 UU远程主程序运行且已登录；远程机装有 UU远程被控端；Node.js ≥ 20。主控/被控端实测版本：UU远程 4.38.3（CLI 1.0.0），Windows → Windows。

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

## 实测性能与限制（Windows → Windows，4.38.3）

| 项 | 实测值 |
|---|---|
| 单次 exec 全程 | ~7s（含握手） |
| 读吞吐 | ~0.8-1.2KB/s（64KB ≈ 55s） |
| 写吞吐 | ~1.7KB/s（64KB ≈ 40s） |
| read 上限 | 256KB（分页化 + 强校验） |
| write 上限 | 512KB |

- `exec/read/write` 仅支持 `--shell powershell`；cmd/zsh 会话请用 `pty`
- 更大文件请走 UU远程 图形界面文件传输，传完用 `exec` 核对 SHA256
- 协议行为与 UU远程 版本强相关，其他版本未验证

## 推 `.bat` 注意

`.bat/.cmd` 落到远程 Windows 前需转 GBK + CRLF（PowerShell 示例）：

```powershell
$t = [IO.File]::ReadAllText('.\run.bat'); [IO.File]::WriteAllText('.\run-gbk.bat', ($t -replace "`r`n","`n" -replace "`n","`r`n"), [Text.Encoding]::GetEncoding(936))
```

## 致谢与来源

- [song-chaoyang/uu-remote-vscode](https://github.com/song-chaoyang/uu-remote-vscode)（MIT）——本项目的 TermBridge/VT 屏幕解析核心由此提取
- [yinren112/uu-remote-ops](https://github.com/yinren112/uu-remote-ops)（无许可证，仅致谢思路，未 redistribute 其代码）——会话卫生/409/PS 5.1 差异等运营知识
- [网易 UU远程 官方 CLI 文档](https://uuyc.163.com/help/cli.html) 与官方 CLI SKILL——管理面规范与 JSON/错误码约定

## 免责声明

非官方项目，与网易无关联。`uuyc-cli` 为 UU远程 官方随主程序发布的命令行工具，本项目仅做本地进程编排。请只对你有授权的设备执行操作。协议行为随 UU远程 版本变化，使用前建议先跑 `exec <device_id> "hostname"` 验证链路。

## License

MIT（见 [LICENSE](LICENSE)）
