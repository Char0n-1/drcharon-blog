---
title: 一次 Windows Hello for Business (Key Trust) 的完整排障记录
published: 2026-07-17
description: 从 “That option is temporarily unavailable” 到成功恢复 Windows Hello for Business，这次排障几乎把 Hybrid AD、Entra ID、Intune、AD CS、Kerberos 都查了一遍。
tags:
  - Windows
  - Active-Directory
  - Entra-ID
  - Intune
  - PKI
  - Kerberos
  - Windows-Hello
category: Infrastructure
lang: zh
draft: false
---

最近在部署 Windows Hello for Business 的时候，踩了一个非常大的坑。 整个过程持续了两天，最后发现并不是某一个配置出了问题，而是几个历史遗留问题叠加在一起，导致整个认证链全部失效。 这篇文章记录一下整个排障过程，也希望以后自己再遇到类似问题的时候，不用重新踩一遍。

---

# 环境 

- 本地 Active Directory 
- Microsoft Entra ID Hybrid Join 
- Microsoft Intune 
- Windows Hello for Business 
- Key Trust 部署 
- Enterprise CA（AD CS） 
Windows 11 已经完成 Hybrid Join，也已经自动加入 Intune。 
理论上，只需要下发 Windows Hello Policy，就可以直接使用 PIN 登录。 事实证明，没有这么简单。

# 故障现象

这次排障的起点是一个普通的用户反馈。

用户在设置 Windows Hello PIN 后，原本以为以后可以直接使用 PIN 登录 Windows。

结果锁屏之后，点击 PIN 登录，系统直接提示：

> **该选项暂时不可用。**
>
> **请使用其他方式登录。**

![](Pasted%20image%2020260717110121.png)

（英文对应为：**That option is temporarily unavailable. For now, please use a different sign-in method.**）

也就是说，PIN 已经设置成功，但是真正登录的时候却被拒绝了。

与此同时，Windows Hello 设置页面并没有任何异常，也没有提示 PIN 创建失败。

最开始，我怀疑是不是 PIN 本身没有创建成功。

于是第一件事就是检查 Windows Hello 的状态：

```pwsh
dsregcmd /status
```

发现：

```text
NgcSet : NO
```

进一步查看 Windows Hello Prerequisite，又发现：

```text
PreReqResult : WillNotProvision
```

这说明问题甚至还没有进入认证阶段。

Windows Hello 连 Provisioning 都没有完成。

于是，整个排查的第一阶段就变成了：

> **为什么 Windows Hello 根本不愿意开始 Provisioning？**

---

# 第一阶段：先让 Windows Hello 开始工作

看到 `WillNotProvision` 之后，我决定先停下来，重新梳理一下 Windows Hello for Business 的工作流程。

很多人（包括刚开始的我）都会把 Windows Hello 理解成"设置一个 PIN"。

其实并不是。

对于 Windows Hello for Business 来说，PIN 只是用来解锁本地保存的密钥，并不是用户真正的密码。

整个流程大致可以分成两个阶段。
- Provisioning
- Authentication

## 第一阶段：Provisioning

第一次启用 Windows Hello 时，系统会完成一系列初始化工作，包括：

- 检查设备是否满足部署条件；
- 检查策略是否允许启用 Windows Hello；
- 在 TPM（或软件密钥存储）中生成一对新的公私钥；
- 将公钥注册到身份系统（例如 Active Directory 或 Microsoft Entra ID）；
- 完成 Windows Hello 的初始化。

只有这一切都完成之后，用户才能成功创建 PIN。

如果 Provisioning 失败，那么后面的登录流程根本不会开始。

而我当时看到的：

```text
PreReqResult : WillNotProvision
```

正说明系统停在了这一阶段。


## 第二阶段：Authentication

Provisioning 完成之后，Windows Hello 才真正进入日常使用阶段。

以后每次输入 PIN 登录时，Windows 会使用之前生成的密钥完成身份验证。

如果这一阶段出现问题，就会表现为：

- PIN 可以创建；
- Windows Hello 已经启用；
- 但是输入 PIN 后仍然无法登录。

而这是我后来遇到的第二个问题。

我的首要目标，是先让 Windows Hello 能够完成 Provisioning。

---

### 检查Intune配置

Windows Hello for Business 在 Intune 里面其实有两个容易混淆的配置位置。

第一个是：

> **Devices → Windows → Enrollment → Windows Hello for Business**
![](Pasted%20image%2020260717112051.png)


这里属于 **Enrollment** 配置。

它决定的是设备是否启用 Windows Hello，一些简单的配置

第二个是：

> **Devices → Windows → Configuration → Policies**

![](Pasted%20image%2020260717112035.png)
这里属于 **Configuration Profile**。

它的作用是向设备下发具体配置，例如 PIN 复杂度、生物识别、TPM 要求，以及其他 Windows 设置，以及使用哪一种部署模式，例如 Cloud Trust、Key Trust 或 Certificate Trust。可以把它理解成 Windows Hello 的"全局策略"。

虽然这两个地方都会影响 Windows Hello，但职责并不一样。

简单来说：

- **Enrollment** 决定 **Windows Hello 能不能开始工作**；
- **Configuration Policy** 决定 **Windows Hello 应该怎样工作**。
---

检查后发现，configuration profile里开启了cloud trust，而我们本地的Hybrid Domain并没有准备好。

由于之前一直在测试 Cloud Trust 和 Key Trust，两种部署方式之间来回切换过不少次，因此这里的配置也经历过多次修改。

继续折腾 Cloud Trust 并不是一个好的选择。

我们的环境里仍然保留着 Windows Server 2012 的 Domain Controller。虽然 Cloud Trust 并不是完全不能部署，但如果要认真验证和推广，应该作为后续单独的项目来规划，而不是在修复故障的时候一边排障、一边调整整个认证架构。

这次的目标其实很简单：

> **先让用户能够正常使用 PIN 登录。**

于是，我决定暂时关闭 Cloud Trust，先回到目前环境更容易验证的 Key Trust 部署方式。
![](Pasted%20image%2020260717112153.png)

调整策略之后，再次查看设备状态：

```pwsh
NgcSet : dsregcmd /status
```

需要重点观察的部分：
```text
+----------------------------------------------------------------------+
| Ngc Prerequisite Check                                               |
+----------------------------------------------------------------------+

            IsDeviceJoined : YES
             IsUserAzureAD : YES
             PolicyEnabled : YES
          PostLogonEnabled : YES
            DeviceEligible : YES
        SessionIsNotRemote : YES
            CertEnrollment : enrollment authority
          AdfsRefreshToken : YES
             AdfsRaIsReady : YES
    LogonCertTemplateReady : YES ( StateReady )
              PreReqResult : WillProvision
+----------------------------------------------------------------------+


```

这一次，用户终于可以正常创建 PIN 了。

这说明 Windows Hello 已经成功完成了 Provisioning。

# 第二阶段：PIN 已经创建，为什么还是不能登录？

关闭 Cloud Trust 之后，Windows Hello 终于完成了 Provisioning，用户也可以正常设置 PIN。

但在锁屏界面尝试使用 PIN 登录时，系统仍然提示：

> **该选项暂时不可用。**
>
> **请使用其他方式登录。**

这一次，问题已经和前面不同了。

前面是 Windows Hello 无法开始 Provisioning；现在 PIN 已经创建成功，说明初始化流程至少已经走完了大半。

接下来需要确认的是：

> **Windows Hello 是否真的进入了 Authentication，以及认证失败发生在哪一端。**

---

## 从 Windows Hello 日志确认认证失败

我没有通过 Event Viewer 图形界面检查，而是直接使用 PowerShell 读取 Windows Hello 的 Operational 日志：

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-HelloForBusiness/Operational" `
    -MaxEvents 50 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

输出：
```pwsh
TimeCreated Id LevelDisplayName Message ----------- -- ---------------- ------- 
2026-07-17 10:17:39 AM 7001 Error A user failed to sign into the device with the following information:... 
2026-07-17 10:17:39 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0... 
2026-07-17 10:17:38 AM 5002 Information A user is signing into the device with the following gesture informatio... 
2026-07-17 10:15:34 AM 5205 Information Windows Hello for Business on-premise authentication configurations: ... 
2026-07-17 10:12:26 AM 8045 Success Windows Hello processing completed successfully.... 
2026-07-17 10:12:26 AM 8510 Success Windows Hello key registration completed successfully. 
2026-07-17 10:12:25 AM 3510 Information Windows Hello key registration started. 2026-07-17 10:12:25 AM 8225 Success Windows Hello key creation completed successfully.... 
2026-07-17 10:12:25 AM 8067 Success Windows Hello set a certificate property on a Windows Hello key.... 
2026-07-17 10:12:24 AM 5225 Information Creating a hardware Windows Hello key with result 0x0. 
2026-07-17 10:12:24 AM 8632 Success Windows Hello for Business successfully added a user entry to the Usern... 
2026-07-17 10:12:24 AM 5205 Information Windows Hello for Business on-premise authentication configurations: ... 
2026-07-17 10:12:24 AM 5205 Information Windows Hello for Business on-premise authentication configurations: ... 
2026-07-17 10:12:24 AM 3225 Information Windows Hello key creation started. 2026-07-17 10:12:24 AM 8055 Success Windows Hello container provisioning completed successfully.... 
2026-07-17 10:12:24 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0... 
2026-07-17 10:12:24 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0... 
2026-07-17 10:12:24 AM 5225 Information Creating a software Windows Hello key with result 0x0. 2026-07-17 10:12:24 AM 5225 Information Creating a software Windows Hello key with result 0x0. 
2026-07-17 10:12:24 AM 5555 Information Windows Hello is validating that the device can satisfy all applicable ... 
2026-07-17 10:12:24 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0... 
2026-07-17 10:12:17 AM 5004 Information Windows Hello for Business Enabled Policy successfully enforced for the... 
2026-07-17 10:12:17 AM 3055 Information Windows Hello container provisioning started. 
2026-07-17 10:12:17 AM 6611 Warning Windows Hello could not delete the container as no container currently ... 
```
日志中可以看到 Windows Hello 已经成功完成了前面的处理流程，包括密钥创建和注册。
查看7001和5702 event：
```pwsh
Get-WinEvent -FilterHashtable @{
    LogName = "Microsoft-Windows-HelloForBusiness/Operational"
    Id      = 7001
} -MaxEvents 3 |
Format-List TimeCreated, Id, LevelDisplayName, Message
```

```pwsh
Get-WinEvent -FilterHashtable @{
    LogName = "Microsoft-Windows-HelloForBusiness/Operational"
    Id      = 5205
} -MaxEvents 5 |
Format-List TimeCreated, Id, Message
```
Event 7001 显示：

```pwsh
TimeCreated : 2026-07-17 10:17:47 AM 
Id : 7001 
LevelDisplayName : 
Error Message : A user failed to sign into the device with the following information: 
Username: SYSTEM 
User SID: S-1-5-18 
Credential Type: Software Key Deployment 
Type: Key Trust 
Software Lockout Counter: 0 
Authentication Error Status: 0xC000006D 
Authentication Error Substatus: 0xC0000380
```


错误代码本身没有直接告诉我哪一项配置有问题，但它至少确认了两件事：

- 当前部署类型确实是 **Key Trust**；
- 失败发生在 **Authentication**，而不是 Provisioning。

接下来要查的是 Key Trust 认证链本身。

---

## 确认 Windows Hello 公钥是否已经写入 AD

Key Trust 的基本逻辑是：

1. 客户端生成一对公私钥；
2. 私钥保存在本地，并由 PIN 解锁；
3. 公钥写入 Active Directory 用户对象；
4. 登录时，Domain Controller 使用该公钥验证客户端签名。

因此，我先检查用户对象的 `msDS-KeyCredentialLink` 属性：

```pwsh
Get-ADUser test.user `
    -Properties msDS-KeyCredentialLink |
    Select-Object -ExpandProperty msDS-KeyCredentialLink
```

输出中已经存在多条 Key Credential 数据。

完整内容很长，类似下面这种结构：

```text
B:828:00020000200001...
B:828:00020000200001...
```

这一步非常关键。

它证明：

- Windows Hello 密钥已经成功生成；
- 公钥已经写入 Active Directory；
- Key Registration 已经完成；
- Entra Connect 和 AD 用户对象并不是当前的阻塞点。

到这里，客户端该完成的工作基本都已经完成了。

问题开始指向 Domain Controller。

---

## Key Trust 为什么依赖 Domain Controller 证书？

Key Trust 虽然不需要给每个用户签发登录证书，但并不代表整个环境不需要 PKI。

在混合 Key Trust 部署中，Domain Controller 上的 KDC 仍然需要一张合适的 Kerberos 证书，才能完成基于公钥的初始身份验证。

换句话说：

> 用户不需要证书，但 KDC 需要。

于是，我开始检查 Domain Controller 的 KDC 日志。

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `
    -MaxEvents 50 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

日志中出现了 Event 200，核心信息是：

```text
The Key Distribution Center (KDC) cannot find a suitable certificate
to use for smart card logons, or the KDC certificate could not be verified.
```

这就是第一条真正指向根因的证据。

客户端已经有密钥，AD 里也已经有公钥，但 KDC 没有合适的证书，无法完成 Key Trust 所需要的 Kerberos 公钥认证。

---

## 检查 Domain Controller 的证书

接下来，我分别在两台 Domain Controller 上检查本机计算机证书存储：

```pwsh
certutil -store My
```

结果并不理想。

其中一台 Domain Controller 的本机证书存储中，没有任何可以供 KDC 使用的证书。

另一台虽然有一张证书，但只是历史遗留的自签名证书，并不是由当前受信任的 Enterprise CA 签发的 `Kerberos Authentication` 证书。

我也没有找到有效的：

```text
Template: Kerberos Authentication
```

到这里，故障链条已经基本清楚了：

```text
Windows Hello Provisioning
        ↓ 成功

公钥写入 msDS-KeyCredentialLink
        ↓ 成功

客户端使用 PIN 发起 Key Trust 登录
        ↓

Domain Controller 的 KDC 没有合适的 Kerberos 证书
        ↓

Authentication Failed
```

---

## 发现已经退役的 Enterprise CA

继续检查 PKI 环境后，我发现 Active Directory 中仍然发布着旧 Enterprise CA 的对象。

例如：

```text
CONTOSO-DC02-CA
contoso.local
```

但对应的 CA 服务器早已退役。

也就是说，Active Directory 还保留着旧 PKI 的发布信息，但已经没有一台正常工作的 Enterprise CA 可以：

- 签发新的 Domain Controller 证书；
- 处理自动注册；
- 更新或续订 KDC 所需要的证书。

这也解释了为什么 Domain Controller 一直没有获得有效的 `Kerberos Authentication` 证书。

问题已经不只是某一张证书过期，而是整个 Enterprise PKI 实际上已经失效。

---

## 重新部署 Enterprise CA

由于旧 CA 已经不存在，也没有可以恢复的服务器，我决定重新部署一套 Enterprise Root CA。
```pwsh
Install-WindowsFeature ADCS-Cert-Authority -IncludeManagementTools
```

新的 CA 配置为：
```pwsh
Install-AdcsCertificationAuthority `
    -CAType EnterpriseRootCA `
    -CACommonName "CONTOSO-ROOT-CA" `
    -CryptoProviderName "RSA#Microsoft Software Key Storage Provider" `
    -KeyLength 4096 `
    -HashAlgorithmName SHA256 `
    -ValidityPeriod Years `
    -ValidityPeriodUnits 10 `
    -Force
```


完成 AD CS 部署后，使用下面的命令确认 CA 已经能够被域环境发现：

```pwsh
certutil -config - -ping
```

返回：

```text
DC01.contoso.local\CONTOSO-ROOT-CA
```

说明新的 Enterprise CA 已经正常工作。

---

## 让 Domain Controller 自动申请证书

Enterprise CA 建立后，我重新触发了组策略和证书自动注册：

```pwsh
gpupdate /force
certutil -pulse
```

随后再次检查两台 Domain Controller 的本机证书：

```pwsh
certutil -store My
```

这一次，两台 DC 都成功获得了新的证书，包括：

```text
Kerberos Authentication
Domain Controller Authentication
Directory Email Replication
```

签发者为：

```text
CONTOSO-ROOT-CA
```

我还确认了新的 CA 证书已经发布到 Enterprise NTAuth 存储：

```pwsh
certutil -enterprise -verifystore NTAuth
```

输出中可以看到：

```text
CONTOSO-ROOT-CA
```

这一步很重要。

只有 CA 被发布并信任到 NTAuth，域控制器签发的认证证书才能被用于域身份验证。

---

## 确认 KDC 已经加载新证书

证书申请成功后，我再次检查 KDC Operational 日志：

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `
    -MaxEvents 50 |
    Where-Object Id -in 200, 302 |
    Select-Object TimeCreated, Id, Message |
    Format-List
```

之前看到的是 Event 200：

```text
No suitable certificate
```

现在出现了 Event 302，内容表明 KDC 已经选中了新的证书：

```text
Issuer    : CONTOSO-ROOT-CA
Template  : Kerberos Authentication
Thumbprint: <REDACTED>
```

这说明 PKI 和 KDC 部分已经修复。

到这里，Key Trust 所需要的几个关键条件都已经满足：

- Windows Hello Provisioning 成功；
- 公钥已经写入 Active Directory；
- 客户端正在使用 Key Trust；
- Domain Controller 已获得 Kerberos Authentication 证书；
- KDC 已经加载并使用该证书。

---

## 最终原因


1. Intune 中启用了尚未准备好的 Cloud Trust，导致 Windows Hello 最初无法 Provision；
2. 关闭 Cloud Trust 后，Windows Hello 成功创建并注册了 Key Trust 凭据；
3. 旧 Enterprise CA 已经退役，但相关 AD 对象仍然存在；
4. Domain Controller 没有有效的 `Kerberos Authentication` 证书；
5. KDC 因此无法完成 Key Trust Authentication；
6. 重建 Enterprise CA 并重新签发 DC 证书后，KDC 恢复正常；
7. 客户端仍保留着调整前的认证状态，重启后才完整刷新。


# Troubleshooting Toolbox

下面是这次 Windows Hello for Business Key Trust 排障中使用到的主要命令。

示例中的名称均已匿名化：

```text
域名：contoso.local
用户：test.user
客户端：CLIENT-01
域控制器：DC01 / DC02
企业 CA：CONTOSO-ROOT-CA
```

---

## 1. 检查设备加入和 Windows Hello 状态

```pwsh
dsregcmd /status
```

重点检查以下字段：

```text
AzureAdJoined
DomainJoined
DeviceAuthStatus
NgcSet
AzureAdPrt
CloudTgt
OnPremTgt
```

Windows Hello Provisioning 相关状态位于：

```text
+----------------------------------------------------------------------+
| Ngc Prerequisite Check                                               |
+----------------------------------------------------------------------+

            IsDeviceJoined
             IsUserAzureAD
             PolicyEnabled
          PostLogonEnabled
            DeviceEligible
        SessionIsNotRemote
            CertEnrollment
          AdfsRefreshToken
             AdfsRaIsReady
    LogonCertTemplateReady
              PreReqResult
```

常见结果：

```text
NgcSet       : NO
PreReqResult : WillNotProvision
```

表示 Windows Hello 尚未完成 Provisioning。

```text
NgcSet       : YES
PreReqResult : WillProvision
```

表示设备已经满足 Provisioning 条件，或者 Windows Hello 已完成初始化。

需要查看更详细的设备注册过程时，可以使用：

```pwsh
dsregcmd /status /debug
```

---

## 2. 检查 Windows Hello 策略注册表

检查 Windows Hello 是否被配置为使用 Cloud Trust：

```pwsh
Get-ItemProperty `
    -Path "HKLM:\SOFTWARE\Policies\Microsoft\PassportForWork" `
    -ErrorAction SilentlyContinue
```

重点观察：

```text
Enabled
UseCertificateForOnPremAuth
UseCloudTrustForOnPremAuth
```

也可以单独读取：

```pwsh
Get-ItemPropertyValue `
    -Path "HKLM:\SOFTWARE\Policies\Microsoft\PassportForWork" `
    -Name "UseCloudTrustForOnPremAuth" `
    -ErrorAction SilentlyContinue
```

```pwsh
Get-ItemPropertyValue `
    -Path "HKLM:\SOFTWARE\Policies\Microsoft\PassportForWork" `
    -Name "UseCertificateForOnPremAuth" `
    -ErrorAction SilentlyContinue
```

我们最终确认的状态是：

```text
UseCloudTrustForOnPremAuth    : 0
UseCertificateForOnPremAuth  : 0
```

这表示：

- 没有使用 Cloud Trust；
- 没有使用 Certificate Trust；
- 当前部署目标是 Key Trust。

检查完 Intune 策略后，可以强制刷新策略：

```pwsh
gpupdate /force
```

---

## 3. 查询 Windows Hello Operational 日志

列出最近的 Windows Hello 事件：

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-HelloForBusiness/Operational" `
    -MaxEvents 100 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

只查看失败或警告事件：

```pwsh
Get-WinEvent `
    -FilterHashtable @{
        LogName = "Microsoft-Windows-HelloForBusiness/Operational"
        Level   = 2, 3
    } `
    -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

查看 Authentication 事件：

```pwsh
Get-WinEvent `
    -FilterHashtable @{
        LogName = "Microsoft-Windows-HelloForBusiness/Operational"
        Id      = 7001
    } `
    -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, Message |
    Format-List
```

当时看到的关键信息包括：

```text
Deployment Type          : Key Trust
Authentication Error     : 0xC000006D
Authentication SubStatus : 0xC00002F9
```

后面的测试中还出现过：

```text
Authentication Error : 0xC0000380
```

查询用于确认部署模式的事件：

```pwsh
Get-WinEvent `
    -FilterHashtable @{
        LogName = "Microsoft-Windows-HelloForBusiness/Operational"
        Id      = 5205
    } `
    -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, Message |
    Format-List
```

关键结果：

```text
Certificate Required : False
Use Cloud Trust      : False
Deployment Type      : Key Trust
```

按关键词过滤日志：

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-HelloForBusiness/Operational" `
    -MaxEvents 200 |
    Where-Object {
        $_.Message -match "Authentication|Key Trust|Cloud Trust|Provision"
    } |
    Select-Object TimeCreated, Id, Message |
    Format-List
```

---

## 4. 检查 Windows Hello Key 是否写入 Active Directory

首先导入 Active Directory 模块：

```pwsh
Import-Module ActiveDirectory
```

检查用户的 `msDS-KeyCredentialLink`：

```pwsh
Get-ADUser test.user `
    -Properties msDS-KeyCredentialLink |
    Select-Object SamAccountName, msDS-KeyCredentialLink
```

只显示 Key Credential 内容：

```pwsh
Get-ADUser test.user `
    -Properties msDS-KeyCredentialLink |
    Select-Object -ExpandProperty msDS-KeyCredentialLink
```

只统计写入了多少条 Key Credential：

```pwsh
(
    Get-ADUser test.user `
        -Properties msDS-KeyCredentialLink
).msDS-KeyCredentialLink.Count
```

输出通常类似：

```text
B:828:00020000200001...
```

这些内容很长，不需要手动解析。

只要属性不是空的，就说明 Windows Hello 公钥已经成功写入用户对象。

---

## 5. 检查 AD 和 Forest Functional Level

检查 Forest Functional Level：

```pwsh
Get-ADForest |
    Select-Object Name, ForestMode
```

检查 Domain Functional Level：

```pwsh
Get-ADDomain |
    Select-Object DNSRoot, DomainMode
```

当时环境中确认到：

```text
Forest Functional Level : Windows2008R2Forest
Domain Functional Level : Windows2012R2Domain
```

---

## 6. 检查域控制器的本机证书

在 Domain Controller 上查看本机计算机证书存储：

```pwsh
certutil -store My
```

筛选 Kerberos 相关内容：

```pwsh
certutil -store My |
    Select-String `
        -Pattern "Kerberos Authentication|Domain Controller Authentication|Issuer|Subject|Template"
```

使用 PowerShell 查看本机证书：

```pwsh
Get-ChildItem Cert:\LocalMachine\My |
    Select-Object Subject, Issuer, Thumbprint, NotBefore, NotAfter,
        EnhancedKeyUsageList
```

筛选带有 Kerberos Authentication EKU 的证书：

```pwsh
Get-ChildItem Cert:\LocalMachine\My |
    Where-Object {
        $_.EnhancedKeyUsageList.FriendlyName -contains "Kerberos Authentication"
    } |
    Select-Object Subject, Issuer, Thumbprint, NotBefore, NotAfter,
        EnhancedKeyUsageList
```

检查即将过期的证书：

```pwsh
Get-ChildItem Cert:\LocalMachine\My |
    Where-Object {
        $_.NotAfter -lt (Get-Date).AddDays(60)
    } |
    Select-Object Subject, Issuer, Thumbprint, NotAfter
```

---

## 7. 查询 KDC Operational 日志

列出最近的 KDC 事件：

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `
    -MaxEvents 100 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

只查看 Event 200 和 Event 302：

```pwsh
Get-WinEvent `
    -FilterHashtable @{
        LogName = "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational"
        Id      = 200, 302
    } `
    -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

Event 200 表示 KDC 找不到合适的证书，常见信息类似：

```text
The Key Distribution Center cannot find a suitable certificate
to use for smart card logons, or the KDC certificate could not
be verified.
```

Event 302 表示 KDC 已经成功加载证书，关键字段包括：

```text
Issuer
Template
Thumbprint
```

筛选证书相关 KDC 事件：

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `
    -MaxEvents 200 |
    Where-Object {
        $_.Message -match "certificate|Kerberos Authentication|KDC"
    } |
    Select-Object TimeCreated, Id, Message |
    Format-List
```

---

## 8. 检查 Enterprise CA 是否可用

列出域内可用的 Enterprise CA：

```pwsh
certutil -config - -ping
```

正常情况下会返回类似：

```text
DC01.contoso.local\CONTOSO-ROOT-CA
```

查看 Enterprise CA 配置：

```pwsh
certutil -config - -
```

检查 CA 服务：

```pwsh
Get-Service CertSvc
```

启动 CA 服务：

```pwsh
Start-Service CertSvc
```

重启 CA 服务：

```pwsh
Restart-Service CertSvc
```

检查 AD CS 角色：

```pwsh
Get-WindowsFeature AD-Certificate
```

列出所有已安装的 AD CS 相关角色服务：

```pwsh
Get-WindowsFeature |
    Where-Object {
        $_.Name -like "ADCS*"
    }
```

---

## 9. 检查 NTAuth Enterprise Store

验证 Enterprise NTAuth 存储：

```pwsh
certutil -enterprise -verifystore NTAuth
```

在输出中确认新的 CA：

```text
CONTOSO-ROOT-CA
```

查看 NTAuth 中发布的所有证书：

```pwsh
certutil -enterprise -viewstore NTAuth
```

也可以从 Active Directory 中读取 NTAuthCertificates 对象：

```pwsh
$configurationNamingContext = (
    Get-ADRootDSE
).configurationNamingContext

Get-ADObject `
    -Identity "CN=NTAuthCertificates,CN=Public Key Services,CN=Services,$configurationNamingContext" `
    -Properties cACertificate
```

---

## 10. 检查 Active Directory 中发布的旧 CA

获取 Configuration Naming Context：

```pwsh
$configurationNamingContext = (
    Get-ADRootDSE
).configurationNamingContext
```

查看 Enrollment Services 中注册的 Enterprise CA：

```pwsh
Get-ADObject `
    -SearchBase "CN=Enrollment Services,CN=Public Key Services,CN=Services,$configurationNamingContext" `
    -LDAPFilter "(objectClass=pKIEnrollmentService)" `
    -Properties * |
    Select-Object Name, dNSHostName, DistinguishedName
```

查看 Certification Authorities 容器：

```pwsh
Get-ADObject `
    -SearchBase "CN=Certification Authorities,CN=Public Key Services,CN=Services,$configurationNamingContext" `
    -LDAPFilter "(objectClass=certificationAuthority)" `
    -Properties * |
    Select-Object Name, DistinguishedName
```

查看 AIA 容器：

```pwsh
Get-ADObject `
    -SearchBase "CN=AIA,CN=Public Key Services,CN=Services,$configurationNamingContext" `
    -LDAPFilter "(objectClass=certificationAuthority)" `
    -Properties * |
    Select-Object Name, DistinguishedName
```

查看 CDP 容器：

```pwsh
Get-ADObject `
    -SearchBase "CN=CDP,CN=Public Key Services,CN=Services,$configurationNamingContext" `
    -Filter * |
    Select-Object Name, ObjectClass, DistinguishedName
```

这些命令可以帮助确认 Active Directory 中是否仍然残留已经退役的 CA 对象。

不要在没有备份和影响评估的情况下直接删除这些对象。

---

## 11. 触发证书自动注册

刷新计算机组策略：

```pwsh
gpupdate /force
```

触发证书自动注册：

```pwsh
certutil -pulse
```

以本机系统账户重新触发自动注册：

```pwsh
certutil -pulse
```

检查自动注册相关事件：

```pwsh
Get-WinEvent `
    -LogName "Microsoft-Windows-CertificateServicesClient-AutoEnrollment/Operational" `
    -MaxEvents 100 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

筛选失败事件：

```pwsh
Get-WinEvent `
    -FilterHashtable @{
        LogName = "Microsoft-Windows-CertificateServicesClient-AutoEnrollment/Operational"
        Level   = 2, 3
    } `
    -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, Message |
    Format-List
```

完成自动注册后，再次检查证书：

```pwsh
certutil -store My
```

应当能看到：

```text
Kerberos Authentication
Domain Controller Authentication
Directory Email Replication
```

---

## 快速诊断顺序

遇到类似问题时，可以按照这个顺序进行：

```text
1. dsregcmd /status
2. 检查 NgcSet 和 PreReqResult
3. 检查 Intune Windows Hello 策略
4. 查询 HelloForBusiness Operational 日志
5. 检查 msDS-KeyCredentialLink
6. 查询 KDC Operational 日志
7. 检查 DC 的 Kerberos Authentication 证书
8. 检查 Enterprise CA 和 NTAuth
9. 触发 DC 证书自动注册
10. 确认 KDC Event 302
11. 重启客户端并重新测试 PIN
```

这套顺序的重点不是把所有命令都运行一遍，而是先判断故障发生在：

```text
Provisioning
        或
Authentication
```

确定阶段之后，再继续缩小范围。