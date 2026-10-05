---
title: EZ-CAM 2019, 一个画图软件居然因为打印机拒绝启动
published: 2026-10-05
description: 一次 EZ-CAM 2019 启动故障的排查案例。最初看起来像是权限或 Windows 兼容性问题，最终却发现真正的原因是一台已经从打印服务器移除、但仍被用户设置为默认打印机的旧网络打印机。
tags:
  - EZcam
  - Windows
  - Printer
  - Troubleshooting
category: Infrastructure
draft: false
lang: zh
---

# EZ-CAM 2019 启动即崩溃：原因竟是一台已退役的默认打印机

最近我们遇到了一个很奇怪的 **EZ-CAM Express 2019** 问题。

这个软件之前一直运行正常，但突然之间，用户再也无法启动它。双击快捷方式后没有任何窗口出现，也没有任何可见的报错信息。

一开始，我们以为这是权限问题，或者 Windows 兼容性导致的。

但真正的原因是一台**已经退役的网络打印机，仍然被设置成了用户的默认打印机**。

## 症状

受影响的软件是：

```text
EZ-CAM Express 2019
Version 26
ez-cam32.exe
````

具体表现包括：

- 双击 EZ-CAM 后没有任何反应。
- 没有任何错误提示。
- 使用另一个管理员账户启动时，看起来可以正常打开。
- Windows 10 和 Windows 11 上都出现了同样的问题。
- 其他 EZ-CAM 模块仍然可以正常启动。

Windows Event Viewer 显示，`ez-cam32.exe` 实际上已经成功启动，但随后立即发生了崩溃。

反复出现的异常信息是：

```
Exception code: 0xC0000005
Faulting module: ez-cam32.exe
Fault offset: 0x000825c6
```

每次崩溃都发生在可执行文件中的同一个位置。

## 初步排查

因为使用管理员账户启动时看起来可以正常运行，所以一开始我们把排查重点放在了权限上。

我们检查了：

- EZ-CAM 安装目录的 NTFS 权限
- 所有 EZ-CAM 子目录的写入权限
- `HKCU` 下与当前用户相关的 EZ-CAM 注册表配置
- Compatibility 设置
- Windows Exploit Protection
- 本地 Administrators 组成员身份

受影响用户对应用目录本身具有写权限，而且即使重置了 EZ-CAM 的用户注册表配置，问题仍然没有解决。

我们还测试过把受影响用户临时加入本地 Administrators 组。

EZ-CAM 依然会崩溃。

这说明，**管理员权限本身并不是决定因素**。

## 进一步排查

我们需要先确认这个进程到底是怎么退出的。

```powershell title="Powershell"
$p = Start-Process "C:\EZCAMW\EZCAMX26\ez-cam32.exe" -PassThru
$p.WaitForExit()
$p.ExitCode
'{0:X8}' -f ($p.ExitCode -band 0xffffffff)
```

程序崩溃后，再检查事件日志：

```powershell title="Powershell"
$since = (Get-Date).AddMinutes(-3)

Get-WinEvent -FilterHashtable @{
    LogName='Application'
    StartTime=$since
} -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProviderName -match 'Application Error|Windows Error Reporting|SideBySide|\.NET Runtime'
    -or $_.Message -match 'ez-cam|EZCAM'
} |
Select-Object TimeCreated,ProviderName,Id,Message |
Format-List
```

从 Event Log 可以看到，应用程序反复在同一个 offset 上崩溃：

```powershell title="Powershell"
Exception code : 0xc0000005
Fault offset   : 0x000825c6
Fault module   : ez-cam32.exe
```

## 关键线索：Windows 打印子系统

Windows Error Reporting 数据显示，EZ-CAM 在启动过程中会加载 Windows 打印子系统，其中包括：

```
WINSPOOL.DRV
```

同时还会加载正常的 GUI、MFC、OpenGL 以及 EZ-CAM 自身组件。

这让我们开始检查用户当前的默认打印机：

```powershell title="Powershell"
Get-CimInstance Win32_Printer |
Where-Object Default |
Select-Object Name,DriverName,PortName
```

结果指向了一台旧的网络打印机：

```powershell title="Powershell"
\\printserver\OLD-PRINTER
```

这台打印机实际上已经**退役，并且从打印服务器上删除了**，但用户的 Windows Profile 中仍然保留着旧的打印机连接，而且它依然被设置成默认打印机。

## 根本原因

EZ-CAM 2019 会在应用程序启动过程中初始化 Windows 打印环境。

当默认打印机指向一个已经不存在的网络打印队列时，程序没有正确处理这个失败状态。

EZ-CAM 没有忽略不可用的打印机并继续启动，而是直接发生了：

```powershell title="Powershell"
0xC0000005 - Access Violation
```

这也是为什么一开始看起来完全不像打印机问题：用户根本没有尝试打印任何东西。

问题发生的原因，仅仅是 EZ-CAM 在启动过程中主动查询了默认打印机。

## 修复方法

我们先临时把默认打印机改成：

```powershell title="Powershell"
Microsoft Print to PDF
```

使用：
```powershell title="Powershell"
rundll32 printui.dll,PrintUIEntry /y /n "Microsoft Print to PDF"
```

修改之后，EZ-CAM 立刻恢复正常启动。

随后可以删除残留的网络打印机连接：

```powershell title="Powershell"
Remove-Printer -Name "\\printserver\OLD-PRINTER"
```

重新设置一个有效的默认打印机后，EZ-CAM 可以继续正常启动，也不再需要任何管理员权限。

## 快速诊断

如果 EZ-CAM 2019 突然无法启动，而且没有任何可见的错误提示，在花大量时间检查权限或重装软件之前，可以先检查一下默认打印机。

查看当前默认打印机：

```powershell title="Powershell"
Get-CimInstance Win32_Printer |
Where-Object Default |
Select-Object Name,DriverName,PortName
```

临时切换到 Microsoft Print to PDF：

```powershell title="Powershell"
rundll32 printui.dll,PrintUIEntry /y /n "Microsoft Print to PDF"
```

然后重新尝试启动 EZ-CAM。

如果程序恢复正常，就应该继续检查之前的默认打印机连接是否已经失效、离线，或者对应的打印队列已经被删除。

## 总结

一些老版本的 Windows 应用程序会在启动阶段初始化打印机驱动和打印相关设置，即使用户根本没有执行任何打印操作。

在这个案例中，实际发生的是：

```
已退役的网络打印机
        ↓
仍然被设置为默认打印机
        ↓
EZ-CAM 启动时初始化打印环境
        ↓
打印队列已经不存在
        ↓
EZ-CAM 内部没有正确处理这个异常状态
        ↓
0xC0000005
        ↓
程序直接退出，没有任何可见报错
```

所以，如果 **EZ-CAM 2019 看起来像是必须使用管理员权限才能启动，或者突然之间完全打不开**，记得先检查一下用户的默认打印机。

