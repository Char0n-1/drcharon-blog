---
title: 排查 Windows Server 重启后 UniFi Controller 无法启动的问题
published: 2026-09-29
description: 一次真实的 UniFi Network Controller 故障排查案例：Windows Server 重启后 Controller 无法访问，最终定位到 Windows Service 注册缺失以及 Java Runtime 版本不匹配。
tags:
  - Unifi
  - Uniquiti
  - Windows-Server
  - Java
  - Network
  - Troubleshooting
category: Infrastructure
draft: false
lang: zh
---

# 排查 Windows Server 重启后 UniFi Controller 无法启动的问题

在一次 Windows Server 重启之后，UniFi Network Controller 完全无法访问。

UniFi 设备本身仍然正常运行，但尝试打开管理 Portal 时，浏览器返回：

```text
ERR_CONNECTION_REFUSED
````

Controller 通常通过以下地址访问：

```
https://<controller-ip>:8443/
```

由于浏览器立即返回的是 connection refused，而不是 timeout，因此最初的判断是：服务器本身应该仍然可以访问，但 TCP `8443` 端口上没有任何程序正在监听。

事实证明这个判断是正确的——但根本原因并不只是某个应用程序停止运行这么简单。

---

## 环境

本次故障中的 Controller 运行环境如下：

- Windows Server 2016
- 传统 Windows 版 UniFi Network Controller
- 安装在 Administrator 用户 Profile 下
- 内置 MongoDB
- 基于 Java 的 UniFi 后端
- 管理界面使用 TCP `8443`

服务器近期在安装 Windows Update 后发生过重启。

本次 troubleshooting 的目标是：

**在不重新安装 UniFi，也不触碰现有配置数据库的情况下恢复现有 Controller。**

---

# 1. 确认 Controller 没有监听端口

第一步是检查 UniFi 常用端口。

```powershell title="PowerShell terminal"
$ports = 8443,8080,8843,8880,6789,27117

foreach ($port in $ports) {
    $result = Get-NetTCPConnection `
        -LocalPort $port `
        -State Listen `
        -ErrorAction SilentlyContinue

    if ($result) {
        Write-Host "Port $port : LISTENING"
    }
    else {
        Write-Host "Port $port : NOT LISTENING"
    }
}
```

结果如下：

```powershell title="PowerShell terminal"
Port 8443 : NOT LISTENING
Port 8080 : NOT LISTENING
Port 8843 : NOT LISTENING
Port 8880 : NOT LISTENING
Port 6789 : NOT LISTENING
Port 27117 : NOT LISTENING
```

随后直接测试本机 TCP `8443`：

```powershell title="PowerShell terminal"
Test-NetConnection 127.0.0.1 -Port 8443
```

结果：

```powershell title="PowerShell terminal"
PingSucceeded    : True
TcpTestSucceeded : False
```

这是一个很重要的区别。

服务器本身仍然在线，并且可以正常访问。因此最初并不像是 routing 或 firewall 问题。

实际情况只是：

**UniFi 管理端口上根本没有进程正在监听。**

# 2. 检查 UniFi、Java 和 MongoDB 进程

下一步，我检查是否有任何 UniFi 相关的后台进程正在运行。

```powershell title="PowerShell terminal"
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi|ubiquiti"
} |
Select-Object ProcessName,Id,Path
```

没有发现任何相关进程。

随后，我又检查了与 UniFi 相关的 Windows Service：

```powershell title="PowerShell terminal"
Get-CimInstance Win32_Service |
Where-Object {
    $_.Name -match "UniFi|Ubiquiti|Mongo" -or
    $_.DisplayName -match "UniFi|Ubiquiti|Mongo"
} |
Select-Object Name,DisplayName,State,StartMode,PathName
```

同样没有任何结果。

因此接下来的问题变成了：

> UniFi 到底安装在哪里？之前它又是通过什么方式启动的？

---

# 3. 查找现有的 UniFi 安装

由于系统中没有正在运行的 UniFi Service，也没有相关后台进程，下一步就是确认 Controller 是否仍然安装在这台服务器上，以及它的文件实际位于哪里。

我没有手动去 Installed Applications 里查找，而是使用 PowerShell 搜索：

- Uninstall Registry entries
- 常见的 UniFi 安装路径
- 用户 Profile 目录
- 基于 Java 的 Windows Service
- Scheduled Tasks
- Startup Commands

使用的脚本如下：

```powershell title="PowerShell terminal"
Write-Host "`n=== SERVER UPTIME ===" -ForegroundColor Cyan
Get-CimInstance Win32_OperatingSystem |
Select-Object LastBootUpTime

Write-Host "`n=== INSTALLED APPLICATIONS ===" -ForegroundColor Cyan
$paths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

Get-ItemProperty $paths -ErrorAction SilentlyContinue |
Where-Object {
    $_.DisplayName -match "UniFi|Ubiquiti|Mongo|Java"
} |
Select-Object DisplayName,DisplayVersion,InstallLocation,Publisher |
Format-Table -AutoSize


Write-Host "`n=== POSSIBLE UNIFI FOLDERS ===" -ForegroundColor Cyan

$folders = @(
    "C:\Program Files\Ubiquiti UniFi",
    "C:\Program Files (x86)\Ubiquiti UniFi",
    "C:\ProgramData\Ubiquiti UniFi",
    "C:\Ubiquiti UniFi"
)

foreach ($folder in $folders) {
    if (Test-Path $folder) {
        Write-Host "FOUND: $folder" -ForegroundColor Green
        Get-ChildItem $folder -Force |
        Select-Object Name,LastWriteTime
    }
}

Write-Host "`n=== USER PROFILE UNIFI FOLDERS ===" -ForegroundColor Cyan

Get-ChildItem C:\Users -Directory -ErrorAction SilentlyContinue |
ForEach-Object {

    $candidate = Join-Path $_.FullName "Ubiquiti UniFi"

    if (Test-Path $candidate) {
        Write-Host "FOUND: $candidate" -ForegroundColor Green
        Get-ChildItem $candidate -Force |
        Select-Object Name,LastWriteTime
    }

    $candidate2 = Join-Path $_.FullName "UniFi"

    if (Test-Path $candidate2) {
        Write-Host "FOUND: $candidate2" -ForegroundColor Green
        Get-ChildItem $candidate2 -Force |
        Select-Object Name,LastWriteTime
    }
}


Write-Host "`n=== JAVA-BASED SERVICES ===" -ForegroundColor Cyan

Get-CimInstance Win32_Service |
Where-Object {
    $_.PathName -match "java|mongo|ace.jar"
} |
Select-Object Name,DisplayName,State,StartMode,PathName |
Format-List


Write-Host "`n=== SCHEDULED TASKS ===" -ForegroundColor Cyan

Get-ScheduledTask -ErrorAction SilentlyContinue |
Where-Object {
    $_.TaskName -match "UniFi|Ubiquiti|Java" -or
    $_.TaskPath -match "UniFi|Ubiquiti"
} |
Select-Object TaskName,TaskPath,State |
Format-Table -AutoSize


Write-Host "`n=== STARTUP COMMANDS ===" -ForegroundColor Cyan

Get-CimInstance Win32_StartupCommand |
Where-Object {
    $_.Command -match "UniFi|Ubiquiti|java|ace.jar"
} |
Select-Object Name,Command,Location,User |
Format-List
```

搜索结果提供了几个非常有用的信息。

首先，服务器近期确实发生过重启：

```powershell title="PowerShell terminal"
LastBootUpTime
--------------
9/27/2026 11:25:47 PM
```

Uninstall Registry 中仍然存在：

```powershell title="PowerShell terminal"
Ubiquiti UniFi (remove only)
```

更重要的是，我们找到了实际的 Controller 安装目录：

```powershell title="PowerShell terminal"
C:\Users\Administrator\Ubiquiti UniFi
```

目录中包含：

```powershell title="PowerShell terminal"
bin
data
dl
jre
lib
logs
run
webapps
```

没有发现相关的 Scheduled Task、Startup Command 或基于 Java 的 Windows Service。

这大幅缩小了故障范围。

Controller 的程序文件仍然存在，其中包括应用运行环境以及数据目录，但服务器重启之后，目前没有任何有效的自动启动机制去启动 Controller。

因此排查重点从：

> “UniFi 还安装着吗？”

转变成了：

> “这个安装原来到底是怎么启动的？为什么现在这条启动路径不工作了？”

# 4. 检查 `start.bat`

Controller 安装目录中包含自己的启动脚本：

```powershell title="PowerShell terminal"
C:\Users\Administrator\Ubiquiti UniFi\bin\start.bat
```

其内容基本如下：

```powershell title="PowerShell terminal"
cd ..

java ^
 --add-opens java.base/java.lang=ALL-UNNAMED ^
 --add-opens java.base/java.time=ALL-UNNAMED ^
 --add-opens java.base/sun.security.util=ALL-UNNAMED ^
 --add-opens java.base/java.io=ALL-UNNAMED ^
 --add-opens java.rmi/sun.rmi.transport=ALL-UNNAMED ^
 -Xmx1024M ^
 -jar lib\ace.jar start
```

这个脚本提供了一个非常重要的信息：

UniFi Controller 可以直接通过：

```powershell title="PowerShell terminal"
lib\ace.jar
```

启动。

因此我尝试运行：

```powershell title="PowerShell terminal"
cd "C:\Users\Administrator\Ubiquiti UniFi\bin"
.\start.bat
```

但 Java 并没有正常启动 Controller，而是返回：

```powershell title="PowerShell terminal"
Error: LinkageError occurred while loading main class com.ubnt.ace.Launcher

java.lang.UnsupportedClassVersionError:

com/ubnt/ace/Launcher has been compiled by a more recent version
of the Java Runtime (class file version 69.0),

this version of the Java Runtime only recognizes class file
versions up to 55.0
```

这就是整个问题中的关键错误。

---

# 5. 理解 Java 报错

Java 的 Class File Version 与 Java Release 是对应的。

在本次环境中：

```
55.0 = Java 11
69.0 = Java 25
```

所以这个错误实际上是在告诉我们：

```
UniFi requires Java 25
but
start.bat is launching Java 11
```

也就是说：

**UniFi 需要 Java 25，但 `start.bat` 实际启动的是 Java 11。**

首先检查系统默认 Java：

```powershell title="PowerShell terminal"
java -version
```

结果：

```powershell title="PowerShell terminal"
openjdk version "11.0.20"
OpenJDK Runtime Environment Temurin-11.0.20+8
OpenJDK 64-Bit Server VM Temurin-11.0.20+8
```

但是 UniFi 安装目录本身也包含了一套 Java Runtime：

```
C:\Users\Administrator\Ubiquiti UniFi\jre
```

检查这个 Java 的版本：

```powershell title="PowerShell terminal"
& "C:\Users\Administrator\Ubiquiti UniFi\jre\bin\java.exe" -version
```

结果：

```powershell title="PowerShell terminal"
openjdk version "25" 2025-09-16 LTS
OpenJDK Runtime Environment Temurin-25+36
OpenJDK 64-Bit Server VM Temurin-25+36
```

到这里，启动失败的原因已经非常清楚了。

---

# 6. 为什么 `start.bat` 使用了错误的 Java

启动脚本中调用的只是：

```
java
```

而不是明确指定：

```
C:\Users\Administrator\Ubiquiti UniFi\jre\bin\java.exe
```

因此 Windows 会按照系统 `PATH` 中的顺序寻找 `java.exe`。

最终首先找到的是 Java 11。

与此同时，当前安装的 UniFi Application 已经升级到了使用 Java 25 编译的版本，但启动环境仍然指向 Java 11。

这就导致了版本不兼容。

# 7. 先临时恢复服务

到这里，启动失败的根本原因已经明确：

- UniFi Application 需要 Java 25
- 系统 `PATH` 中的 `java` 指向 Java 11
- UniFi 自带的 JRE 已经包含所需的 Java 25

但是此时最优先的事情并不是重新设计整个启动机制。

首先需要让 Controller 恢复上线，使日常网络管理能够继续进行。

Windows Service Registration、自动启动机制以及 Java Path 等问题，可以在之后安排 Maintenance Window 时再处理。

因此，我选择先使用一个临时恢复方案。

没有直接修改系统级 Java 配置，而是仅在当前 PowerShell Session 中，把 UniFi 自带的 JRE 临时放到 `PATH` 最前面：

```powershell title="PowerShell terminal"
$env:Path =
"C:\Users\Administrator\Ubiquiti UniFi\jre\bin;" +
$env:Path
```

随后再次确认当前 Shell 中调用的 `java` 已经是正确版本：

```powershell title="PowerShell terminal"
java -version
```

结果显示 Java 25。

在当前 Session 已经使用正确 Java Runtime 的情况下，再次运行原有的 UniFi Startup Script：

```powershell title="PowerShell terminal"
cd "C:\Users\Administrator\Ubiquiti UniFi\bin"

.\start.bat
```

这一次，Controller 成功完成初始化并启动。

这个处理方案从一开始就被视为一个 **Recovery Step，而不是最终修复方案**。

# 8. UniFi Controller 恢复

修正 Java Runtime 不匹配的问题之后，UniFi Network Controller 成功重新启动。

管理界面也重新可以通过以下地址访问：

```
https://<controller-ip>:8443/
```

原有的配置数据库被完整保留。

这次故障最终通过理解现有 Deployment，并让 Controller 使用正确的 Java Runtime 启动完成了恢复。

---

# Root Cause

本次排查实际上发现了两个不同的问题。

## Issue 1 — Windows Server 重启后 UniFi 没有运行

Windows Server 重启后：

```
No UniFi backend
No Java process
No MongoDB process
No listener on TCP 8443
```

同时，`UniFi.exe` 所依赖的 Windows Service Registration 也不存在。

## Issue 2 — 手动启动时使用了错误版本的 Java Runtime

UniFi 自带的 `start.bat` 调用的是：

```
java
```

而系统解析到的是：

```
Java 11
```

当前安装的 UniFi 版本则是使用：

```
Java 25
```

编译的。

因此最终产生：

```
UnsupportedClassVersionError
```

UniFi 自带的 JRE 已经包含 Java 25，因此临时让这个 JRE 在当前 Session 的 `PATH` 中拥有更高优先级之后，Controller 即可正常启动。

---

# Troubleshooting Summary

整个排查流程如下：

```
UniFi Portal unavailable
        |
        v
Check TCP 8443
        |
        v
8443 not listening
        |
        v
Check UniFi / Java / Mongo processes
        |
        v
Nothing running
        |
        v
Locate existing UniFi installation
        |
        v
Existing data and application files found
        |
        v
Inspect start.bat
        |
        v
Run start.bat
        |
        v
UnsupportedClassVersionError
        |
        v
System Java = 11
UniFi bundled Java = 25
        |
        v
Temporarily prioritize bundled JRE
        |
        v
Run start.bat again
        |
        v
UniFi Controller restored
```

---

# Useful Commands

## 检查端口是否正在监听

```powershell title="PowerShell terminal"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
Where-Object {
    $_.LocalPort -in 8443,8080,8843,8880,6789,27117
} |
Sort-Object LocalPort
```

## 测试端口

```powershell title="PowerShell terminal"
Test-NetConnection 127.0.0.1 -Port 8443
```

## 查找相关进程

```powershell title="PowerShell terminal"
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi|ubiquiti"
} |
Select-Object ProcessName,Id,Path
```

## 检查系统 Java 版本

```powershell title="PowerShell terminal"
java -version
```

## 检查 UniFi 自带的 Java 版本

```powershell title="PowerShell terminal"
& "C:\Users\Administrator\Ubiquiti UniFi\jre\bin\java.exe" -version
```

## 临时提高 UniFi 自带 JRE 的优先级

```powershell title="PowerShell terminal"
$env:Path =
"C:\Users\Administrator\Ubiquiti UniFi\jre\bin;" +
$env:Path
```

---

# 当前状态

Controller 已经恢复运行，但目前仍然存在一个重要限制。

它现在是通过一个交互式 PowerShell Session 运行的。

这意味着当前完成的是一次 **Recovery，而不是最终的永久修复**。

当前 Controller 进程运行期间，需要保持这个 PowerShell 窗口处于打开状态。

下一步需要恢复一个可靠的 unattended startup mechanism，让 UniFi Controller 能够在 Windows Server 重启后自动启动，并且明确使用正确的内置 Java Runtime。

这部分将会在另一篇文章中单独记录。