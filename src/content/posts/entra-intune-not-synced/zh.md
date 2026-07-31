---
title: 排查 Microsoft Entra Hybrid Join 设备无法自动注册 Intune
published: 2026-07-31
description: 记录一台本地 AD 域设备在 Entra 中长期处于 Pending、无法自动注册 Intune，并导致 Windows Hello for Business 无法配置的完整排障过程。
tags:
  - Entra-ID
  - Intune
  - Windows-Hello
  - Active-Directory
  - Troubleshooting
category: Microsoft 365
draft: false
lang: zh
---

> 本文中的域名、Tenant ID、用户名和部分设备信息已脱敏。

在混合身份环境中，一台电脑加入本地 Active Directory，并不代表它会自动出现在 Microsoft Intune。

设备通常还需要依次完成：

```text
加入本地 AD
        ↓
同步计算机对象到 Microsoft Entra ID
        ↓
完成 Microsoft Entra Hybrid Join
        ↓
用户获得 Primary Refresh Token
        ↓
通过 GPO 自动注册 Intune
        ↓
接收设备策略
        ↓
配置 Windows Hello for Business
````

这次遇到的问题是：

- 电脑已经加入本地 AD；
- Entra 中已经能看到设备对象；
- 但设备长期显示 `Pending`；
- Intune 中找不到设备；
- Windows Hello for Business 无法配置。

最终发现，这并不是单一的 Intune 注册问题，而是以下几个问题叠加：

1. 设备尚未真正完成 Microsoft Entra Hybrid Join；
2. 设备读取 Hybrid Join 注册信息时曾出现异常；
3. 用户配置文件里还保留着旧的 Workplace Join；
4. 用户因此无法正常获得 Entra PRT；
5. 清理旧 Workplace Join 后，MDM 自动注册和 Windows Hello 才恢复正常。

本文记录完整的排障过程。


# 环境

本次环境如下：

- 本地 Active Directory
- Microsoft Entra Connect Sync
- Microsoft Entra Hybrid Join
- Microsoft Intune
- Windows 11
- Group Policy 自动 MDM Enrollment
- Windows Hello for Business
- 设备名称：`L108`
- 本地域名：`corp.example.com`
- 本地 NetBIOS 域名：`CORP`

目标设备原本已经加入本地 AD：

```
L108.corp.example.com
```

---

# 故障现象

在 Microsoft Entra 管理中心搜索 `L108`，可以看到多个同名设备对象。

其中包括几个：

```
Join type: Microsoft Entra registered
```

以及一个：

```
Join type: Microsoft Entra hybrid joined
Registered: Pending
MDM: None
```

真正对应本地 AD 计算机对象的是最后一个 Hybrid Joined 对象。

`Pending` 表示：

> Entra Connect 已经把本地 AD 中的计算机对象同步到了 Entra，但设备本身还没有完成 Hybrid Join 注册。

因为设备还没有真正完成 Hybrid Join，所以后续的 Intune 自动注册也没有发生。

# Microsoft Entra Registered 与 Hybrid Joined 的区别

排障过程中需要先区分两类设备对象。

## Microsoft Entra registered

通常由用户在以下位置手动添加工作账号产生：

```
Settings
→ Accounts
→ Access work or school
→ Connect
```

这种注册是用户级别的 Workplace Join。

同一台电脑上，如果多个用户分别连接了工作账号，Entra 中可能出现多个同名的 `Microsoft Entra registered` 对象。

## Microsoft Entra hybrid joined

这是本地 AD 计算机对象与 Microsoft Entra ID 建立的设备级关系。

正常状态应该是：

```
AzureAdJoined : YES
DomainJoined  : YES
```

对于本地 AD 域设备，真正用于 Intune 自动注册和 Windows Hello for Business 的通常是 Hybrid Joined 对象。
# TL;DR：完整修复命令

> 适用于：本地 AD 设备已同步到 Entra，但 Hybrid Join 显示 `Pending`、Intune 中没有设备、Windows Hello 无法配置。

```powershell
# 1. 查看当前 Hybrid Join、PRT、Workplace Join 和 MDM 状态
dsregcmd /status


# 2. 刷新计算机组策略
gpupdate /force


# 3. 检查并触发 Microsoft Entra Hybrid Join 任务
Get-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"

Start-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"


# 4. 调试 Hybrid Join
dsregcmd /debug /join


# 5. 如果无法找到域控制器，检查 DC 和计算机安全通道,以及是否需要连接VPN
nltest /dsgetdc:corp.example.com
nltest /sc_verify:corp.example.com
Test-ComputerSecureChannel -Verbose


# 6. 如果出现 0x801c001d，检查 Active Directory SCP
$ConfigNC = ([ADSI]"LDAP://RootDSE").configurationNamingContext

$SCPPath = "LDAP://CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
           "CN=Device Registration Configuration," +
           "CN=Services,$ConfigNC"

$SCP = [ADSI]$SCPPath

$SCP.distinguishedName
$SCP.keywords


# 7. 确认本机没有错误的 Tenant 覆盖配置
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CDJ\AAD"


# 8. 再次触发 Join，并等待后台任务完成
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"

Start-Sleep -Seconds 90

dsregcmd /debug /join
dsregcmd /status


# 9. Hybrid Join 成功后，检查用户是否残留旧 Workplace Join
# 如果 dsregcmd 显示 WorkplaceJoined = YES：
# Settings > Accounts > Access work or school
# 断开用户的 Work or school account
# 不要断开本地 AD domain 连接


# 10. 注销并使用用户自己的域账号重新登录
shutdown /l


# 11. 重新登录后确认 PRT、WAM 和 MDM URL
dsregcmd /status

# 目标状态：
# AzureAdJoined    : YES
# DomainJoined     : YES
# WorkplaceJoined  : NO
# WamDefaultSet    : YES
# AzureAdPrt       : YES
# MdmUrl           : https://enrollment.manage.microsoft.com/...


# 12. 检查自动 MDM Enrollment GPO
gpupdate /force

reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\MDM"

# 目标值：
# AutoEnrollMDM        REG_DWORD    0x1
# UseAADCredentialType REG_DWORD    0x1


# 13. 手动触发 Intune MDM Enrollment
C:\Windows\System32\deviceenroller.exe /c /AutoEnrollMDM



# 14. 检查是否创建完整的 EnterpriseMgmt Enrollment 任务
Get-ScheduledTask |
    Where-Object {
        $_.TaskPath -like "\Microsoft\Windows\EnterpriseMgmt\*"
    } |
    Select-Object TaskPath, TaskName, State


# 15. 检查最近的 Intune MDM 日志
$Since = (Get-Date).AddMinutes(-10)

Get-WinEvent -FilterHashtable @{
    LogName   = "Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin"
    StartTime = $Since
} |
Select-Object TimeCreated, Id, LevelDisplayName, Message |
Format-List


# 16. 最终确认 Windows Hello for Business 是否可以 Provision
dsregcmd /status

# 目标状态：
# IsDeviceJoined   : YES
# IsUserAzureAD    : YES
# PolicyEnabled    : YES
# DeviceEligible   : YES
# PreReqResult     : WillProvision
```

# 第一步：检查设备本地状态

在设备上运行：

```powershell
dsregcmd /status
```

最开始设备的状态为：

```powershell
AzureAdJoined : NO
DomainJoined  : YES
```

这说明：

- 电脑已加入本地 AD；
- 但尚未完成 Microsoft Entra Hybrid Join。

Entra 中的 `Pending` 状态与本机结果一致。

---

# 第二步：手动触发 Hybrid Join

Microsoft Entra Hybrid Join 通常由以下计划任务触发：

```powershell
\Microsoft\Windows\Workplace Join\Automatic-Device-Join
```

先刷新计算机策略：

```powershell
gpupdate /force
```

检查任务是否存在：

```powershell
Get-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"
```

手动启动任务：

```powershell
Start-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"
```

也可以使用：

```powershell
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"
```

等待一段时间后再次检查：

```powershell
dsregcmd /status
```

设备仍未完成注册，因此继续运行：

```powershell
dsregcmd /debug /join
```

---

# 第一次错误：无法找到域控制器

第一次执行时出现：

```powershell
DsrCmdAccountMgr::IsDomainControllerAvailable:
DsGetDcName No domain controller is available for the specified domain
or the domain does not exist: 0x8007054b.

preCheckResult: DoNotJoin
isDcAvailable: NO

The device can NOT be joined because a domain controller could not be located.
```

这说明 Hybrid Join 任务运行时，设备暂时无法定位域控制器。
检查后发现，电脑并不在公司网络，需要连接VPN才能找到控制器

检查域控制器发现：

```powershell
nltest /dsgetdc:corp.example.com
```

正常返回：

```powershell
DC: \\DC2.corp.example.com
Address: \\192.168.1.8
Flags: GC DS LDAP KDC TIMESERV WRITABLE DNS_DC
```

同时检查计算机与域之间的安全通道：

```powershell
nltest /sc_verify:corp.example.com
```

返回：

```powershell
Trusted DC Connection Status Status = 0 0x0 NERR_Success
Trust Verification Status = 0 0x0 NERR_Success
```

说明：

- 设备可以找到域控制器；
- 计算机账户的安全通道正常；
- 前面的域控制器不可用更像是短暂的网络或 DC 定位问题。

---

# 第二次错误：无法从 AD 读取 Hybrid Join 注册信息

再次运行：

```powershell
dsregcmd /debug /join
```

出现：

```powershell
DsrCmdAccountMgr::IsDomainControllerAvailable:
DsGetDcName success

PreJoinChecks Complete.
preCheckResult: Join
isDcAvailable: YES

TenantInfo::Discover:
Failed reading registration data from AD.
Defaulting to autojoin disabled 0x8007003a

TenantInfo::Discover failed with error code 0x801c001d.
```

核心错误为：

```powershell
0x801c001d
```

设备已经能找到域控制器，但无法从 Active Directory 中读取 Microsoft Entra Hybrid Join 所需的租户注册信息。

Hybrid Join 客户端通常会从 Active Directory 的 Service Connection Point，也就是 SCP，读取：

```powershell
azureADName
azureADId
```

---

# 第三步：检查 Active Directory SCP

在域控制器或安装了 Active Directory PowerShell 模块的管理电脑上运行：

```powershell
$ConfigNC = (Get-ADRootDSE).configurationNamingContext

$SCPPath = "CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
           "CN=Device Registration Configuration," +
           "CN=Services,$ConfigNC"

$SCP = [ADSI]"LDAP://$SCPPath"

$SCP.distinguishedName
$SCP.keywords
```

返回：

```powershell
CN=62a0ff2e-97b9-4513-943f-0d221bd30080,
CN=Device Registration Configuration,
CN=Services,
CN=Configuration,
DC=corp,
DC=example,
DC=com

azureADName:tenant.onmicrosoft.com
azureADId:00000000-0000-0000-0000-000000000000
```

说明 SCP 对象存在，而且 Tenant ID 正确。

`azureADName` 使用 `.onmicrosoft.com` 域名本身并不一定有问题，只要它是租户中的已验证域名即可。

---

# 第四步：从故障电脑直接读取 SCP

为了确认并不是域控制器或 AD 复制问题，需要直接从 L108 上读取同一个对象。

```powershell
$ConfigNC = ([ADSI]"LDAP://RootDSE").configurationNamingContext

$SCPPath = "LDAP://CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
           "CN=Device Registration Configuration," +
           "CN=Services,$ConfigNC"

$SCP = [ADSI]$SCPPath

$SCP.distinguishedName
$SCP.keywords
```

L108 也能正常读取：

```powershell
azureADName:tenant.onmicrosoft.com
azureADId:00000000-0000-0000-0000-000000000000
```

继续指定设备当前使用的 DC, 强制读取SCP：

```powershell
$SCPDN = "CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
         "CN=Device Registration Configuration," +
         "CN=Services,CN=Configuration,DC=corp,DC=example,DC=com"

$SCP = [ADSI]"LDAP://DC2.corp.example.com/$SCPDN"

$SCP.distinguishedName
$SCP.keywords
```

同样成功。

这说明：

- SCP 确实存在；
- DC2 上也有正确的 SCP；
- 当前管理员用户可以从 L108 读取 SCP；
- AD Configuration Partition 复制基本正常。

---

# 第五步：检查本机是否存在覆盖配置

Windows 还可能通过本地注册表覆盖 Active Directory SCP。

检查：

```powershell
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CDJ\AAD"
```

返回：

```powershell
ERROR: The system was unable to find the specified registry key or value.
```

这属于正常情况。

如果此注册表路径不存在，Windows 会继续使用 Active Directory SCP。

如果存在，则应该检查：

```
TenantId
TenantName
```

是否与当前租户一致。

错误的 Tenant ID、旧域名或空值都可能覆盖正确的 SCP。

---

# 第六步：等待现有 Join 任务结束

再次手动启动计划任务：

```powershell
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"
```

马上运行：

```powershell
dsregcmd /debug /join
```

出现：

```powershell
Another instance of the Join Task is already running.
Please retry after sometime.
```

这说明计划任务还在后台执行。

此时不应该连续重复启动多个 Join 进程，而应该等待任务完成。

几分钟后再次运行：

```powershell
dsregcmd /debug /join
```

返回：

```powershell
DsrCmdAccountMgr::IsDomainControllerAvailable:
DsGetDcName success

DsrCmdAccountMgr::IsDrsJoined:
DsrCmdCertHelper::PrivateKeyAquireTest Passed

PreJoinChecks Complete.
preCheckResult: DoNotJoin

deviceKeysHealthy: YES
isJoined: YES
isDcAvailable: YES
keyProvider: Microsoft Platform Crypto Provider
dsrInstance: AzureDrs

The device is already joined.
```

这里最重要的是：

```powershell
deviceKeysHealthy: YES
isJoined: YES
```

说明设备已经成功完成 Microsoft Entra Hybrid Join。

---

# 第七步：验证 Hybrid Join 状态

运行：

```powershell
dsregcmd /status
```

设备状态变为：

```powershell
AzureAdJoined : YES
DomainJoined  : YES
DeviceAuthStatus : SUCCESS
```

示例：

```powershell
Device State
------------

AzureAdJoined : YES
DomainJoined  : YES
DomainName    : CORP
Device Name   : L108.corp.example.com
```

设备详细信息：

```powershell
DeviceAuthStatus : SUCCESS
TpmProtected     : YES
KeyProvider      : Microsoft Platform Crypto Provider
```

这表示：

- 设备证书有效；
- 私钥受 TPM 保护；
- Entra 可以正常验证设备身份；
- Hybrid Join 已经完成。

此时 Entra 中原本显示：

```powershell
Registered: Pending
```

的对象，也会逐渐更新为具体注册时间。

---

# 第八步：发现旧的 Workplace Join

虽然 Hybrid Join 已经成功，但用户上下文中仍显示：

```powershell
WorkplaceJoined : YES
WorkAccountCount: 1
AzureAdPrt      : NO
```

同时还有一个独立的 Workplace Device ID：

```powershell
WorkplaceDeviceId : 08486976-c661-4d5a-8648-730a4200c3ee
```

这意味着当前用户配置文件里还保留着旧的：

```powershell
Microsoft Entra registered
```

用户级设备身份。

它通常是用户以前在以下位置添加工作账号产生的：

```powershell
Settings
→ Accounts
→ Access work or school
→ Connect
```

同一台电脑上可能因此出现：

- 一个 Hybrid Joined 设备对象；
- 一个或多个 Entra Registered 设备对象。

旧 Workplace Join 不一定每次都会阻止 Hybrid Join，但它可能造成：

- 用户设备身份混乱；
- WAM 默认账号异常；
- PRT 无法正常获取；
- MDM discovery 信息不完整；
- Intune 自动注册没有触发；
- Windows Hello for Business 无法配置。

---

# 第九步：删除旧 Work or school account

在用户自己的 Windows 会话中进入：

```powershell
Settings
→ Accounts
→ Access work or school
```

页面里存在两种连接。

需要删除的是：

```powershell
user@example.com
Work or school account
```

不能删除的是：

```powershell
corp.example.com
Connected to CORP AD domain
```

前者是用户级 Workplace Join。

后者是本地 Active Directory 域连接，断开它会导致电脑退出域。

删除旧工作账号后，注销当前用户：

```powershell
shutdown /l
```

然后重新使用本地域账号登录。

---

# 第十步：重新检查用户身份状态

重新登录后运行：

```powershell
dsregcmd /status
```

状态变为：

```powershell
WorkplaceJoined : NO
WamDefaultSet   : YES
AzureAdPrt      : YES
```

Tenant Details 中也出现了完整的 MDM URL：

```powershell
TenantName       : example.com
MdmUrl           : https://enrollment.manage.microsoft.com/enrollmentserver/discovery.svc
MdmTouUrl        : https://portal.manage.microsoft.com/TermsofUse.aspx
MdmComplianceUrl : https://portal.manage.microsoft.com/?portalAction=Compliance
```

SSO 状态变为：

```powershell
AzureAdPrt : YES
CloudTgt   : YES
```

这说明：

- 用户成功取得 Primary Refresh Token；
- Windows Web Account Manager 状态正常；
- 用户位于 MDM 自动注册范围内；
- Intune MDM discovery 已经成功。

---

# 什么是 Azure AD PRT

PRT 的完整名称是：

```
Primary Refresh Token
```

它是 Windows 用户登录后，由 Microsoft Entra ID 向设备和用户签发的长期身份令牌。

它用于：

- Microsoft 365 单点登录；
- 条件访问；
- Intune 自动注册；
- Windows Hello for Business；
- 企业应用身份认证。

对于 Hybrid Joined 设备，正常状态通常应为：

```powershell
AzureAdJoined : YES
DomainJoined  : YES
AzureAdPrt    : YES
```

设备完成 Hybrid Join，并不代表用户一定已经取得 PRT。

设备身份和用户身份需要分别检查。

---

# 第十一步：检查自动 MDM Enrollment GPO

在管理员 PowerShell 中运行：

```powershell
gpupdate /force
```

检查注册表：

```powershell
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\MDM"
```

返回：

```powershell
AutoEnrollMDM         REG_DWORD    0x1
UseAADCredentialType  REG_DWORD    0x1
MDMApplicationId      REG_SZ
```

这说明自动 MDM Enrollment GPO 已经应用。

对应 GPO 路径为：

```powershell
Computer Configuration
→ Policies
→ Administrative Templates
→ Windows Components
→ MDM
→ Enable automatic MDM enrollment using default Microsoft Entra credentials
```

在普通 Hybrid Joined 用户设备上，通常使用：

```powershell
Enabled
Credential Type: User Credential
```

---

# 第十二步：检查 EnterpriseMgmt 任务

运行：

```powershell
Get-ScheduledTask |
    Where-Object {
        $_.TaskPath -like "\Microsoft\Windows\EnterpriseMgmt\*"
    } |
    Select-Object TaskPath, TaskName, State
```

设备上已经出现了完整的 Enrollment 任务目录：

```powershell
\Microsoft\Windows\EnterpriseMgmt\
\Microsoft\Windows\EnterpriseMgmt\236348F8-2E95-4D98-BB22-D71AFD9B03B4\
```

其中包括：

```powershell
Policy Manager Login Refresh Schedule
Provisioning initiated session
Schedule #1 created by enrollment client
Schedule #2 created by enrollment client
Schedule #3 created by enrollment client
Schedule to run OMADMClient by client
Schedule to run OMADMClient by server
Passport for Work alert created by enrollment client
```

这说明设备已经建立正式的 MDM Enrollment。

Enrollment ID 为：

```powershell
236348F8-2E95-4D98-BB22-D71AFD9B03B4
```

---

# 第十三步：手动触发 MDM Enrollment

可以使用以下命令手动触发：

```powershell
C:\Windows\System32\deviceenroller.exe /c /AutoEnrollMDM
```

该命令通常不会弹出窗口，也不会返回明显输出。

等待一分钟：

然后查看最近的 MDM 日志：

```powershell
$Since = (Get-Date).AddMinutes(-10)

Get-WinEvent -FilterHashtable @{
    LogName   = "Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin"
    StartTime = $Since
} |
Select-Object TimeCreated, Id, LevelDisplayName, Message |
Format-List
```

---

# 第十四步：确认设备已开始接收 Intune 策略

日志中出现大量新的 MDM PolicyManager 事件：

```powershell
MDM PolicyManager: Set policy int
EnrollmentID requesting merge:
236348F8-2E95-4D98-BB22-D71AFD9B03B4
Enrollment Type: 0x6
Current User: Device
```

还出现应用安装事件：

```powershell
EnterpriseDesktopAppManagement CSP:
Application content download started.
```

以及：

```powershell
MDMAppInstaller task has started.
```

这说明设备已经不只是完成注册，而是正在：

- 接收 Intune 配置策略；
- 接收 Microsoft Defender 策略；
- 接收 Device Health Monitoring 策略；
- 下载分配的应用；
- 执行 MDM 同步。

---

# 第十五步：验证 Windows Hello for Business

最终 `dsregcmd /status` 中显示：

```powershell
NgcSet          : NO
IsDeviceJoined  : YES
IsUserAzureAD   : YES
PolicyEnabled   : YES
PostLogonEnabled: YES
DeviceEligible  : YES
SessionIsNotRemote : YES
PreReqResult    : WillProvision
```

最关键的是：

```powershell
PreReqResult : WillProvision
```

这意味着 Windows 判断当前设备和用户已经满足 Windows Hello for Business 的配置条件。

此时可以注销并重新登录：

```powershell
shutdown /l
```

Windows 应自动提示：

```powershell
Your organization requires you to set up Windows Hello
```

也可以进入：

```powershell
Settings
→ Accounts
→ Sign-in options
→ PIN (Windows Hello)
→ Set up
```

完成 PIN 创建。

---

# 关于 gpupdate 的 MDM Policy 警告

排障过程中，`gpupdate /force` 曾返回：

```powershell
Windows failed to apply the MDM Policy settings.
MDM Policy settings might have its own log file.
```

但与此同时：

```powershell
AutoEnrollMDM = 1
UseAADCredentialType = 1
```

并且设备已经创建完整的 EnterpriseMgmt 任务，开始接收 Intune 策略。

因此该警告并不代表设备注册失败。

后续日志中还出现：

```powershell
ADMXInstall
0x86000009
The system cannot find the file specified.
```

这更像是某个 MDM ADMX 策略处理异常，而不是自动 enrollment 本身失败。

需要根据具体策略单独排查，但它不影响本次 Hybrid Join 和 Intune 注册结论。

---

# 关于 BitLocker 警告

日志中还出现：

```
OS Drive not protected.
```

以及：

```
TPM not used for protection of OS Drives,
but is required by policy.
```

这说明 Intune 已经开始评估设备的 BitLocker 状态，但当前系统盘尚未满足策略要求。

如果公司的合规策略强制要求 BitLocker，设备可能暂时显示：

```
Not compliant
```

这与 Hybrid Join、MDM Enrollment 和 Windows Hello 是不同的问题，需要后续单独处理。

---

# 最终状态

排障完成后，L108 的最终状态如下。

## Device State

```powershell
AzureAdJoined    : YES
DomainJoined     : YES
DeviceAuthStatus : SUCCESS
TpmProtected     : YES
```

## User State

```powershell
WorkplaceJoined : NO
WamDefaultSet   : YES
```

## SSO State

```powershell
AzureAdPrt : YES
CloudTgt   : YES
```

## MDM

```powershell
MdmUrl:
https://enrollment.manage.microsoft.com/enrollmentserver/discovery.svc
```

## Windows Hello for Business

```powershell
PolicyEnabled : YES
DeviceEligible: YES
PreReqResult  : WillProvision
```

## EnterpriseMgmt

```
完整的 Enrollment GUID 任务目录已创建
设备开始接收 Intune 策略和应用
```

---

# 故障根因总结

这次问题不是“电脑已经在 AD 中，为什么没有自动进入 Intune”这么简单。

真正的问题链如下：

```
本地 AD 设备对象已同步到 Entra
        ↓
设备在 Entra 中显示 Hybrid Joined / Pending
        ↓
本机实际 AzureAdJoined = NO
        ↓
Hybrid Join 任务曾无法定位 DC
        ↓
之后又出现 SCP Discovery 错误 0x801c001d
        ↓
等待 Automatic-Device-Join 完成后 Hybrid Join 成功
        ↓
用户配置文件仍保留旧 Workplace Join
        ↓
AzureAdPrt = NO
        ↓
MDM URL 为空
        ↓
Intune 自动注册无法正常完成
        ↓
删除旧 Work or school account
        ↓
用户重新登录并获得 PRT
        ↓
MDM URL 出现
        ↓
EnterpriseMgmt enrollment 创建
        ↓
设备开始接收 Intune 策略
        ↓
Windows Hello 状态变为 WillProvision
```

---

# 排障思路总结

这次排障最重要的经验是，不要把以下几个状态混为一谈：

```
加入本地 AD
Entra Connect 同步设备对象
Microsoft Entra Hybrid Join
用户 Workplace Join
用户获得 Entra PRT
Intune MDM Enrollment
Windows Hello for Business Provisioning
```

它们是不同阶段。

设备出现在 Entra 中，只能说明云端已经有对象，并不代表本机已经成功注册。

设备显示 `Microsoft Entra hybrid joined`，但 `Registered = Pending` 时，应优先检查本机：

```powershell
dsregcmd /status
```

如果：

```powershell
AzureAdJoined : NO
```

就先处理 Hybrid Join，而不是直接处理 Intune。

Hybrid Join 成功后，如果：

```powershell
WorkplaceJoined : YES
AzureAdPrt      : NO
```

则需要检查是否存在旧的用户级 Work or school account。

只有当以下状态同时正常后，Intune 自动注册和 Windows Hello 才有可靠基础：

```powershell
AzureAdJoined    : YES
DomainJoined     : YES
DeviceAuthStatus : SUCCESS
WorkplaceJoined  : NO
AzureAdPrt       : YES
MdmUrl           : 非空
PolicyEnabled    : YES
```

---

# Troubleshooting 工具箱

## 检查 Hybrid Join 状态

```powershell
dsregcmd /status
```

重点字段：

```powershell
AzureAdJoined
DomainJoined
DeviceId
DeviceAuthStatus
AzureAdPrt
WorkplaceJoined
MdmUrl
PreReqResult
```

---

## 手动调试 Hybrid Join

```powershell
dsregcmd /debug /join
```

---

## 触发 Automatic Device Join

```powershell
Start-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"
```

或者：

```powershell
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"
```

---

## 检查域控制器

```powershell
nltest /dsgetdc:corp.example.com
```

---

## 检查计算机安全通道

```powershell
nltest /sc_verify:corp.example.com
```

或者：

```powershell
Test-ComputerSecureChannel -Verbose
```

---

## 检查 Active Directory SCP

```powershell
$ConfigNC = (Get-ADRootDSE).configurationNamingContext

$SCPPath = "CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
           "CN=Device Registration Configuration," +
           "CN=Services,$ConfigNC"

$SCP = [ADSI]"LDAP://$SCPPath"

$SCP.distinguishedName
$SCP.keywords
```

---

## 从指定域控制器读取 SCP

```powershell
$SCPDN = "CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
         "CN=Device Registration Configuration," +
         "CN=Services,CN=Configuration,DC=corp,DC=example,DC=com"

$SCP = [ADSI]"LDAP://DC2.corp.example.com/$SCPDN"

$SCP.distinguishedName
$SCP.keywords
```

---

## 检查本机 Hybrid Join 覆盖配置

```powershell
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CDJ\AAD"
```

---

## 检查 MDM 自动注册 GPO

```powershell
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\MDM"
```

正常应看到：

```powershell
AutoEnrollMDM = 1
```

---

## 生成 GPO 报告

```powershell
New-Item C:\Temp -ItemType Directory -Force | Out-Null

gpresult /scope computer /h C:\Temp\GPReport.html

Start-Process C:\Temp\GPReport.html
```

---

## 检查 EnterpriseMgmt 任务

```powershell
Get-ScheduledTask |
    Where-Object {
        $_.TaskPath -like "\Microsoft\Windows\EnterpriseMgmt\*"
    } |
    Select-Object TaskPath, TaskName, State
```

---

## 手动触发 MDM Enrollment

```powershell
C:\Windows\System32\deviceenroller.exe /c /AutoEnrollMDM
```

---

## 查看最近的 MDM 日志

```powershell
$Since = (Get-Date).AddMinutes(-10)

Get-WinEvent -FilterHashtable @{
    LogName   = "Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin"
    StartTime = $Since
} |
Select-Object TimeCreated, Id, LevelDisplayName, Message |
Format-List
```

---

## 查看 Hybrid Join 日志

```powershell
Get-WinEvent `
    -LogName "Microsoft-Windows-User Device Registration/Admin" `
    -MaxEvents 50 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

---

## 查看 AAD 身份日志

```powershell
Get-WinEvent `
    -LogName "Microsoft-Windows-AAD/Operational" `
    -MaxEvents 100 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

---

## 触发注销

```powershell
shutdown /l
```

---

## 锁定电脑

```powershell
rundll32.exe user32.dll,LockWorkStation
```

---

# 结语

这次故障最容易误判的地方，是设备已经在 Entra 中出现，而且 Join Type 也显示为 Microsoft Entra hybrid joined。

但只要状态还是：

```
Registered: Pending
```

就不能认为设备已经完成 Hybrid Join。

排障时应该始终回到本机，以：

```powershell
dsregcmd /status
```

作为设备身份的主要判断依据。

最终，L108 在完成 Hybrid Join、删除旧 Workplace Join、重新获取 PRT 后，成功进入 Intune，并满足 Windows Hello for Business 的配置条件。