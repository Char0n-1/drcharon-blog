---
title: Outlook 附件可以下载但无法预览：一次 OWA 用户配置损坏的排障案例
published: 2026-09-30
description: 一次真实的 Microsoft 365 排障案例：用户可以正常下载附件，但在 New Outlook 和 Outlook Web 中都无法预览 Word 和 PDF。最终通过重置邮箱中的 OWA 用户配置解决问题。
tags:
  - Outlook
  - Troubleshooting
category: Microsoft 365
draft: false
lang: zh
---
# 修复由 OWA 用户配置损坏导致的 Outlook 附件预览失败问题

## 背景

最近处理了一个只影响单个 Microsoft 365 用户的 Outlook 问题。

用户可以正常接收附件，也可以毫无问题地下载附件。下载后的 PDF 和 Word 文件都能够在对应的软件中正常打开。

但是，附件预览在以下两个客户端中都会稳定失败：

- New Outlook
- Outlook on the web

预览窗口会显示：

> 无法创建文档预览。请稍后重试。

由于 New Outlook 和 OWA 都出现相同的问题，因此这个故障很快就不像是单纯的本地 Outlook 客户端问题。

---

## 问题现象

受影响的用户无法预览：

- PDF 文件
- Word 文档
- 新收到的附件
- “已发送邮件”中的附件

与此同时：

- 下载后的文件可以正常打开
- 其他用户可以正常预览完全相同的附件
- InPrivate 模式下仍然可以复现
- 重启电脑没有效果

其中一个特别有价值的测试，是把其中一个有问题的附件发送给另一个用户。

结果如下：

```
受影响用户 -> 已发送邮件 -> 预览失败
正常用户   -> 同一个附件 -> 预览成功
```

这说明文件本身并没有损坏。

问题是跟着受影响用户走的。

---

## 分析

### 对比 OWA mailbox policy

首先检查 Exchange Online 中实际分配给用户的 OWA mailbox policy。

```powershell
Get-CASMailbox sabriena.gauvreau@adfastcorp.com |
Format-List DisplayName,PrimarySmtpAddress,OWAEnabled,OwaMailboxPolicy
```

受影响用户使用的是：

```powershell
OwaMailboxPolicy-Default
```

一个已知正常的用户使用的也是同一个 policy。

接着检查 WAC 和附件访问相关设置：

```powershell
Get-OwaMailboxPolicy |
Format-Table Name,
WacViewingOnPrivateComputersEnabled,
WacViewingOnPublicComputersEnabled,
DirectFileAccessOnPrivateComputersEnabled,
DirectFileAccessOnPublicComputersEnabled
```

关键设置均为启用状态：

```powershell
WacViewingOnPrivateComputersEnabled  : True
WacViewingOnPublicComputersEnabled   : True
DirectFileAccessOnPrivateComputersEnabled : True
```

因此，这个问题并不是由不同的 OWA policy 分配导致的。

---

### 对比 Exchange client access 设置

我还对比了受影响用户和正常用户的 Exchange client access 配置：

```powershell
Get-CASMailbox baduser@contasco.com | Format-List *
Get-CASMailbox gooduser@contasco.com | Format-List *
```

关键的 client access 设置都正常：

```powershell
OWAEnabled              : True
UniversalOutlookEnabled : True
EwsEnabled              : True
MAPIEnabled             : True
OwaMailboxPolicy        : OwaMailboxPolicy-Default
```

没有发现明显的 mailbox access 配置差异能够解释附件预览失败的问题。

---

### 浏览器开发者日志

下一步是在 Outlook on the web 中通过浏览器 Developer Tools 检查后台请求。

其中发现多个与用户相关的 OWA endpoint 返回错误。

例如：

```
GET ows/v1/OutlookCloudSettings/settings/...
401 Unauthorized
```

以及：

```
GET https://outlook.office.com/ows/v1.0/OutlookOptions
401 Unauthorized
```

另外，一些和 Outlook 用户选项相关的请求也失败了，例如：

```
PATCH /ows/v1.0/OutlookOptions/MailLayout
401 Unauthorized
```

并不是每一个 `401` 都一定和附件预览直接相关，但这些错误至少说明，部分和用户相关的 OWA 配置请求行为并不正常。

其中最值得注意的一条错误是：

```
POST https://outlook.office.com/owa/service.svc?action=ValidateAggregatedConfiguration&app=Mail
500 Internal Server Error
```

这说明 Outlook 在验证或者加载 aggregated user configuration 时出现了问题。

到了这一步，问题越来越像是 mailbox-specific，而不是本地客户端故障。

---

## 解决方案

Microsoft Support 最终提供了一段 PowerShell 脚本，用于重置几个 mailbox-level OWA configuration object。

相关命令如下：

```powershell
Connect-ExchangeOnline

$mailbox = Get-Mailbox affecteduser@contasco.com

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.Suite.Storage `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.Agregated.OWAUserConfiguration `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.OWA.SessionInformation `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.OWA.UserOptions `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.OWA.ViewStateConfiguration `
-Confirm:$false
```

脚本执行完成后，让用户执行：

```
退出 Outlook on the web
重新登录
再次测试附件预览
```

重新登录后，附件预览立即恢复正常。

---

## 这段脚本实际重置了什么

这段脚本不会删除邮件、文件夹、日历项目、联系人或附件。

它删除的是一些隐藏的 mailbox-level configuration object，这些对象会被 Outlook on the web 和现代 Outlook 服务使用。

主要包括以下几项。

### Suite.Storage

```
Configuration\IPM.Configuration.Suite.Storage
```

保存一部分 Microsoft 365 / Outlook 用户状态。

### Aggregated OWA user configuration

```
Configuration\IPM.Configuration.Agregated.OWAUserConfiguration
```

这一项尤其值得注意，因为之前浏览器日志中已经出现过：

```
ValidateAggregatedConfiguration
500 Internal Server Error
```

最终的修复操作正好直接重置了对应的 aggregated OWA configuration object。

### OWA session information

```
Configuration\IPM.Configuration.OWA.SessionInformation
```

保存与 OWA session 相关的状态。

用户退出并重新登录后，Outlook 会重新创建这些信息。

### OWA user options

```
Configuration\IPM.Configuration.OWA.UserOptions
```

保存用户级的 Outlook 偏好设置和选项。

### OWA view state

```
Configuration\IPM.Configuration.OWA.ViewStateConfiguration
```

保存 Outlook Web 界面和 view state 的一部分状态。

这些对象被删除后，Outlook 会在下一次登录时重新生成。

---

## 根本原因

Microsoft 并没有提供正式的 backend root-cause report，但现有证据非常明显地指向 mailbox-level OWA user configuration 损坏或状态不一致。

完整的排障路径大致如下：

```
只有单个用户受影响
        |
        v
相同文件对其他用户正常
        |
        v
New Outlook 和 OWA 都受影响
        |
        v
OWA policy、license、CA 和 mailbox provisioning 均正常
        |
        v
OutlookCloudSettings / OutlookOptions 出现错误
        |
        v
ValidateAggregatedConfiguration -> 500
        |
        v
重置 mailbox-level OWA configuration
        |
        v
退出 / 重新登录
        |
        v
附件预览恢复正常
```

因此，一个比较合理的根因描述是：

> 受影响邮箱中保存在 Exchange Online 里的 OWA 用户配置存在不一致或损坏。通过重置 mailbox-level OWA configuration，强制 Outlook 重新生成相关配置对象后，附件预览功能恢复正常。