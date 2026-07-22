---
title: Windows Server 域环境中 DC 时间同步异常排障记录
published: 2026-07-10
description: 记录一次 Active Directory 域环境中 Windows Time Service 配置异常导致 Domain Controller 无法同步 PDC 时间源的完整排障过程。
tags:
  - NTP
  - W32Time
  - Troubleshooting
  - Active-Directory
  - Windows-Server
category: Infrastructure
lang: zh
draft: false
---
# 前言

在 Active Directory 中，时间同步几乎是所有身份认证的基础。

Kerberos、AD Replication、Certificate、Group Policy……几乎所有组件都依赖准确的时间。

微软推荐的域时间架构并不复杂：

```
Internet NTP
     │
     ▼
PDC Emulator
     │
     ▼
Other Domain Controllers
     │
     ▼
Domain Members
```

然而，我们的环境中却出现了一个比较奇怪的问题：

- PDC Emulator 已经配置公网 NTP
    
- Domain Controller 之间可以正常通信
    
- DNS 正常
    
- Active Directory 正常
    
- Secure Channel 正常
    

但是部分 Domain Controller 却一直使用：

```
Local CMOS Clock
```

最终确认，问题并不在公网 NTP 服务、DNS、基础网络通信或 Active Directory 本身，而是集中在异常 DC 本机的 Windows Time Service 配置或服务状态。

本文记录完整的排障过程，以及这次问题中最值得保留的判断思路。

---

# Active Directory 域环境中的 NTP 基础知识

在开始排查之前，需要先理解 Windows 域环境中的时间同步机制。

在普通工作组环境中，每台 Windows 设备可以直接向指定的公网 NTP Server 同步时间。但在 Active Directory 域环境中，Windows 默认依赖 **Windows Time Service 的域层级同步机制**。

Windows Time Service 的服务名称是：

```
W32Time
```

它负责维护 Windows 系统时间，并为 Kerberos、Active Directory、证书验证和其他依赖时间的服务提供基础。

## 为什么域环境对时间敏感

Active Directory 并不要求所有设备时间完全一致，但设备之间的偏差必须处于允许范围内。

其中最典型的是 Kerberos。Kerberos 使用带有时间戳的 Ticket 来防止重放攻击。如果客户端、服务器和 Domain Controller 之间存在较大的时间偏差，可能出现：

- 用户无法登录域账户
    
- Kerberos 身份验证失败
    
- 访问共享文件夹时反复要求输入密码
    
- Group Policy 无法正常应用
    
- 域复制或 Secure Channel 出现异常
    
- 证书被判断为尚未生效或已经过期
    
- 日志时间线无法准确对应
    

因此，域环境中的时间同步不只是让任务栏上的时钟准确，它本身就是身份认证体系的一部分。

## 域时间同步层级

在单林、单域环境中，标准的时间同步链通常如下：

```
Public NTP Server
        │
        ▼
Forest Root Domain PDC Emulator
        │
        ▼
Other Domain Controllers
        │
        ▼
Domain Member Servers and Workstations
```

森林根域中的 **PDC Emulator** 位于整个域时间层级的顶部。

它应该从可靠的外部时间源获取时间，例如：

- 企业内部 GPS Clock
    
- 核心网络设备提供的时间源
    
- 公网 NTP 服务
    

其他域设备则通过 Active Directory 的域层级逐级同步。

## PDC Emulator 的作用

Active Directory 中有五个 FSMO Roles。PDC Emulator 除了承担密码更新、账户锁定和兼容性相关功能外，还承担域时间层级中的核心角色。

确认当前 PDC Emulator：

```
netdom query fsmo
```

也可以使用 Active Directory PowerShell Module：

```
Get-ADDomain | Select-Object PDCEmulator
```

只有当前 PDC Emulator 应该被明确配置为外部可靠时间源。

例如：

```
w32tm /config `
    /manualpeerlist:"time.cloudflare.com,0x8 time.google.com,0x8" `
    /syncfromflags:manual `
    /reliable:yes `
    /update
```

参数含义：

- `/manualpeerlist`：指定外部 NTP Peer
    
- `/syncfromflags:manual`：使用手动配置的时间源
    
- `/reliable:yes`：将本机标记为域内可靠时间源
    
- `/update`：通知 Windows Time Service 重新读取配置
    

配置完成后，可以重启服务并请求同步：

```
Restart-Service w32time
w32tm /resync /force
```

## `NT5DS` 和 `NTP` 的区别

使用以下命令查看当前时间同步模式：

```
w32tm /query /configuration
```

重点关注：

```
Type
```

### `Type: NTP`

表示设备使用手动指定的 NTP Peer。

这种模式通常用于：

- PDC Emulator
    
- 非域设备
    
- 特殊隔离系统
    
- 无法使用 AD 域层级的设备
    

### `Type: NT5DS`

表示设备按照 Active Directory 域层级寻找时间源。

这种模式通常用于：

- 非 PDC Domain Controller
    
- Domain Member Server
    
- Domain-joined Workstation
    

非 PDC 服务器一般不应该直接指定公网 NTP，而应该保持：

```
Type: NT5DS
```

## 成员服务器不一定直接同步 PDC

使用 `NT5DS` 并不表示每台域成员都会直接连接 PDC Emulator。

一台成员服务器可能显示：

```
Source: DC01.example.local
```

而不是：

```
Source: PDC01.example.local
```

这并不一定是异常。

只要 DC01 本身最终从 PDC Emulator 获取正确时间，下面的同步链就是有效的：

```
Public NTP
    │
    ▼
PDC Emulator
    │
    ▼
DC01
    │
    ▼
Member Server
```

因此，验证时间同步时，不能只看一台服务器是否直接指向 PDC，还要确认整个时间链最终能够追溯到 PDC Emulator。

## 常用检查命令

查看当前时间源：

```
w32tm /query /source
```

查看详细同步状态：

```
w32tm /query /status
```

查看完整配置：

```
w32tm /query /configuration
```

查看手动配置的 Peer：

```
w32tm /query /peers
```

检查所有 Domain Controller 的时间状态：

```
w32tm /monitor
```

测试与指定时间源之间的偏差：

```
w32tm /stripchart /computer:PDC01.example.local /samples:5 /dataonly
```

查看最近的 Windows Time Service 事件：

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 20 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

---

# 本次排障环境

本文中的服务器名称、域名和 IP 地址均已匿名化。

本次排障环境为一个已经运行多年的单林、单域 Active Directory 环境，共有四台 Domain Controller：

|示例名称|角色|预期时间源|
|---|---|---|
|PDC01|PDC Emulator，持有 FSMO Roles|外部公网 NTP|
|DC01|普通 Domain Controller|Domain Hierarchy|
|DC02|普通 Domain Controller|Domain Hierarchy|
|DC03|普通 Domain Controller|Domain Hierarchy|

域成员包括多台 Windows Member Server 和 Workstation。

预期的时间同步架构为：

```
External NTP
      │
      ▼
PDC01 — PDC Emulator
      │
      ▼
DC01 / DC02 / DC03
      │
      ▼
Member Servers and Workstations
```

其中：

- PDC01 使用 `Type: NTP`
    
- PDC01 是域内唯一明确配置的可靠外部时间源
    
- 其他 DC 使用 `Type: NT5DS`
    
- Member Server 和 Workstation 使用 `Type: NT5DS`
    
- 域成员不一定直接同步 PDC，也可能同步其他健康 DC
    

---

# 故障现象

首先在异常 DC 上查看当前时间来源：

```
w32tm /query /source
```

输出：

```
Local CMOS Clock
```

继续查看状态：

```
w32tm /query /status
```

输出中的关键内容：

```
Stratum: 1
ReferenceId: LOCL
Source: Local CMOS Clock
```

这说明当前 DC 没有使用域内上游时间源，而是直接使用本机硬件时钟。

对于非 PDC Domain Controller，这显然不是预期状态。

---

# 第一步：确认 PDC Emulator

首先确认整个域的 FSMO Roles：

```
netdom query fsmo
```

输出显示所有 FSMO Roles 均位于：

```
PDC01.example.local
```

其中 PDC Role 也正确指向 PDC01。

继续使用 PDC Locator 明确查找 PDC Emulator：

```
nltest /dsgetdc:example.local /PDC
```

返回类似：

```
DC: \\PDC01.example.local
Flags: PDC GC DS LDAP KDC TIMESERV GTIMESERV
```

这说明 Active Directory 能够正确识别当前 PDC Emulator。

---

# 第二步：验证 PDC 的外部时间源

随后在 PDC01 上检查当前时间源：

```
w32tm /query /source
```

输出显示已配置的公网时间源：

```
time.cloudflare.com,time.google.com
```

继续查看状态：

```
w32tm /query /status
```

关键结果类似：

```
Leap Indicator: 0 (no warning)
Stratum: 4
Source: time.cloudflare.com,time.google.com
Last Successful Sync Time: <timestamp>
```

再查看完整配置：

```
w32tm /query /configuration
```

关键项为：

```
Type: NTP
AnnounceFlags: 5
NtpServer: time.cloudflare.com,time.google.com
```

这些结果说明：

- PDC Emulator 已经能够同步外部 NTP
    
- PDC 的 Windows Time Service 正常运行
    
- 外部 NTP 不是本次故障的主要问题
    

---

# 第三步：检查异常 DC 的实际配置

回到异常的 DC01，查看完整配置：

```
w32tm /query /configuration
```

关键输出：

```
Type: NT5DS
```

这表示 DC01 已经配置为通过 Active Directory 域层级发现时间源。

作为非 PDC Domain Controller，它应该通过域层级找到合适的上游时间源。在当前单域环境中，其时间链最终应能够追溯到 PDC Emulator。

但是再次查询：

```
w32tm /query /source
```

仍然显示：

```
Local CMOS Clock
```

这里出现了第一个明显矛盾：

- 配置声明它应该使用 `NT5DS`
    
- 实际状态却使用 `Local CMOS Clock`
    

因此，不能只看到 `Type: NT5DS` 就认为配置正常，还必须结合 `source` 和 `status` 判断实际运行状态。

---

# 第四步：使用 `w32tm /monitor` 查看整个域

为了确认问题是否只发生在 DC01，执行：

```
w32tm /monitor
```

结果显示了多个值得注意的现象：

```
DC01
    RefID: LOCL
    Stratum: 1
    Offset: approximately -61 seconds

PDC01
    RefID: external NTP source
    Stratum: 4

DC02
    RefID: another external NTP source

DC03
    NTP query timeout
```

这说明环境中可能不只有一个时间配置问题：

- DC01 已经退回 `Local CMOS Clock`
    
- DC02 可能仍保留直接同步公网 NTP 的历史配置
    
- DC03 没有响应 NTP 查询
    
- 只有 PDC01 的状态符合预期
    

因此，本次故障虽然最先在 DC01 上被发现，但也暴露出整个域的 Windows Time 配置可能存在历史遗留和不一致。

---

# 第五步：检查 Active Directory 基础状态

由于 `NT5DS` 依赖 Active Directory 发现 Domain Peer，下一步需要确认 DC01 是否能够正确访问域、定位 PDC 并保持正常的 Secure Channel。

## 检查 Secure Channel

```
Test-ComputerSecureChannel -Verbose
```

输出：

```
True
```

继续验证：

```
nltest /sc_verify:example.local
```

返回：

```
NERR_Success
```

说明机器账户和 Secure Channel 正常。

## 明确定位 PDC Emulator

```
nltest /dsgetdc:example.local /PDC
```

返回：

```
DC: \\PDC01.example.local
```

说明 PDC Locator 正常。

## 列出所有 Domain Controller

```
nltest /dclist:example.local
```

列表中能够看到所有 DC，并且 PDC01 被正确标记为 PDC。

## 再次确认 FSMO Roles

```
netdom query fsmo
```

输出仍然正确指向 PDC01。

## 检查 DNS 和基础网络

```
nslookup PDC01
```

名称能够正确解析。

```
ping PDC01
```

基础网络连通正常。

至此可以确认：

- Secure Channel 正常
    
- DC Locator 正常
    
- PDC Locator 正常
    
- FSMO Role 正常
    
- DNS 正常
    
- 基础网络通信正常
    

问题仍然存在。

---

# 第六步：查看 Windows Time Service 日志

随后检查 System Log 中的 Windows Time Service 事件：

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 20 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

发现 Event ID 129：

```
NtpClient was unable to set a domain peer to use as a time source because of discovery error.

The error was:

The entry is not found.
```

这是整个排障过程中最重要的一条日志。

它说明故障不只是“已经选中了时间源，但没有收到时间数据”。

更准确地说，Windows Time Service 在设置 Domain Peer 的发现阶段就已经失败了。

换句话说：

- 不是已经选择 PDC 后发生 NTP 数据包丢失
    
- 而是 W32Time 没有正确建立应该使用的 Domain Peer
    

这个区别直接改变了后续排查方向。

---

# 第七步：分析本机 W32Time 配置

再次查看：

```
w32tm /query /configuration
```

发现以下组合：

```
Type: NT5DS
AnnounceFlags: 5
```

`Type: NT5DS` 表示服务器应通过 Active Directory 域层级发现时间源。

而 `AnnounceFlags: 5` 通常用于让服务器将自己声明为可靠时间源。

需要注意：

一台 Domain Controller 同时作为时间客户端和时间服务器，本身并不冲突。DC 可以从上游同步时间，同时为下游域成员提供时间。

真正值得注意的是：

- DC01 并不是当前 PDC Emulator
    
- 它却被标记为可靠时间源
    
- 它自身又只使用 `Local CMOS Clock`
    
- Windows Time Service 同时报告 Domain Peer Discovery 失败
    

这表明 DC01 的 W32Time 本地配置或服务状态可能保留了过去的手动配置、角色迁移遗留状态，或其他不一致配置。

仅凭 `AnnounceFlags: 5` 不能证明它就是 Event ID 129 的唯一直接原因，但结合当前所有现象，可以合理地把故障范围集中到 DC01 本机的 Windows Time Service。

此时继续反复执行：

```
w32tm /resync
```

意义有限，因为服务甚至没有正确建立 Domain Peer。

---

# 第八步：重新注册 Windows Time Service

最终决定不再继续叠加新的注册表或 NTP 配置，而是将 Windows Time Service 恢复到较干净的默认状态。

停止服务：

```
net stop w32time
```

注销 Windows Time Service：

```
w32tm /unregister
```

重新注册：

```
w32tm /register
```

重新启动服务：

```
net start w32time
```

随后明确恢复为非 PDC DC 应有的域层级模式：

```
w32tm /config /syncfromflags:domhier /reliable:no /update
```

然后重新同步并触发重新发现：

```
w32tm /resync /rediscover
```

需要注意，下面这个命令并不存在：

```
w32tm /rediscover
```

`/rediscover` 应该作为 `/resync` 的参数使用。

---

# 第九步：验证修复结果

修复完成后再次查询：

```
w32tm /query /source
```

输出立即变为：

```
PDC01.example.local
```

这说明 Windows Time Service 已经重新发现了正确的域时间源。

继续检查：

```
w32tm /query /status
```

应重点确认：

- `Source` 指向健康的域时间源
    
- `Last Successful Sync Time` 已更新
    
- `ReferenceId` 不再是 `LOCL`
    
- `Stratum` 不再是本地参考时钟的 Stratum 1
    

再检查完整配置：

```
w32tm /query /configuration
```

确认：

```
Type: NT5DS
```

并且该非 PDC DC 不再被配置为可靠根时间源。

最后再次检查事件日志：

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 10 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

确认修复之后没有持续产生新的 Event ID 129。

---

# 第十步：为什么部分成员服务器仍然同步 DC01

修复 DC01 后，检查部分 Member Server 时发现：

```
w32tm /query /source
```

返回：

```
DC01.example.local
```

一开始这很容易让人怀疑：是不是之前有 Group Policy 强制把服务器指向了 DC01？

继续查看：

```
w32tm /query /configuration
```

关键配置为：

```
Type: NT5DS (Local)
AnnounceFlags: 10 (Local)
NtpServer Enabled: 0 (Local)
```

这说明：

- 该服务器没有使用手动 NTP Peer
    
- 它没有启用本机 NTP Server Provider
    
- 它正在通过 Active Directory 域层级自动选择时间源
    
- 当前选择 DC01 作为 Time Partner 是正常行为
    

此时时间链为：

```
External NTP
      │
      ▼
PDC01
      │
      ▼
DC01
      │
      ▼
Member Server
```

只要 DC01 自身能够稳定同步 PDC01，这就是正常且受支持的域时间同步链路。

正确配置参考
```pwsh
PS C:\Windows\system32> w32tm /query /status
Leap Indicator: 0(no warning)
Stratum: 6 (secondary reference - syncd by (S)NTP)
Precision: -6 (15.625ms per tick)
Root Delay: 0.0620454s
Root Dispersion: 0.1516282s
ReferenceId: 0xC0A80107 (source IP:  192.168.1.7)
Last Successful Sync Time: 7/22/2026 2:32:00 PM
Source: DC1.example.com
Poll Interval: 10 (1024s)

PS C:\Windows\system32> w32tm /query /configuration
[Configuration]

EventLogFlags: 2 (Local)
AnnounceFlags: 10 (Local)
TimeJumpAuditOffset: 28800 (Local)
MinPollInterval: 6 (Local)
MaxPollInterval: 10 (Local)
MaxNegPhaseCorrection: 4294967295 (Local)
MaxPosPhaseCorrection: 4294967295 (Local)
MaxAllowedPhaseOffset: 300 (Local)

FrequencyCorrectRate: 4 (Local)
PollAdjustFactor: 5 (Local)
LargePhaseOffset: 50000000 (Local)
SpikeWatchPeriod: 900 (Local)
LocalClockDispersion: 10 (Local)
HoldPeriod: 5 (Local)
PhaseCorrectRate: 1 (Local)
UpdateInterval: 100 (Local)


[TimeProviders]

NtpClient (Local)
DllName: C:\Windows\system32\w32time.dll (Local)
Enabled: 1 (Local)
InputProvider: 1 (Local)
CrossSiteSyncFlags: 2 (Local)
AllowNonstandardModeCombinations: 1 (Local)
ResolvePeerBackoffMinutes: 15 (Local)
ResolvePeerBackoffMaxTimes: 7 (Local)
CompatibilityFlags: 2147483648 (Local)
EventLogFlags: 1 (Local)
LargeSampleSkew: 3 (Local)
SpecialPollInterval: 3600 (Local)
Type: NT5DS (Local)

VMICTimeProvider (Local)
DllName: C:\Windows\System32\vmictimeprovider.dll (Local)
Enabled: 1 (Local)
InputProvider: 1 (Local)
NtpServer (Local)
DllName: C:\Windows\system32\w32time.dll (Local)
Enabled: 0 (Local)
InputProvider: 0 (Local)

PS C:\Windows\system32> w32tm /query /source
DC1.example.com
PS C:\Windows\system32> w32tm /monitor
PDC.example.com *** PDC ***[192.168.xx.xx:123]:
    ICMP: 0ms delay
    NTP: +0.0000000s offset from PDC.example.com
        RefID: time.cloudflare.com [162.159.200.123]
        Stratum: 4
DC1.example.com[192.168.x.xx:123]:
    ICMP: 0ms delay
    NTP: -0.0063029s offset from PDC.example.com
        RefID: dc2k12.example.com [192.168.xx.xx]
        Stratum: 5
DC2.example.com[192.168.x.xx:123]:
    ICMP: 0ms delay
    NTP: +0.0046926s offset from PDC.example.com
        RefID: ntp1.torix.ca [206.108.0.131]
        Stratum: 2

Warning:
Reverse name resolution is best effort. It may not be
correct since RefID field in time packets differs across
NTP implementations and may not be using IP addresses.
```

## 补充：如何检查是否由 GPO 配置

可以生成 Resultant Set of Policy 报告：

```
gpresult /h C:\Temp\gpresult.html
```

在报告中搜索：

```
Configure Windows NTP Client
Enable Windows NTP Client
Enable Windows NTP Server
```

`w32tm /query /configuration` 也会在配置项后显示来源，例如：

```
Type: NT5DS (Local)
```

本次成员服务器的有效配置显示为本地默认状态，没有证据表明 GPO 将其强制指定为某一台 NTP Server。

---

# 根因与证据边界

本次排查可以确认，问题不在以下组件：

- PDC Emulator 的外部 NTP 配置
    
- DNS 名称解析
    
- Active Directory DC Locator
    
- Secure Channel
    
- DC 之间的基础网络通信
    

故障集中在 DC01 本机的 Windows Time Service。

DC01 的配置中同时出现：

```
Type: NT5DS
AnnounceFlags: 5
```

这说明服务器的 W32Time 配置存在不符合当前角色预期的状态。

不过，仅凭 `AnnounceFlags: 5` 不能证明它就是 Event ID 129 的唯一直接原因。

能够确定的是：

- W32Time 无法正确建立 Domain Peer
    
- 重新注册 W32Time 并恢复 `domhier` 配置后，DC01 立即开始同步 PDC01
    
- 因此，故障根源位于 DC01 本机的 Windows Time Service 配置或服务状态
    
- Active Directory、DNS、网络和 PDC Emulator 本身均不是这次故障的主要原因
    

---

# 最终时间同步架构

整个域应该保持如下配置：

```
External NTP
      │
      ▼
PDC Emulator（唯一明确配置公网 NTP）
      │
      ▼
Other Domain Controllers（NT5DS）
      │
      ▼
Member Servers and Workstations（NT5DS）
```

其中：

- 只有 PDC Emulator 配置公网 NTP
    
- 其他 Domain Controller 使用 `NT5DS`
    
- Domain Member 使用 `NT5DS`
    
- 成员服务器可以同步任意健康 DC
    
- 所有时间链最终应追溯到 PDC Emulator
    

---

# 本次故障的排查思路总结

这次问题最值得记录的，并不是最终执行了哪一条修复命令，而是如何逐层缩小故障范围。

面对：

```
Local CMOS Clock
```

不能直接假设是公网 NTP、UDP 123 或防火墙故障。

更有效的方法是先理解服务器在域时间层级中的角色，再判断失败发生在哪个阶段。

## 通用排查顺序

```
确认设备角色
      │
      ▼
确认 PDC Emulator 和 FSMO Roles
      │
      ▼
确认 PDC 外部 NTP 正常
      │
      ▼
检查故障服务器的 Source、Status 和 Type
      │
      ▼
使用 w32tm /monitor 检查全域状态
      │
      ▼
验证 Secure Channel、DNS 和 PDC Locator
      │
      ▼
检查 Windows Time Service 事件日志
      │
      ▼
判断是发现失败、通信失败还是本地配置异常
      │
      ▼
恢复 W32Time 并重新加入域时间层级
      │
      ▼
验证完整时间同步链
```

## 常见现象与检查方向

| 现象                             | 优先检查                            |
| ------------------------------ | ------------------------------- |
| PDC 使用 `Local CMOS Clock`      | 外部 NTP、UDP 123、PDC 配置           |
| 非 PDC DC 使用 `Local CMOS Clock` | `NT5DS`、DC Locator、Event ID 129 |
| `No time data was available`   | 当前 Peer、网络连通、事件日志               |
| 普通 DC 显示 `Type: NTP`           | 手动配置或 GPO 遗留                    |
| 成员服务器同步普通 DC                   | 通常正常，检查完整上游链路                   |
| `w32tm /monitor` 查询超时          | W32Time 服务、防火墙、UDP 123          |
| `RefID: LOCL`                  | 当前设备正在使用本地时钟                    |

## 最重要的判断原则

面对 Windows Time 问题时，需要区分以下几种情况：

1. **配置错误**：设备使用了不符合其角色的 `Type` 或 Peer。
    
2. **发现失败**：W32Time 无法通过域层级建立 Domain Peer。
    
3. **通信失败**：已经选择时间源，但无法获得时间数据。
    
4. **本地服务异常**：配置看似正确，但实际运行状态与配置不一致。
    
5. **正常域层级行为**：成员服务器选择普通 DC，而不是直接选择 PDC。
    

当服务器显示 `Local CMOS Clock` 时，真正需要回答的不是：

> 应该换成哪个公网 NTP？

而是：

> 这台服务器在域时间层级中的角色是什么，它在哪一个阶段失去了正确的时间源？

只有先判断失败发生在配置、发现、通信还是同步阶段，后续修复才不会继续叠加新的历史配置。

---

# 命令工具箱

## 角色与域发现

```
netdom query fsmo
Get-ADDomain | Select-Object PDCEmulator
nltest /dsgetdc:example.local /PDC
nltest /dclist:example.local
```

## Secure Channel

```
Test-ComputerSecureChannel -Verbose
nltest /sc_verify:example.local
```

## Windows Time 状态

```
w32tm /query /source
w32tm /query /status
w32tm /query /configuration
w32tm /query /peers
w32tm /monitor
```

## 时间偏差测试

```
w32tm /stripchart /computer:PDC01.example.local /samples:5 /dataonly
```

## 日志检查

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 20 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

## 恢复非 PDC DC 的 Windows Time Service

```
net stop w32time
w32tm /unregister
w32tm /register
net start w32time
w32tm /config /syncfromflags:domhier /reliable:no /update
w32tm /resync /rediscover
```

## Group Policy 检查

```
gpresult /h C:\Temp\gpresult.html
```