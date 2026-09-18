#Requires -Version 7.0
<#
.SYNOPSIS
  UU 远程通道只读体检：CLI 存在性、主程序通信、设备在线状态、终端会话列表。
.DESCRIPTION
  只读：不创建/杀死会话，不连接设备，不改动远程机任何状态。
  输出结构化 NAME=VALUE 行，便于 agent 或脚本直接判读。
  退出码约定（uuyc-cli）：0=成功 2=主程序未运行 3=无效命令 4=无数据 5=超时 6=终端失败。
.EXAMPLE
  pwsh -File uu-doctor.ps1
  pwsh -File uu-doctor.ps1 -DeviceId 123456789
#>
param(
  [string]$CliPath = "C:\Program Files\Netease\GameViewer\bin\uuyc-cli.exe",
  [string]$DeviceId = ""
)

function Invoke-Uu {
  param([string[]]$CmdArgs)
  $raw = & $CliPath @CmdArgs 2>&1 | Out-String
  $code = $LASTEXITCODE
  # 滤掉 ANSI 转义和连接日志行（"[" 开头）
  $clean = ($raw -replace "`e\[[0-9;]*[A-Za-z]", "") -split "`r?`n" |
    Where-Object { $_ -and $_ -notmatch "^\[" }
  return @{ Code = $code; Lines = @($clean) }
}

Write-Output "=== uu-doctor (read-only) ==="

if (-not (Test-Path $CliPath)) {
  Write-Output "CLI_FOUND=False"
  Write-Output "CLI_PATH=$CliPath"
  Write-Output "HINT=确认 UU GameViewer 安装路径，或用 -CliPath 指定"
  exit 1
}
Write-Output "CLI_FOUND=True"

$echo = Invoke-Uu @("echo", "uu-doctor")
Write-Output "MAIN_APP_OK=$($echo.Code -eq 0)"
if ($echo.Code -ne 0) {
  Write-Output "HINT=主程序未运行或 IPC 失败(退出码 $($echo.Code))，先打开 UU GameViewer 主程序"
  exit 2
}

$dev = Invoke-Uu @("device", "list")
Write-Output "DEVICE_LIST_OK=$($dev.Code -eq 0)"
Write-Output "--- device list ---"
$dev.Lines | ForEach-Object { Write-Output $_ }
Write-Output "HINT=从上面确认目标设备 isOnline；设备离线=远程机零改动，不得声称正在操作"

if ($DeviceId) {
  $ses = Invoke-Uu @("term", "--device-id", $DeviceId, "--list-sessions")
  Write-Output "SESSION_LIST_OK=$($ses.Code -eq 0)"
  Write-Output "--- sessions ---"
  $ses.Lines | ForEach-Object { Write-Output $_ }
  Write-Output "HINT= exited 会话也占服务端独占锁；只 kill 确认属于自己的会话，他人 running 会话不要动"
} else {
  Write-Output "SESSION_LIST_SKIPPED=True"
  Write-Output "HINT=传 -DeviceId <id> 可列出现有终端会话"
}
