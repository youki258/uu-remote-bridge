# uu-remote-bridge

让 AI Agent（Claude Code / Codex / pi / 任意 CLI agent）**非交互驱动网易 UU远程（GameViewer）的远程终端**——远程执行命令、读写文件、处理交互式终端。无需 VSCode，远程无需装任何东西。

> UU远程自带的 `uuyc-cli term` 是交互式 TUI，管道重定向会挂起；官方 CLI SKILL 只覆盖设备管理，不覆盖远程终端执行。本项目补齐这一层。

## 快速开始

```powershell
git clone https://github.com/youki258/uu-remote-bridge.git
cd uu-remote-bridge
node bin\uu-bridge.cjs doctor                        # 只读体检：CLI / 版本 / 在线 / 兼容
node bin\uu-bridge.cjs list                          # 拿 device_id
node bin\uu-bridge.cjs exec <device_id> "hostname"
```

前置：

- UU远程 主程序**运行且已登录**，主控端与被控端**同账号**（未运行 → 退出码 2；未登录 → 错误码 1001）
- 两端均 **V4.39.0 及以上**，且**主控端不低于被控端**（本项目不锁版本，能力运行时探测，升级后无需改配置）
- 被控端支持 **Windows / macOS**；**本项目实测范围仅 Windows 被控端**。锁屏时进终端需一次系统账户验证（Windows 主控端发起需手动输密码）
- Node.js ≥ 20

作为 agent skill 使用：整个目录拷到 `%USERPROFILE%\.agents\skills\uu-remote-bridge`（Claude Code / pi / Codex 的 skill 目录），`SKILL.md` 自动生效。
运行时只需要 `SKILL.md` + `bin/` + `scripts/`；`PROTOCOL.md`（协议常量）、`PLAN.md`/`TEST-REPORT.md`（开发记录）、`tools/`/`tests/`（取证与离线回归）均不影响 skill 加载。

## 命令

| 命令 | 说明 |
|---|---|
| `list` | 列出账号下所有设备（ID / 名称 / 在线状态） |
| `exec <device_id> "<命令>"` | 远程执行命令，输出分页拉全（不截断一屏） |
| `read <device_id> <路径>` | 读远程文件（base64 分页，行数 + 总长双校验，不符自动重拉） |
| `write <device_id> <路径> <本地文件>` | 推送本地文件 |
| `pty <device_id>` | 交互模式：stdin 每行 → 远程屏幕快照（ssh 密码、y/n 确认等） |
| `sessions` / `kill` | 会话列表 / 清理残留 |

## 故障排查

先跑 `node bin\uu-bridge.cjs doctor`，再对照：

| 现象 | 处置 |
|---|---|
| 退出码 2 / 错误码 1002 | 打开 UU远程 并保持后台运行 |
| 错误码 1001 | 在客户端登录 |
| 「主控端版本过低，被控端不再兼容此协议版本」（退出码 6） | 多为 **term 通道未激活，与版本无关**：在 UU远程 GUI 里打开该设备的终端窗口，再重试（实测秒级恢复）；终端开着仍报错且两端版本确实不等时，升级版本旧的一端 |
| 「无法启动 CLI」/ ENOENT | 设环境变量 `UU_CLI_PATH=<CLI完整路径>`（CLI 在安装目录 `bin` 下，默认不在 PATH） |
| 「远程终端会话无法就绪」 | `list` 确认被控端在线；锁屏先完成系统账户验证；出现 `attached from another window` **立即停手等待**，绝不抢占 |
| 「当前 uuyc-cli 版本不支持远程终端管道通道」 | 本机 CLI 太旧（`term` 只有 `open/exit`），升级 UU远程 主程序 |

## 性能与限制（Windows → Windows 实测）

| 项 | 实测值 |
|---|---|
| 单次 exec 全程 | ~7s（含握手） |
| 读吞吐 | ~0.8-1.2KB/s（64KB ≈ 55s） |
| 写吞吐 | ~1.7KB/s（64KB ≈ 40s） |
| read 上限 | 256KB（**实测可信区间见下**） |
| write 上限 | 512KB |

**实测安全包络（2026-09-19，4.41.0.2311）**：屏幕为 **39 行 × 120 列**，超长行按 120 列折行，所以「输出行数」≠「屏上行数」——
旧版在此处是静默出错的：`exec` 输出行 >120 列时 30 行只回 4 行；`read` 在 ≥8KB 时返回过变长错误数据（均 `exit=0`）。当前版本已改为：

- 分页按**屏行成本**计算（`ceil(len/120)`），对端回报本页非空行数，不符则换新哨兵重拉，仍不符**显式报错**
- `read` 强制要求远端 `UU_FLEN` 长度标记，**取不到就失败**（不再「取不到就跳过校验」）
- 写入超时消息明确「远端状态未知」并给出 `Get-FileHash` 核对命令

证据与常量：`PROTOCOL.md`；离线回归：`node tools/protocol-regress.cjs`（重放 `tests/fixtures/*.raw`，不触远程）。

- `exec/read/write` 仅支持 powershell；cmd/zsh 或交互场景用 `pty`
- 更大文件走 UU远程 GUI 文件传输，传完用 `exec` 核对 SHA256
- 推 `.bat/.cmd` 到远程前需转 GBK + CRLF：

```powershell
$t = [IO.File]::ReadAllText('.\run.bat'); [IO.File]::WriteAllText('.\run-gbk.bat', ($t -replace "`r`n","`n" -replace "`n","`r`n"), [Text.Encoding]::GetEncoding(936))
```

## 官方文档

| 主题 | 链接 |
|---|---|
| CLI 命令行教程（退出码表、命令清单、主程序常驻要求） | https://uuyc.163.com/blog/20260625-cli.html |
| 终端功能说明（版本门槛、平台限制、同账号、锁屏验证） | https://uuyc.163.com/help/20260509/40220_1299599.html |
| 端口映射说明（GUI 能力，非 CLI） | https://uuyc.163.com/help/20260423/40220_1297526.html |

## 致谢与来源

- [song-chaoyang/uu-remote-vscode](https://github.com/song-chaoyang/uu-remote-vscode)（MIT）—— TermBridge / VT 屏幕解析核心由此提取
- [yinren112/uu-remote-ops](https://github.com/yinren112/uu-remote-ops)（无许可证，仅致谢思路）—— 会话卫生 / 409 / PS 5.1 差异等运营知识
- [网易 UU远程 官方 CLI 文档](https://uuyc.163.com/help/cli.html) —— 管理面规范与 JSON / 错误码约定

## 免责声明

非官方项目，与网易无关联。`uuyc-cli` 为官方随主程序发布的命令行工具，本项目仅做本地进程编排。只对你有授权的设备执行操作。协议行为随 UU远程 版本变化，升级后先跑 `doctor`，再 `exec <device_id> "hostname"` 验证链路。

## License

MIT（见 [LICENSE](LICENSE)）
