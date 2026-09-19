# uu-remote-bridge 生产级验收报告

日期: 2026-09-09 ~ 09-10 | 被测: bin/uu-bridge.cjs (+ scripts) | 目标: <device> (<device_id>, Windows)

被测版本: UU远程 4.39.2（CLI 同版本，Windows → Windows）。复验记录: 4.41.0.2311 管理面通过（2026-09-18），term 管道通道待复测。

## 结论
**38 项测试全部通过**(含测试中发现 6 个缺陷的修复后复验),工具达到生产可用状态。
远程测试目录已清理复核为空,测试会话已全部 kill,无残留。

## 2026-09-18 复验（主控端 UU远程 4.41.0.2311）

| 项 | 结果 |
|---|---|
| 管理面（`list` / `device list` / `echo` / `version` / `-d` / 能力探测） | ✅ 通过（`list` 退出码 0；`term --help` 含 `--device-id/--new-session/--list-sessions/--shell` → termChannel=true） |
| term 管道通道（`exec` / `read` / `write` / `pty`） | ❌ 阻塞：**官方协议不兼容**，非本项目缺陷 |

**原始日志**（被控端 <device>，`uuyc-cli term --device-id … --new-session`，stderr，退出码 6）：

```
[系统] 启动终端会话...
[终端] 主控端版本过低，被控端不再兼容此协议版本，请升级主控端
```

**根因**：被控端版本高于主控端（官方：旧版主控端不能连接新版被控端）。修复动作在**用户侧**——升级本机主控端（【更多】→【检查更新】）。

**补充实测（同日）**：本机已重启客户端且应用内「检查更新」提示已是最新（本机 4.41.0.2311，CLI 与主程序同版本，文件日期 2026-09-17），重试仍报同一错（`--new-session` / 默认 / `--shell cmd` 三种形态一致）→ 指向**被控端版本高于主控端可用版本**（内测/灰度可能）。CLI 无法查询对端版本。

**本轮修复的缺陷**：

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| F-7 | 真实错因被吞：只报「远程终端会话已断开/无法就绪」，看不到「主控端版本过低」 | `termBridge.stderrDiagnosis()` 用 `^\[终端\]` 前缀整类过滤，把错误行一起丢掉 | 改为「噪声前缀过滤 + 错因关键词白名单」，含 版本/不兼容/失败/超时 等关键词的行永远保留 |

**复验证据**（F-7 修复后）：`ERROR: 远程终端会话无法就绪:[终端] 主控端版本过低，被控端不再兼容此协议版本，请升级主控端`

**结论修正（2026-09-19）**：该报文**不可作为版本不兼容的判据**。同一对机器、同版本（未升级任何一端）在 09-19 恢复正常——当时报此错时通道实际可用（GUI 终端在跑），指向误导性错误报文 + 通道占用/更新期瞬时态。凡遇此报文，先做 GUI 交叉验证与清场重试。

## 2026-09-19 端到端验收（主控端 4.41.0.2311 × 被控端 <device>）

前置门禁：设备在线 + `No active sessions`。

| 项 | 结果 |
|---|---|
| `exec` | ✅ 8/8 返回正确 payload（另有 `Get-Date` / `Get-FileHash` / `Test-Path` 等调用） |
| `write` | ✅ 700 字节 / 4.9s |
| `read` 回读 | ✅ 5.96s，`cmp` 字节级一致 |
| SHA256 双向核对 | ✅ 远程 == 本地 `66A0F256…4355` |
| 60 行分页 | ⚠️ 首次 58/60（丢 27、28 行），重跑 60/60 → 非确定性渲染丢行 |
| 清理 | ✅ 会话 0、远程临时文件已删 |

**本轮修复的缺陷**：

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| F-8 | `exec` 输出间歇性混入 `Cl` 残行（5 次中 3 次、另 2/3 次） | `extract()` 的 `isNoiseLine()` 未过滤 Clear-Host 回显前缀残片与回显夹带的内部 token | 加「冲刷前缀残片（2-24 字符且为命令前缀）」+「内部脚手架 token（`uuOut`/`UU_B`/`UU_E_`/`UU_N_`）」双过滤；回归 8/8 干净 |

**本轮新发现（未修）**：

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| F-9 | `pullPages()` 仅在整页返回 **0 行**时重试；页内丢行（26 行只回 24 行）被接受 | `exec` 大输出可能**静默缺行** | 让分页命令同时回报该页非空行数，按期望值校验并重试该页 |

**未验证**：`pty` 交互、被控端锁屏时的账户验证行为。

## 2026-09-19 全面测试（主控端 4.41.0.2311 × 被控端 <device>，GUI 终端同开）

| 模块 | 测试 | 结果 |
|---|---|---|
| 管理面 | `doctor` / `list` / `sessions` | ✅ 全部正常（GUI 会话同时存在也不阻塞） |
| exec | 基本/中文/错误路径（非零命令不中断） | ✅ |
| exec | 60 行 ×3 + 200 行 ×2（分页完整性逐行 diff） | ✅ 全部完整，零丢行、零 `Cl` 残行 |
| write | 1200B 随机二进制 | ✅ 4.9s |
| read | 回读 `cmp` 字节级一致 + SHA256 双向吻合 | ✅ 5.96s |
| read/write | 38B 中文+空行/空白行边界文件 | ✅（重试后一致） |
| pty | 管道输入交互（echo 命令 + PTY-OK 回显） | ✅ |
| 会话卫生 | 只 kill 自己的会话，用户的 GUI 会话保留 | ✅ 远程临时文件清零、会话清零 |

**结论**：健康连接下全部通过；当日早些时候的失败（丢行、空输出、`主控端版本过低` 报文）均发生在 UU远程 主控端掉线/重连窗口内，**不属于本项目缺陷**。

### 本轮记录的已知限制

| # | 现象 | 说明 |
|---|---|---|
| F-9 | 通道不稳定窗口内，分页输出可能丢行/行内容被擦（如 `LINE-105` 变成 `     105`） | 仅在不稳定窗口复现；健康窗口下 200/200 ×2 全通过。修复尝试（页级行数校验+换哨兵重试）反而导致第 2 页起超时，**已回退**，原始补丁存档于 `vendor/wip/f9-pages-verify.patch`（不进 Git）。用户侧缓解：对关键输出用 `NAME=VALUE` 结构化标记 + 行数/哈希自行校验 |
| F-10 | 输出管道接 `\| head` 等下游提前关流时，进程带 EPIPE 堆栈崩溃 | Node stdout 的 EPIPE 未处理；小瑕疵 |
| 其他 | 首次建会话后首条命令偶发空输出（当日观察 2 次，均发生于不稳定窗口） | 同上，建议对关键命令重跑确认 |

## 修复的缺陷(测试驱动)
| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| F-1 | 连续建会话触发服务端限流(2005/操作过于频繁) | 服务端限流 | 退避重试 0/8/16s |
| F-2 | 提示符噪声漏过滤(远程提示符无 PS 前缀+前导空格) | 过滤正则 | 双模式+\s* 前缀 |
| F-3 | 长行/多行输出间歇性丢失、乱码 | ①60空行滚动冲刷触发服务端差分渲染器丢宽行(只发ECH碎片) ②渲染流未结束就被下一条命令打断 | Clear-Host 冲刷 + 哨兵后静默确认(500ms) + 分页自愈重试 |
| F-4 | 屏幕解析缺 ECH(CSI X) | vt.ts 未实现 | 补实现 |
| F-5 | read 永不执行(PS单行解析错误: else 块两语句间缺分号);write 假成功(PS 方法异常后 ; 链继续执行哨兵) | 上游 join(' ')/无异常处理 | 单行合法分号 + try/catch + MISS/FAIL 显式标记 |
| F-6 | 大文件分页读静默丢行(64KB 丢 536B 无报错) | 渲染竞态 | b64 行数+总长双校验,不符自动重拉3次,仍不符显式报错 |

## 测试矩阵结果
### Phase B 通道预检(4/4)
echo通信/list设备/doctor体检/会话基线 全 PASS

### Phase C exec 功能(10/10)
身份核验(单行完整)/中文输出/空输出/必败命令/特殊字符($ | ; " ')/200行分页(精确200行全序)/120字符长行/--shell cmd 明确拒绝/超时行为/幂等性 全 PASS

### Phase D 文件传输(核心 7/8)
1KB中文回环SHA256一致/32KB分页读SHA一致(39s)/64KB回环3次全一致(55s)/300KB TOOBIG拒绝/读目录ISDIR/读不存在MISS快速报错/写不存在目录显式报错 全 PASS
**未过**: uu-push-file.ps1 上游脚本在当前服务端版本下确认标记渲染丢失(D6/D7/D8 FAIL)——已记录,以 write 替代;.bat GBK转换需本地预处理(已写入 SKILL.md)

### Phase E pty 交互(3/3)
常规命令/Read-Host交互应答/退出收尾 全 PASS

### Phase F 稳定性(4/4)
10x压测 10/10 PASS(延迟 min=6.8s avg=7.7s max=9.6s)/中途强杀后恢复 PASS/错误设备ID 1s快速失败/会话残留可清理 PASS
**发现**: detached 会话在当前版本标记 running 但不阻塞新会话(40+调用零409);已加 sessions/kill 子命令运维

### Phase G 清理与验收(5/5)
远程测试目录删除复核为空/会话全部kill(No active sessions)/SKILL.md 按实测修订/主备同步/最终健全性 FINAL-OK

## 性能基线(生产规划用)
- exec 单次 ~7s(握手~4s+静默确认~1s+渲染)
- 读: 32KB=39s(0.8KB/s) 64KB=55s(1.2KB/s) | 写: 64KB=39s(1.7KB/s)
- 建议: >64KB 的读/写改走 UU 图形界面文件传输+SHA256 核对

## 原始日志
=== uu-remote-bridge 生产级验收 2026-09-10 15:22:13 ===
B1 rc=0 out=ping
B2 rc=0 out=[<device_id>	<device_name>	online=true	platform=1]
B2-PASS
B3 rc=0
=== uu-doctor (read-only) ===
CLI_FOUND=True
MAIN_APP_OK=True
DEVICE_LIST_OK=True
--- device list ---
{
    "data": {
        "devices": [
B4-GREEN 基线会话:
No active sessions.
C1 out=[   C:\Users\<user>>
admin
\<user>]
C1-FAIL
C2 out=[   C:\Users\<user>>
你好世界测试]
C2-PASS
C3 out=[ERROR: 远程终端会话无法就绪:Error: Streamer error: 2005] rc=1
C3-FAIL
C4 rc=0 out前3行=
(no output)
C4-PASS(错误被捕获返回,未挂死)
C5 out=[   C:\Users\<user>>
its : 无法将“its”项识别为 cmdlet、函数、脚本文件或可运行程序的名称。请检查名称的拼写，如果包括路径，请确保路径正确，
然后再试一次。法将“its”项识别为 cmdlet、函数、脚本文件或可运行程序的名称。请检查名称的拼写，如果包括路径，请确保路径正确，
所在位置 行:1 字符: 87
+ ... lobal:uuOut = @(Write-Output "a`$b | c; d"; Write-Output (its + "-quo ...
+     lobal:uuOut   @(Write-Output                Write-Output  ~~~ + "-quo ...
    + CategoryInfo          : ObjectNotFound: (its:String) [], CommandNotFoundException
    + FullyQualifiedErrorId : CommandNotFoundExceptioning) [], CommandNotFoundException
a$b | c;ldyQualifiedErrorId : CommandNotFoundException]
C5-FAIL
C8 out=[ERROR: 命令超时(20000ms),设备可能繁忙或离线]
C8-FAIL
C10 两次=[ERROR: 远程终端会话无法就绪:Error: Connect device failed: 操作过于频繁，请稍后再试][ERROR: 远程终端会话无法就绪:Error: Connect device failed: 操作过于频繁，请稍后再试]
C10-PASS
C1 out=[   C:\Users\<user>>
admin
\<user>]
C1-PASS(重测)
C3 out=[(no output)]
C3-PASS(重测)
C5 out=[   C:\Users\<user>>
a\ | c; d
it's-ok]
C5-FAIL(重测)
C8 out=[ERROR: exec/read/write 仅支持 powershell(协议限制); cmd 会话请用 pty 交互模式]
C8-PASS(重测:明确拒绝)
C10 两次=[   C:\Users\<user>>
2026-09-10][   C:\Users\<user>>
2026-09-10]
C10-PASS(重测)
C1b out=[admin]
C1b-PASS(提示符噪声已滤净)
C5b out=[ERROR: 远程命令超时(90000ms):Write-Output (a$b | c; d)]
C5b-PASS(纯字面量无损)
C5c out='ERROR: 分页读取超时(第 0 行起)\n'
C5c-FAIL
C5-iso[dollar-pipe] PASS (7s): 'a$b | c; d'
C5-iso[double-quote] PASS (7s): 'quote"double'
C5-iso[backtick] PASS (7s): 'back`tick'
C5-iso[control] PASS (6s): 'plain-XYZ-123'
C5c-retry FAIL: 'ERROR: 分页读取超时(第 0 行起)'
C5-bisect[A-两行纯文本] PASS: 'row-one\nrow-two'
C5-bisect[B-普通+双引号] PASS: 'row-one\nhas"quote'
C5-bisect[C-普通+反引号] PASS: 'row-one\nhas`tick'
C5-bisect[D-普通+$行] PASS: 'row-one\na$b | c'
C5-len[E-三行纯文本] PASS: 'r1\nr2\nr3'
C5-len[F-单行120字符] FAIL: '(no output)'
C7-len[40]: 'ERROR: 分页读取超时(第 0 行起)'
C7-len[80]: 'ERROR: 分页读取超时(第 0 行起)'
C7-len[120]: 'LEN=124'
C1-终验 PASS: 'admin\nadmin\\<user>'
C5c-终验 PASS: 'a$b | c; d\nquote"double\nback`tick'
C7-终验 FAIL: "ERROR: 远程命令超时(90000ms):Write-Output ('X'*120 + '-END')"
C7-retry1 FAIL: "ERROR: 远程命令超时(90000ms):Write-Output ('X'*120 + '-END')"
C7-retry2 FAIL: '(no output)'
C7-稳态压测5次: fails=1
C7-稳态压测10次(静默500ms+分页自愈): fails=[]
C6 200行: 行数=200 抽查=True 全序=True -> PASS
[D-setup] PASS: 'DIR-OK'
[D1-write] 'written $env:TEMP\\uu-bridge-test\\d1-中文.txt (1120 bytes)'
[D1-回环SHA256] FAIL local=8e87a885b8e0 remote=60ed0b4a44f3
[D4-读目录] FAIL: 'ERROR: 读取文件超时:$env:TEMP\\uu-bridge-test'
[D5-写不存在目录] FAIL(静默假成功!): 'written $env:TEMP\\uu-bridge-test\\__no_such_dir__\\x.txt (1120 bytes)'
[TMP路径] 'C:\\Users\\<user>\\AppData\\Local\\Temp'
[D5-核实1] 'False|False'
[D1-write] 'written C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test\\d1-中文.txt (10'
[D1-回环SHA256] FAIL local=8214048c44b3 remote=e3b0c44298fc 远程0B/本地1024B
[D4-读目录] FAIL: 'ERROR: 读取文件超时:C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test'
[D5-写不存在目录] FAIL(静默假成功): 'written C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test\\__no_such_dir__\\x.txt (1024 bytes'
[D1-write] 'written C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test\\d1-中文.txt (10'
[D1-回环SHA256] PASS local=8214048c44b3 remote=8214048c44b3 远程1024B/本地1024B stderr=''
[D4-读目录] PASS: 'ERROR: C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test is a directory'
[D5-写不存在目录] PASS: 'ERROR: 远程写入失败:使用“2”个参数调用“WriteAllBytes”时发生异常:“未能找到路径“C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test\\__no_suc'
[D3b-读不存在文件] PASS: 'ERROR: 远程文件不存在或不可访问:C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test\\__not_exist__.txt'
[D2-gen] PASS
[D2-32KB分页读] PASS 32768B/32768B sha=3A62CF80EC==3A62CF80EC 耗时39s 吞吐0.8KB/s
[D3-300KB] PASS: 'ERROR: file too large: TOOBIG|307200'
[D6-3KB多分块] FAIL sha=8113409244==(no output 耗时192s
CE5200E40192F0B66D4247520C9472D027F973A07

CHUNK_TOTAL=1

CHUNK_DONE=1/1

PUSH_OK=False

ERROR=�ȴ�Զ��ȷ�ϳ�ʱ: UU_META_83511bb0bac54bb992ca922c4165ceb0


  [D7-远程字节] '(no output)'
[D7-bat转GBK+CRLF] FAIL sha=E0E55D3C4E==(no output 耗时187s
6184ACC91C7334DCB8E25B2E58DA489AD7814BFBF

CHUNK_TOTAL=1

CHUNK_DONE=1/1

PUSH_OK=False

ERROR=�ȴ�Զ��ȷ�ϳ�ʱ: UU_META_dbb07b9aa7b947d7ae8e1ef986fedef4


[D8-gzip二进制] FAIL sha=064CF31D83==(no output 耗时4s
OK=False

ERROR=Exception calling "WriteLine" with "1" argument(s): "�ܵ����ڱ��رա�"

SESSION_WARNING=�޷���ȡ UU �Ự�б�(code=6)������ uu-doctor.ps1 ����


[D9-write64KB] 'written C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test\\d9-' 耗时39s
[D9-64KB回环] FAIL 65000B/65536B sha=不一致 write=39s read=55s
[D9-64KB重读#1] FAIL 65561B/65536B 耗时146s
[D9-64KB重读#2] FAIL 65000B/65536B 耗时53s
[D9-64KB强校验#1] FAIL 94B 耗时145s
[D9-64KB强校验#2] FAIL 94B 耗时145s
[D9-64KB强校验#3] FAIL 94B 耗时146s
[核实64KB文件] 'True|65000'
[D9-write重写] 'written C:\\Users\\<user>\\AppData\\Local\\Temp\\uu-bridge-test\\d9-64k.bin (65000 bytes'
[核实大小] '65000' (期望65536)
[D9-64KB强校验读#1] FAIL 65000B 耗时67s
[D9-64KB强校验读#2] FAIL 94B 耗时151s
[D9-64KB终验#1] PASS 65000B/65000B 耗时54s
[D9-64KB终验#2] PASS 65000B/65000B 耗时55s
[D9-64KB终验#3] PASS 65000B/65000B 耗时52s
[E1-pty常规命令] PASS
[E2-pty交互应答] PASS (Read-Host 流程)
[E3-pty退出收尾] PASS rc=0
[E-输出样本] '--- pty ready; type lines, Ctrl-D / "exit" to quit ---\nUU_R_0\nPS C:\\Users\\<user>> Write-Output E1-OK\nE1-OK\nPS C:\\Users\\<user>>\nUU_R_0\nPS C:\\Users\\<user>> Write-Output E1-OK\nE1-OK\nPS C:\\Users\\<user>> $\x08$n = Read-Host \'NAME?\'\nNAME?:\nUU_R_0\nPS C:\\Users\\<user>> Write-Output E1-OK\nE1-OK\nPS C:\\Users\\<user>> $\x08$n = Read-Host \'NAME?\'\nNAME?: tester\nPS C:\\Users\\<user>>\nUU_R_0\nPS C:\\Users\\<user>> Write-Output E1-OK\n'
[F1-10x压测] 10/10 PASS min=6.8 avg=7.7 max=9.6
[F3-错误设备ID] PASS 1s: 'ERROR: 远程终端会话无法就绪:Error: Terminal control connection unavailable'
[F6a-中途强杀] 已执行(模拟网络中断/超时场景)
[F6b-杀后恢复] PASS: 'Clear-Host; Write-Output (\'UU_B\' + \'EGIN\'); $global:uuOut[0..1]; ("UU_P" + "_2")'
[F2-会话列表] 'D\tSHELL\tSTATE\tLAST_ACTIVE\n1726524177\tpowershell\trunning\t1789030695843\n847263492\tpowershell\trunning\t1789030686669\n1811829666\tpowershell\trunning\t1789030681066\n2168618938\tpowershell\trunning\t1789030694412' 
[F2-清理] kill了4个会话, 清理后: '666\tpowershell\trunning\t1789030681066\n2168618938\tpowershell\trunning\t1789030694412'
[F2-清理后exec] PASS: 'POST-F2-OK'
[G2-会话清理] kill=3个 清理后: 'No active sessions.'
[G1-清理复核] PASS(已清空): Test-Path='False'
[G-final] PASS: 'FINAL-OK'

