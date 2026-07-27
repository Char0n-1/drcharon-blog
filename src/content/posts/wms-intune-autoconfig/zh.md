---
title: 使用 Intune 自动配置 Dynamics 365 Warehouse Management Mobile App
published: 2026-07-27
description: 使用 Microsoft Intune 自动下发 Warehouse Management Mobile App 的连接配置，实现新设备零接触部署，避免人工配置 Environment URL、Company 等参数。
image: ""
tags:
  - COPE
  - Android-Enterprise
  - Intune
  - Dynamic-365
  - Warehouse-Management
category: Microsoft 365
draft: false
lang: zh
---

# 前言

最近公司准备更换一批 Android 企业手机。

由于这些设备采用 **Android Enterprise COPE（Corporate-Owned, Personally Enabled）** 模式管理，因此员工拿到新手机后，只需要登录自己的 Microsoft 账户即可完成设备注册，所有工作应用都会由 Microsoft Intune 自动安装。

整个部署流程已经基本实现了自动化，唯独有一个例外。

那就是 **Dynamics 365 Warehouse Management Mobile App（以下简称 WMS）**。

虽然应用可以由 Intune 自动安装，但第一次打开时仍然需要手动创建 Connection，填写：

- Connection Name
- Environment URL
- Company
- Authentication Method
- Cloud

对于几十甚至上百台设备来说，这意味着 IT 需要逐台进行配置。

本文记录如何利用 **Microsoft Intune App Configuration Policy**，将这些连接信息自动下发到 WMS，实现真正的零接触部署。

---

# 环境

本次环境如下：

- Microsoft Intune
- Android Enterprise COPE
- Managed Google Play
- Microsoft Entra ID
- Dynamics 365 Warehouse Management Mobile App 4.1.4.0

---

# 部署目标

部署完成后，希望达到以下效果：

1. Intune 自动安装 WMS
2. Intune 自动创建 Connection
3. 用户无需手动配置connection profile
4. 用户只需要完成 Microsoft 登录即可开始使用 WMS

---

# 添加 Warehouse Management 应用

首先，需要确保 WMS 已经作为 **Managed Google Play App** 添加到 Intune。

进入：
Microsoft Intune Admin Center  
→ Apps  
→ Android  
→ Add  
→ Managed Google Play app


搜索：
```

Warehouse Management

```

添加应用。

---

# 创建 App Configuration Policy

进入：
```

Apps  
→ App configuration policies  
→ Create

```

选择：


Device enrollment type

`Managed devices`

Platform

`Android Enterprise`

Profile Type

`All Profile Types`

Targeted app

`Warehouse Management`


创建新的 Configuration Policy。

---

# 使用 Configuration Designer

进入 **Settings** 页面。

在 **Configuration settings format** 中选择：
```

Use configuration designer

```

点击：
```

- Add

```

添加配置项：
```

ConnectionsJSON

```

Value Type：
```

String

````

---

# 配置 ConnectionsJSON

ConnectionsJSON 用于保存 WMS 的所有连接信息。

例如：

```json
{
  "ConnectionList": [
    {
      "ConnectionName": "WMS-PROD",
      "ActiveDirectoryResource": "https://your-environment.operations.dynamics.com",
      "Company": "ABC",
      "ConnectionType": "UsernamePassword",
      "AuthCloud": "AzureGlobal",
      "UseBroker": true,
      "IsEditable": false,
      "IsDefaultConnection": true
    }
  ]
}
````

> **注意**
> 
> 为了保护企业信息，本文中的 Environment URL、Company 等内容均已脱敏，请根据自己的环境修改。

各字段说明如下：

|字段|说明|
|---|---|
|ConnectionName|连接名称，显示在 WMS 首页|
|ActiveDirectoryResource|Dynamics 365 Environment URL|
|Company|默认登录公司|
|ConnectionType|建议使用 UsernamePassword|
|AuthCloud|Azure 云环境，通常为 AzureGlobal|
|UseBroker|使用 Microsoft Authenticator / Company Portal 完成 Broker 登录|
|IsEditable|是否允许用户修改连接|
|IsDefaultConnection|是否作为默认连接|

---

# 为什么选择 UsernamePassword + Broker

Warehouse Management 支持多种认证方式，例如：

- Username and Password
- Device Code

虽然 Device Code 适合共享设备，但对于已经使用 Microsoft Intune 和 Microsoft Entra ID 管理的企业环境，更推荐使用 **UsernamePassword + Broker**。

原因包括：

- 可以调用 Microsoft Authenticator 或 Company Portal 完成认证。
- 登录体验更加流畅。
- 更符合现代 Microsoft 身份认证方案。
- 无需每次访问 Device Login 页面输入验证码。

---

# 分配策略

建议不要直接部署到所有设备。

可以先创建一个测试组，仅包含一台测试设备。

确认：

- WMS 自动创建 Connection。
- 可以正常完成 Microsoft 登录。
- 可以成功进入 Warehouse。
- Connection 无需手动创建。

验证完成后，再分配到生产环境。

---

# 最终效果

部署完成后，新设备完成 Intune Enrollment 后：

1. WMS 自动安装。
2. Connection 自动创建。
3. 用户无需输入 Environment URL。
4. 用户无需输入 Company。
5. 用户完成 Microsoft 登录后即可开始使用。

整个过程无需 IT 手工配置，大幅降低了批量部署新设备的工作量。

---

# 总结

Microsoft Intune 不仅可以负责应用安装，还可以通过 **App Configuration Policy** 自动完成应用初始化配置。

对于 Dynamics 365 Warehouse Management Mobile App，这意味着可以将原本需要 IT 手工创建的 Connection 自动下发到所有设备。

当企业需要一次部署几十甚至上百台 Android 企业设备时，这种自动化配置不仅能够减少重复劳动，还能够避免人工输入错误，提高部署的一致性和效率。