---
title: Intune Android COPE 预配置实战：解决 Samsung 在 Microsoft 登录前关机后注册回滚的问题
published: 2026-07-23
description: Intune Android COPE 预配置踩坑：为什么 Sonim 可以，Samsung 却不行？
tags:
  - Intune
  - Android-Enterprise
  - COPE
  - Astro
category: Microsoft 365
draft: false
lang: zh
---
最近在准备一批公司 Android 手机时，我希望 IT 能够先完成设备初始化，再把手机交给最终用户登录 Microsoft 账号。

我们使用的是 Microsoft Intune 管理的 Android Enterprise COPE 设备，也就是：

> **Corporate-owned devices with work profile**

原来的流程在 Sonim XP Pro 上一直可以正常工作，所以我一直认为这是一种可行的交付方式。

直到换成 Samsung S26，同样的操作却失败了。

---

# 环境

本次环境如下：

- Microsoft Intune
- Android Enterprise COPE
- QR Code Enrollment
- Sonim XP Pro
- Samsung S26
- Managed Google Play

---

# 原来的设备交付流程

我们原来的操作流程是：

```
Factory Reset
        ↓
扫描 Intune Enrollment QR Code
        ↓
完成 Android 初始设置
        ↓
到达 Microsoft 登录页面
        ↓
关机
        ↓
将设备交给用户
        ↓
用户开机并登录 Microsoft 账号
```

在 Sonim XP Pro 上，这个流程没有出现问题。

设备停在 Microsoft 登录页面时直接关机，之后重新开机，仍然会回到原来的登录页面。用户可以从这里继续完成 Enrollment。

因此，我默认 Samsung 也可以使用同样的方式。

---

# Samsung 出现的问题

在 Samsung S26 上，我使用相同的 Enrollment Profile 和相同的操作步骤。

设备到达 Microsoft 登录页面后关机，再次开机时却直接显示：

```
Something went wrong.

Contact your IT administrator.
```

随后，之前的 Enrollment 状态被回滚，设备无法继续从 Microsoft 登录页面完成注册。

Sonim 可以继续，Samsung 却不行。

> Microsoft 明确说明，Android Enterprise Fully Managed 或 Corporate-owned work profile 设备在注册中途重启，可能无法正确注册到 Intune，甚至可能看起来已经注册、实际上却没有受到策略保护。Sonim 能继续只是厂商 Setup Wizard 恰好保留了状态，不能当作可靠的标准流程；三星回滚到注册前状态，正是中途中断导致的结果。[Microsoft Learn](https://learn.microsoft.com/en-us/intune/device-enrollment/android/ref-corporate-methods)


---

# Microsoft 登录页面并不是一个安全的交付节点

使用普通的 COPE Enrollment Token 时，Microsoft 登录页面仍然属于 Enrollment 流程的一部分。

此时：

- Enrollment 尚未完成；
- 设备还没有绑定最终用户；
- Intune 注册流程仍然处于中间状态；
- Android Setup Wizard 也没有正式结束。

Sonim 在关机后能够恢复这个状态，只是它保留了 Enrollment 的中间进度。

Samsung 检测到 Enrollment 被中断后，则直接回滚并要求重新开始。


---

# 正确的方案：Via staging

Intune 为这种由 IT 提前准备设备、最终再由用户登录的场景提供了专门的 Enrollment 方式：

> **Corporate-owned with work profile, via staging**

普通 COPE Token 的流程更接近：

```
IT 扫描 QR Code
        ↓
设备进入 Microsoft 登录
        ↓
用户继续完成整个 Enrollment
```

Via staging 的流程则是：

```
IT 扫描 Staging QR Code
        ↓
完成 Android Setup Wizard
        ↓
进入 Android 桌面
        ↓
Required Apps 开始安装
        ↓
关机并交给用户
        ↓
用户打开 Microsoft Intune
        ↓
登录自己的 Microsoft 账号
```

最大的区别是：

> **Via staging 允许 IT 在没有最终用户账号的情况下，先把设备完整注册到桌面。**

设备进入桌面后，Enrollment 的预配置阶段已经完成，可以正常关机并交付，而不需要停在 Microsoft 登录页面。
## 创建 Staging Token

在 Intune 管理中心进入：

**Devices → Enrollment → Android → Android Enterprise → Enrollment profiles → Corporate-owned devices with work profile**

然后：

1. 点击 **Create profile**。
2. 在 **Token type** 选择：
    
    **Corporate-owned with work profile, via staging**
    
    不要选择普通的：
    
    **Corporate-owned with work profile (default)**
    
3. 设置 Token expiration date。
4. 创建 Profile。
5. 打开这个 Profile，进入 **Token**，使用它生成的全新二维码。
[Microsoft Learn](https://learn.microsoft.com/en-us/intune/device-enrollment/android/setup-corporate-work-profile)

---

# 使用 Via staging 后的实际流程

我重新创建了一个 COPE Enrollment Profile，并将 Token Type 设置为：

```
Corporate-owned with work profile, via staging
```

然后重新测试 Samsung S26。

流程变成：

```
1. Factory Reset
2. 扫描 Via staging QR Code
3. 连接 Wi-Fi
4. 完成 Android Setup Wizard
5. 进入 Android 桌面
6. 等待 Intune 和 Managed Google Play 同步
7. 确认 Required Apps 安装
8. 关机
9. 将设备交给用户
```

用户拿到设备后，只需要：

```
1. 开机
2. 打开 Microsoft Intune App
3. 登录自己的 Microsoft 工作账号
4. 完成用户关联
```

这样就不再需要在一个尚未完成的 Enrollment 页面上关机。

---

# Required Apps 可以提前安装

Via staging 进入桌面后，设备虽然还没有绑定最终用户，但已经受到 Intune 管理。

我们将通用 Android 应用设置为：

```
Required
→ All devices
```

设备进入桌面后，这些 Managed Google Play 应用会开始自动安装。

例如：

- Google Chrome
- Microsoft Outlook
- Microsoft Teams
- Microsoft OneDrive
- Microsoft Authenticator

因此，IT 可以在交付前确认基础应用已经安装。

这里的 `All devices` 不会让 Windows 设备安装 Android 应用。

当前 App 对象本身是 Managed Google Play Store App，只适用于 Android。Windows 设备不会安装这个 Android App。

---

# Via staging 和静态 Security Group

Via staging 不支持 Enrollment Time Grouping。

也就是说，设备在 Enrollment 过程中不能像普通 COPE Token 那样，自动加入指定的静态设备组。

最开始我担心，这会影响现有的 App Assignment。

最后采用的方案是：

## 通用 Android 应用

分配给：

```
Required
→ All devices
```

这些 App 会在设备进入桌面后开始安装。

>在 **COPE via staging** 中，IT 扫码并完成 Setup Wizard、进入桌面后，设备虽然仍是 **userless**，但已经受 Intune 管理。此时，符合 Stage 2 定向条件的 **Required Managed Google Play Apps 会开始自动安装**。Microsoft 当前文档也写明，Stage 2 可以定向应用和策略，只是支持的定向方式有限。[Microsoft Learn](https://learn.microsoft.com/en-us/intune/device-enrollment/android/device-staging)

## 用户或部门专属应用

继续分配给现有的 User Security Group。

用户完成 Microsoft Intune 登录后，Intune 会根据用户所在的 Security Group 继续下发对应应用。

最终结构如下：

```
通用应用
→ All devices
→ Staging 阶段安装

用户专属应用
→ User Security Group
→ 用户登录后安装
```

如果某个 Android App 只适用于特定 Enrollment Profile，也可以再使用 Assignment Filter 缩小范围。

---

# 最终交付流程

调整后的标准流程如下：

```
IT 恢复设备出厂设置
        ↓
扫描 Via staging QR Code
        ↓
完成 Android Setup Wizard
        ↓
进入桌面
        ↓
等待 Required Apps 安装
        ↓
检查设备
        ↓
关机并交付
        ↓
用户打开 Microsoft Intune
        ↓
登录 Microsoft 账号
        ↓
完成 Enrollment
```

这个流程同时适用于 Samsung 和 Sonim，不再依赖不同厂商对 Enrollment 中间状态的处理方式。

---

# Knowledge Base

## Default Token（你现在用的）

流程是：

```
IT
│
├─ 扫二维码
├─ Wi-Fi
├─ Google
├─ Microsoft 登录
└──────────────► 用户继续完成
```

问题就是：

用户必须一路走完整个 Setup Wizard。

如果中途关机（例如 Samsung），很多 OEM 会认为 Enrollment 没完成，重新开始。Sonim 恰好会保留状态，但这是厂商行为，不是 Intune 保证的。

---
## Via Staging

微软把流程拆成了三段：

```
Stage 1
IT
│
├─ 创建 Staging Token
└───────────────┐

Stage 2
IT 或 Vendor
│
├─ 扫 QR
├─ 完成 Android Setup
├─ 到桌面
├─ App 可以开始准备
└─ 关机

↓

Stage 3
User
│
├─ 开机
├─ 打开 Microsoft Intune
├─ 登录 Microsoft
└─ 完成关联
```

整个 Stage 1、2 **没有最终用户账号**。

设备处于 **Userless** 状态。

直到：

```
Microsoft Intune App
↓

用户登录

↓

Device User Affiliated
```

才真正绑定给用户。