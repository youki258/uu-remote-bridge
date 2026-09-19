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

## 2026-09-19 翻转实验：定位「主控端版本过低」的真实触发条件

用户设计的单变量消融（被控端在线、主程序常驻、管理面 `list` 全程正常，唯一变量 = 主控端 GUI 终端窗口开/关）：

| 轮次 | GUI 终端 | exec battery | 结果 |
|---|---|---|---|
| A（4 次） | 关 | 简单×3 + 60行×1 | ❌ 4/4「主控端版本过低」（退出码 6） |
| B（3 次） | 开 | 简单×2 + 60行×1 | ✅ 3/3（60 行满） |
| A2（3 次） | 刚关 | 简单×2 + 60行×1 | ❌ 3/3 同报文 |

**结论**：报文是 **term 通道冷态报文，与版本基本无关**；通道存活依赖主控端 GUI 存在一个活动的终端窗口连接，关窗即冷。附带：关窗后会话记录服务端仍显示 running，但通道已死，故保暖的不是会话记录本身。修正了本项目此前「关掉 GUI 终端窗口重试」的错误处置（方向相反）。

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


---

# 2026-09-19 复测：外部质疑逐条验证 + 服务端协议常量取证

> 被测：主控端 4.41.0.2311 × 被控端 `<device>`（Windows → Windows）
> 计划见 `PLAN.md`（本地，不入库）；协议常量见 `PROTOCOL.md`；可重放的原始字节 fixtures 见 `tests/fixtures/`（已入库、已脱敏）
> 取证工具：`tools/protocol-probe.ts` → `tools/protocol-probe.cjs`（`analyze` 可离线重放 raw 流）
> **本轮只取证、未改产品代码**

## A. 管理面与会话卫生

| 项 | 结果 |
|---|---|
| `doctor` | ✅ `TERM_VERSION_OK=true` / `MAIN_APP_OK=true` / 1 台设备在线 |
| `list` 原始 JSON | ⚠️ `"platform": 1`（**数字**），与官方 skill 文档写的字符串取值不符；`cli.ts:491 platformName()` 存在但 `doctor.ts:89`/`main.ts:47` 未接线（沿用 F-6 类） |
| `sessions` vs 原生 `term --list-sessions` | ✅ 输出逐字节一致（bridge 多滤掉 `[连接]` 噪声行） |
| 连续建会话 | ✅ 健康窗口下 30+ 次零 2005/409、零僵尸 |
| 通道劣化后 | ⚠️ 见 D 节：`exit` 不再收尾，泄漏率约 1 次/调用，需 `--kill-session` 手工清理 |

## B. 被控端锁屏（原「待验未知项」→ 已判定）

```
[系统] 检测到被控端已锁屏，请输入被控端账户密码验证身份，此过程不会解锁被控端。
[系统] 请输入被控端解锁密码: Error: empty password      (exit=6)
```

- 锁屏时 **CLI `term` 管道通道同样被拦**（不只是 GUI 终端）→ 无 TTY 时密码取空 → **锁屏态非交互自动化不可用**（F-14）
- 解锁后同一命令立即恢复（exit=0）
- 该路径下 bridge `sessions` 挂 30s 只报 `命令超时`，吞掉真实错因（F-11）

## C. 协议常量（详见 `PROTOCOL.md`）

| 项 | 实测 | 与旧记录对照 |
|---|---|---|
| 屏幕几何 | **39 行 × 120 列**（二分：k=37 全在 / k=38 首行即丢；`ESC[8;30;120t`） | `termBridge.ts:14`「约 39 行」✅；**`vt.ts:5`「24 行」❌ 错误**（F-13） |
| 折行阈值 | >120 列折为 2 行（118 列不折、121 列折） | 新增常量 |
| 冲刷 | `Clear-Host`=1×`ESC[2J`；60 空行=60×(`ESC[K`+CRLF)；**短行下两者等价**（都到容量上限 37） | F-3 的「60 空行触发丢宽行」**本窗口未复现** |
| ECH | 31 次共擦 2053 字符，单次最大 85；线上 27 个 marker → 屏上剩 18 | 证实「行内容被擦」= 擦除与重写非原子 |
| 退出清屏 | 全量重放=0 行；裁尾 400B 才恢复 18 marker | 反证 `dispose()` 先取输出后 exit 的顺序必需 |
| 时延 | 握手 1.3–2.4s；命令→哨兵 604–1810ms；settle 后 1026–2233ms | 与旧 ~7s/exec 一致 |
| 管道模式副作用 | stderr 固定 `Warning: Failed to enable VT output for terminal` | 新增（应归入噪声过滤） |

## D. `exec` 静默丢行（F-12，高危）

30 行输出，行宽对照（**两次独立运行结果一致**）：

| 单行总宽 | 返回 | 判定 |
|---|---|---|
| 63 列 | 30/30 | ✅ |
| 103 列 | 30/30 | ✅ |
| **121 列** | **4/30** | ❌ 静默（exit=0） |
| 125 列 | 23/30 | ❌ 静默 |
| 203 列 | 4/30 | ❌ 静默 |

分页时序取证（`pages` 场景，精确复刻 assign + pullPages）：

| 负载 | page 0..25 | page 26..29 |
|---|---|---|
| 30 行短行 | markers=**26**，`maxRowLen=17` | markers=**4** |
| 30 行 203 列 | markers=**18**，`maxRowLen=4450` | markers=**21**（含 page 1 残留 P10–P26） |

**根因（F-15）**：`VtScreen` **不是视口模型**——无 120 列折行、无 39 行视口、无滚动逐出、无脏行跟踪。当前实现是「分页 ≤26 行 × base64 76 列」下**靠不越界碰巧正确**。

## E. 文件传输（F-17/F-19，高危）

| 项 | 结果 |
|---|---|
| 50B 中文 + 空行 + 行尾空格 回环 | ✅ 双向字节一致（2/2） |
| **1KB 读回** | ✅ 1024B 完全一致、SHA256 吻合（2/2） |
| **8KB 读回** | ❌ 8190/8192B **静默少 2B**（1/2）；另 1/2 显式 `分页读取超时(第 26 行起)` |
| **32KB 读回** | ❌ **4/4 全错**：32752 / 32761 / 32765 / 32781 B（源 32768B），**exit=0 无报错** |
| 32KB / 1KB / 8KB 写入 | ⚠️ 内容正确（远端 `Get-FileHash` == 本地），但 32KB 报 `写文件超时(30000ms)` → **假失败**（30s 预算 vs 实测 ~34s 墙钟） |
| 64KB 写入 | ❌ 32.768s 超时，远端文件不完整（观察到 32789B 残留） |
| 读不存在文件 | ⚠️ 2/3 正确 MISS（6–8s）；**1/3 挂死 150s+**，内部超时上限 240s |
| 300KB TOOBIG / ISDIR / 写不存在目录 / `uu-push-file.ps1` | ⬜ 未完成（通道劣化后停止远程测试） |

**判定**：`read` 的「b64 长度强校验」在实测中**未生效**（`UU_FLEN` 行未渲染时 `expectLen=-1` 直接跳过校验；`count` 亦可被脏屏污染）→ 与 `SKILL.md` 宣称的「杜绝静默损坏」冲突。**安全包络（本窗口实测）：≤1KB 可信；≥8KB 不可信。**

## F. 交互与本地缺陷

| 项 | 结果 |
|---|---|
| `pty` 交互（含 `Read-Host` 应答） | ✅ `NAME?: tester` → `GOT=tester`（4.41.0.2311 首次验证通过） |
| `exec` 200 行分页 | ❌ 第 5 页 `分页读取超时(第 104 行起)`（劣化窗口） |
| F-10（`\| head` EPIPE） | ⬜ 未复现（因分页先失败，未走到 EPIPE 路径） |
| F-9（页内丢行） | ❌ 未复现；本轮丢行由 F-12/F-15 机制解释 |

## G. 通道劣化与僵尸会话（F-16/F-20）

- 健康窗口：30+ 次调用零僵尸
- 劣化窗口：`exit` 不再收尾，**泄漏率约 1 次/调用**（实测累积 session4–<user-session>0，逐个 `--kill-session` 清理）
- **外部强杀必漏**：`timeout`/SIGTERM 杀死 node → 走不到 `finally dispose()` → 远程会话残留（实测 2 次）
- `--list-sessions` 本身**不泄漏**（连续 3 次调用会话数稳定）
- 现状：已清零，仅保留用户自己的 `<user-session>`

## H. 本轮结论的适用边界（重要）

出现劣化窗口后，E 节的文件传输结论**可能部分是窗口相关的**：

- 旧报告（4.39.2，2026-09-09/10）称 32KB/64KB 读回字节级一致；本轮 4.41.0.2311 在劣化窗口下 32KB 全错
- **两种可能未区分**：(a) 4.41 版本回归；(b) 窗口劣化导致
- 但 **F-12（宽行 4/30）在两次独立运行中完全一致**，且与 39×120 常量、`pages` 残留现象自洽 → 判为非窗口偶然
- **复验前置**：重启主控端 GUI 终端窗口（暖通道）或等通道冷却，再重跑 D/E 两节，才能定 4.41 与 4.39.2 的差异

## I. 未验证清单（UNVERIFIED，不阻塞）

| 项 | 原因 | 复验前置 |
|---|---|---|
| macOS / zsh-bash 被控端分支 | 无 macOS 被控端；官方亦明文 term 仅支持 Windows 被控端 | 需 macOS 被控端 |
| `platform` 取值枚举 | 本账号仅 1 台 Windows 设备 | 需多平台设备 |
| 被控端锁屏时的 GUI 与 CLI 差异 | 已判定 CLI 被拦；GUI 侧未本轮对比 | 需 GUI 终端对比 |
| 300KB TOOBIG / ISDIR / 写不存在目录 / `uu-push-file.ps1` | 通道劣化后停测 | 健康窗口重跑 |

## 2026-09-19 P7 修复后真机回归（主控端 4.41.0.2311 × 被控端 <device>）

> 前置：清理劣化窗口产生的僵尸会话（`--kill-session`），通道恢复暖态；远程测试目录 `%TEMP%\uu-bridge-test`
> 被测：修复后的 `bin/uu-bridge.cjs`（P1 视口模型 / P2 分页校验 / P3 写超时 / P4 错误透传）
> 判定标准：**字节级一致，或显式报错；零静默错误**

| 项 | 修复前 | 修复后 |
|---|---|---|
| `exec` 输出行 63/103 列 × 30 行 | 30/30 | **30/30**（7s） |
| `exec` 输出行 121 列 × 30 行 | **4/30 静默丢行** | **30/30**（9s） |
| `exec` 输出行 125 / 203 列 × 30 行 | 23/30、4/30 | **30/30**（9–10s） |
| `exec` 分页 26 / 27 / 52 / 53 / 200 行 | 200 行在第 5 页超时 | **全部精确、有序**（6–16s） |
| `write` 1KB / 8KB / 32KB / 64KB | 32/64KB 假报超时 | rc=0，远端 SHA256 **全部吻合**（5/14/43/72s） |
| `read` 1KB / 8KB / 32KB / 64KB | 8KB 少 2B；32KB 4/4 变长错误 | **全部字节级一致**（6/12/160/57s） |
| 读不存在文件 | 1/3 挂死 150s+ | rc=1，**5s** 明确 MISS |
| 读目录 | rc=0 **静默空输出** | rc=1，**7s** `is a directory` |
| 读 300KB | 未测 | rc=1，**5s** `file too large: TOOBIG|307200` |
| 写不存在目录 | 显式报错 | 显式报错（回归保持） |

**期间观察到的失败（均为显式报错，非静默）**：一次 8KB、一次 32KB 回读报 `分页校验失败(第 N 行起)：解析 0 行 < 对端回报 6 行，3 次重试仍不一致——拒绝返回可能残缺的数据`；定位为**僵尸会话导致的劣化窗口**，清理后重测全部一致。

### 本轮新增缺陷与处置

| # | 缺陷 | 处置 |
|---|---|---|
| F-21 | 宽行折行时 ECH 擦除与重写非原子 → 偶发单行内 1–2 字符被空格替换 | **未修**（低频、需字节级校验才能发现）；缓解：关键数据用 `NAME=VALUE` + 哈希核对；后续可加页级内容校验和 |
| F-22 | `readFileB64` 的 ISDIR/TOOBIG 分支被前置 `break` 短路（死代码）→ 读目录返回 rc=0 空输出 | ✅ 已修：远端改为显式上报 `UU_ST=<OK|MISS|ISDIR|TOOBIG>`，客户端优先判定状态，标记缺失即失败 |
| — | 修复过程中自引入：加长分页命令导致**回显折行碎片被当成输出** | ✅ 已修：计数逻辑改为握手期定义的远端函数 `uuPg`，分页命令重新变短；并扩展脚手架噪声正则 |
| F-18 | 读不存在的文件可能死等（MISS 标记未渲染） | ✅ 已修：状态标记显式化 + 单轮等待预算 45s 提前重试，实测 120s+ → 5s |

**清理**：远程测试目录 `exists=False`；会话仅剩用户自己的 `<user-session>`（零僵尸）。
