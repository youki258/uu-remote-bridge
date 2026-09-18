#Requires -Version 7.0
<#
.SYNOPSIS
  通过一个 UU 远程终端会话，把小文件可靠地推送到远程 Windows 机。
.DESCRIPTION
  文件先 gzip + base64，再以幂等分块写入远端临时文件；远端解码到同目录临时文件，
  SHA256 与大小一致后才替换目标。整个传输只打开一个终端进程，末尾主动 exit。
  .cmd/.bat 默认按 UTF-8 源文件读取并转换为 GBK + CRLF。
.EXAMPLE
  pwsh -File uu-push-file.ps1 -DeviceId 123456789 -LocalPath .\fix.ps1 -RemotePath 'D:\Tools\fix.ps1'
#>
param(
  [Parameter(Mandatory)][string]$DeviceId,
  [Parameter(Mandatory)][string]$LocalPath,
  [Parameter(Mandatory)][string]$RemotePath,
  [string]$CliPath = "C:\Program Files\Netease\GameViewer\bin\uuyc-cli.exe",
  [ValidateRange(128, 2000)][int]$ChunkSize = 800,
  [ValidateRange(10, 300)][int]$CommandTimeoutSeconds = 90,
  [switch]$KeepRemoteTemp,
  [switch]$NoBatchConversion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $CliPath -PathType Leaf)) { throw "CLI 不存在: $CliPath" }
if (-not (Test-Path -LiteralPath $LocalPath -PathType Leaf)) { throw "本地文件不存在: $LocalPath" }

function ConvertTo-PsLiteral([string]$Value) { "'" + $Value.Replace("'", "''") + "'" }

$bytes = [IO.File]::ReadAllBytes($LocalPath)
$extension = [IO.Path]::GetExtension($RemotePath)
if (-not $NoBatchConversion -and $extension -in '.cmd', '.bat') {
  [Text.Encoding]::RegisterProvider([Text.CodePagesEncodingProvider]::Instance)
  $utf8 = [Text.UTF8Encoding]::new($true, $true)
  $text = $utf8.GetString($bytes).TrimStart([char]0xFEFF)
  $text = ($text -replace "`r`n", "`n" -replace "`r", "`n") -replace "`n", "`r`n"
  $bytes = [Text.Encoding]::GetEncoding(936).GetBytes($text)
  Write-Output "BATCH_CONVERTED=GBK_CRLF"
}

$localHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes))
$compressed = [IO.MemoryStream]::new()
$gzip = [IO.Compression.GzipStream]::new($compressed, [IO.Compression.CompressionMode]::Compress, $true)
$gzip.Write($bytes, 0, $bytes.Length)
$gzip.Dispose()
$b64 = [Convert]::ToBase64String($compressed.ToArray())
$compressed.Dispose()
$total = [int][Math]::Ceiling($b64.Length / $ChunkSize)

$token = [Guid]::NewGuid().ToString('N')
$prefix = "$RemotePath.uupush.$token"
$stagePath = "$prefix.stage"
$backupPath = "$prefix.backup"
$quotedPrefix = ConvertTo-PsLiteral $prefix
$quotedStage = ConvertTo-PsLiteral $stagePath
$quotedBackup = ConvertTo-PsLiteral $backupPath
$quotedRemote = ConvertTo-PsLiteral $RemotePath
$term = $null
$stderrTask = $null
$script:pendingRead = $null
$exitCode = 0
$sessionsBefore = @()

function Get-UuSessionIds {
  $raw = & $CliPath term --device-id $DeviceId --list-sessions 2>&1 | Out-String
  if ($LASTEXITCODE -eq 4) { return }
  if ($LASTEXITCODE -ne 0) { throw "无法读取 UU 会话列表(code=$LASTEXITCODE)" }
  @([regex]::Matches(($raw -replace "`e\[[0-9;]*[A-Za-z]", ''), '(?m)^\s*(\d+)\s+\S+\s+\S+\s+\d+\s*$') | ForEach-Object { $_.Groups[1].Value })
}

function Wait-TermMarker {
  param([string]$Marker, [int]$TimeoutSeconds = $CommandTimeoutSeconds)
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($term.HasExited) {
      $stderr = if ($stderrTask) { $stderrTask.GetAwaiter().GetResult() } else { '' }
      throw "UU 终端提前退出(code=$($term.ExitCode)): $stderr"
    }
    if (-not $script:pendingRead) { $script:pendingRead = $term.StandardOutput.ReadLineAsync() }
    if ($script:pendingRead.Wait(50)) {
      $line = $script:pendingRead.Result
      $script:pendingRead = $null
      if ($null -eq $line) { continue }
      $clean = ($line -replace "`e\[[0-9;]*[A-Za-z]", '').Trim()
      if ($clean -match ('^' + [regex]::Escape("${Marker}_ERROR") + '\|(.*)$')) { throw "远端命令失败: $($Matches[1])" }
      if ($clean -eq $Marker -or $clean -match ('^' + [regex]::Escape($Marker) + '\|')) { return $clean }
    }
  }
  throw "等待远端确认超时: $Marker"
}

function Invoke-TermLine {
  param([string]$Command, [string]$Marker, [int]$Retries = 1, [switch]$CommandEmitsMarker)
  for ($attempt = 0; $attempt -le $Retries; $attempt++) {
    $body = if ($CommandEmitsMarker) { $Command } else { "$Command;Write-Output '$Marker'" }
    $line = "`$ErrorActionPreference='Stop';try{$body}catch{Write-Output ('${Marker}_ERROR|'+`$_.Exception.Message)}"
    $term.StandardInput.WriteLine($line)
    $term.StandardInput.Flush()
    try { return Wait-TermMarker $Marker } catch {
      if ($attempt -eq $Retries) { throw }
    }
  }
}

function Remove-RemoteTemps {
  $cleanup = "for(`$i=0;`$i -lt $total;`$i++){`$p=$quotedPrefix+('.{0:D6}.part' -f `$i);if(Test-Path -LiteralPath `$p){Remove-Item -LiteralPath `$p -Force}};foreach(`$p in @($quotedStage,$quotedBackup)){if(Test-Path -LiteralPath `$p){Remove-Item -LiteralPath `$p -Force}}"
  Invoke-TermLine $cleanup "UU_CLEAN_$token" 0 | Out-Null
}

try {
  $sessionsBefore = Get-UuSessionIds
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $CliPath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($arg in @('term', '--device-id', $DeviceId, '--new-session')) { [void]$startInfo.ArgumentList.Add($arg) }
  $term = [Diagnostics.Process]::new()
  $term.StartInfo = $startInfo
  if (-not $term.Start()) { throw '无法启动 UU 终端进程' }
  $stderrTask = $term.StandardError.ReadToEndAsync()

  Write-Output "LOCAL_SIZE=$($bytes.Length)"
  Write-Output "LOCAL_SHA256=$localHash"
  Write-Output "CHUNK_TOTAL=$total"

  for ($i = 0; $i -lt $total; $i++) {
    $chunk = $b64.Substring($i * $ChunkSize, [Math]::Min($ChunkSize, $b64.Length - $i * $ChunkSize))
    $part = ConvertTo-PsLiteral ("$prefix.{0:D6}.part" -f $i)
    $command = "[IO.File]::WriteAllText($part,'$chunk',[Text.Encoding]::ASCII)"
    Invoke-TermLine $command "UU_PART_${token}_$i" | Out-Null
    if (($i + 1) % 10 -eq 0 -or $i -eq $total - 1) { Write-Output "CHUNK_DONE=$($i+1)/$total" }
  }

  $decode = "`$s=[Text.StringBuilder]::new();for(`$i=0;`$i -lt $total;`$i++){`$p=$quotedPrefix+('.{0:D6}.part' -f `$i);[void]`$s.Append([IO.File]::ReadAllText(`$p))};`$b=[Convert]::FromBase64String(`$s.ToString());`$raw=[IO.MemoryStream]::new(`$b);`$gz=[IO.Compression.GzipStream]::new(`$raw,[IO.Compression.CompressionMode]::Decompress);`$out=[IO.MemoryStream]::new();`$gz.CopyTo(`$out);`$gz.Dispose();`$raw.Dispose();[IO.File]::WriteAllBytes($quotedStage,`$out.ToArray());`$out.Dispose();`$sha=[Security.Cryptography.SHA256]::Create();`$stream=[IO.File]::OpenRead($quotedStage);try{`$h=[BitConverter]::ToString(`$sha.ComputeHash(`$stream)).Replace('-','')}finally{`$stream.Dispose();`$sha.Dispose()};`$n=(Get-Item -LiteralPath $quotedStage).Length;Write-Output ('UU_META_$token|'+`$h+'|'+`$n)"
  $meta = Invoke-TermLine $decode "UU_META_$token" 0 -CommandEmitsMarker
  $match = [regex]::Match($meta, '^UU_META_[^|]+\|([0-9A-Fa-f]{64})\|(\d+)$')
  if (-not $match.Success) { throw "无法解析远端校验结果: $meta" }
  $remoteHash = $match.Groups[1].Value.ToUpperInvariant()
  $remoteSize = [long]$match.Groups[2].Value
  Write-Output "REMOTE_SHA256=$remoteHash"
  Write-Output "REMOTE_SIZE=$remoteSize"
  if ($remoteHash -ne $localHash -or $remoteSize -ne $bytes.Length) { throw '双端哈希或大小不一致，目标文件未替换' }

  $commit = "if(Test-Path -LiteralPath $quotedRemote){[IO.File]::Replace($quotedStage,$quotedRemote,$quotedBackup,`$true);Remove-Item -LiteralPath $quotedBackup -Force}else{[IO.File]::Move($quotedStage,$quotedRemote)}"
  Invoke-TermLine $commit "UU_COMMIT_$token" 0 | Out-Null
  if (-not $KeepRemoteTemp) { Remove-RemoteTemps }
  Write-Output 'PUSH_OK=True'
} catch {
  Write-Output 'PUSH_OK=False'
  Write-Output "ERROR=$($_.Exception.Message)"
  if ($term -and -not $term.HasExited -and -not $KeepRemoteTemp) {
    try { Remove-RemoteTemps } catch { Write-Output "CLEANUP_WARNING=$($_.Exception.Message)" }
  }
  $exitCode = 6
} finally {
  if ($term -and -not $term.HasExited) {
    try { $term.StandardInput.WriteLine('exit'); $term.StandardInput.Close() } catch {}
    if (-not $term.WaitForExit(30000)) {
      $term.Kill($true)
      Write-Output 'SESSION_WARNING=本地 CLI 未正常退出；运行 uu-doctor.ps1 检查并只清理本次残留会话'
    }
  }
  if ($term) { $term.Dispose() }
  try {
    $sessionsAfter = Get-UuSessionIds
    $newSessions = @($sessionsAfter | Where-Object { $_ -notin $sessionsBefore })
    if ($newSessions.Count -eq 1) {
      & $CliPath term --device-id $DeviceId --kill-session $newSessions[0] | Out-Null
      $remaining = if ($LASTEXITCODE -eq 0) { @(Get-UuSessionIds) } else { @($newSessions[0]) }
      if ($newSessions[0] -notin $remaining) { Write-Output "SESSION_KILLED=$($newSessions[0])" }
      else { Write-Output "SESSION_WARNING=本次会话 $($newSessions[0]) 清理后仍存在；运行 uu-doctor.ps1 复核" }
    } elseif ($newSessions.Count -gt 1) {
      Write-Output "SESSION_WARNING=传输期间出现 $($newSessions.Count) 个新会话，无法安全判定归属；未自动清理"
    }
  } catch {
    Write-Output "SESSION_WARNING=$($_.Exception.Message)；运行 uu-doctor.ps1 复核"
  }
}

exit $exitCode
