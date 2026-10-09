---
title: Windows 文件共享：ABE、隐藏共享与 Share 和 NTFS 权限详解
published: 2026-10-09
description: 弄明白Windows Server SMB file share的三个重要概念
tags:
  - Windows-Server
  - Active-Directory
  - SMB
category: Infrastructure
draft: false
lang: zh
---
# Windows 文件共享：ABE、隐藏共享与 Share 和 NTFS 权限详解

在 Windows Server 上管理共享文件夹时，有三个概念非常容易混淆：

- **隐藏共享（Hidden Shares，**`$`**）：** 让 SMB 共享不出现在正常的网络浏览列表中。
    
- **基于访问权限的枚举（Access-Based Enumeration，ABE）：** 根据用户的访问权限，决定哪些文件和文件夹对用户可见。
    
- **共享权限与 NTFS 权限（Share vs. NTFS Permissions）：** 两套独立的权限机制，共同决定用户通过网络可以执行哪些操作。


这三种机制的作用并不相同。理解它们的工作原理和限制，对于设计、维护或重组 Windows 文件共享非常重要。

## 1. 隐藏共享：`$` 到底有什么作用？

在 SMB 共享名称末尾添加 `$`，可以将其设置为隐藏共享（Hidden Share）。

例如：

```
\\apps\Accounting
\\apps\Accounting$
```

当用户在文件资源管理器中浏览服务器：

```
\\apps
```

正常情况下，`Accounting` 会出现在共享列表中，而 `Accounting$` 不会显示。

但是，如果用户知道完整的 UNC 路径，仍然可以尝试直接访问：

```
\\apps\Accounting$
```

是否能够成功访问，取决于该用户的 Share Permissions 和 NTFS Permissions。

### 注意：`$` 不会隐藏普通文件夹

假设服务器上的物理目录结构如下：

```
D:\Shares\
    Accounting\
    Accounting$\
    Finance\
```

如果管理员将 `D:\Shares` 发布为 SMB 共享 `\\apps\Data`，用户浏览这个共享时，仍然可能看到 `Accounting$` 文件夹。

原因是：

`$` **只有出现在 SMB 共享名称末尾时，才具有隐藏共享的特殊含义。对于普通文件夹名称，它只是一个普通字符。**

隐藏共享并不意味着用户无法访问该资源，也不能代替任何安全权限设置。

## 2. Access-Based Enumeration（ABE）

ABE 用于根据用户的访问权限，控制共享文件夹中的文件和子文件夹是否可见。

默认情况下，如果未启用 ABE，用户即使没有权限打开某个文件夹，也可能在文件资源管理器中看到它的名称。

启用 ABE 后，Windows 会根据用户的权限过滤目录列表。

### 示例

假设共享目录结构如下：

```
\\apps\Accounting\
    General\
    Payables\
    Management\
    Confidential\
```

某个用户只拥有 `General` 和 `Payables` 的访问权限。

启用 ABE 后，该用户浏览共享目录时，只会看到：

```
\\apps\Accounting\
    General\
    Payables\
```

其他没有相应访问权限的文件夹将不会显示。

### ABE 的工作原理

ABE 会在用户枚举目录内容时，根据该用户的有效访问权限判断哪些项目可以显示。

对于常见的 NTFS 文件系统上的 SMB 共享，Windows 会使用相关的文件系统权限进行判断。

需要注意：

- ABE 根据用户的安全令牌和实际权限判断可见性。
    
- ABE 只过滤目录列表，不会修改原有 NTFS Permissions。
    
- ABE 不会替代 Share Permissions。
    
- 即使资源被 ABE 隐藏，也不代表用户一定无法通过其他路径或共享访问它。
    
- 如果用户通过某个 AD Group 或继承的 ACL 已经具有相应的访问权限，ABE 就可能继续显示该文件夹。


因此，**ABE 本质上是可见性控制功能，而不是独立的安全边界。**

### 如何启用 ABE

**GUI 方法：**

1. 打开 Server Manager。
    
2. 进入 File and Storage Services → Shares。
    
3. 选择需要配置的 SMB Share，打开 Properties。
    
4. 在 Settings 中勾选 **Enable access-based enumeration**。
    
5. 保存设置。


**PowerShell 方法：**

```powershell title="Powershell"
Set-SmbShare -Name "Accounting" `
    -FolderEnumerationMode AccessBased
```

查看当前状态：


```powershell title="Powershell"
Get-SmbShare -Name "Accounting" |
    Select-Object Name, FolderEnumerationMode
```

启用成功后应该显示：

```powershell title="Powershell"
FolderEnumerationMode : AccessBased
```

### 如何正确测试 ABE

建议使用普通域用户（Standard Domain User）进行测试，并确保该用户具有预期的 AD Security Group 成员身份。

不要仅依靠管理员账号验证。

管理员可能因为 Administrators 组、继承的 ACL 或其他权限而拥有比普通用户更广泛的访问权限。

不过，管理员并不是无条件绕过 ABE。ABE 仍然根据实际权限进行判断。

正确的测试应该包括两部分：

1. **Visibility Test：** 用户是否能在共享目录中看到不应该看到的文件夹。
    
2. **Access Test：** 用户是否能够通过完整 UNC 路径直接打开受限制的文件夹。


特别注意：

**文件夹不可见，不代表它一定不可访问。**

隐藏和权限控制必须分别验证。

## 3. Share Permissions 与 NTFS Permissions

Windows 对通过 SMB 访问的文件使用两套独立的权限机制。

|      | Share Permissions        | NTFS Permissions                 |
| ---- | ------------------------ | -------------------------------- |
| 作用范围 | 通过 SMB 共享进行的网络访问         | 本地及网络文件系统访问                      |
| 配置位置 | SMB Share                | 文件和文件夹                           |
| 权限类型 | Read、Change、Full Control | Read、Write、Modify、Full Control 等 |
| 权限继承 | 不随子文件夹继承                 | 支持继承（Inheritance）                |
| 主要用途 | 控制共享层面的访问                | 精细控制文件与目录权限                      |

### 有效权限如何计算？

用户通过 SMB 访问文件时，Windows 会同时检查两层权限。

一个操作必须同时被 Share Permissions 和 NTFS Permissions 允许，才能成功执行。

可以简单理解为：

**Effective Network Permissions = Share Permissions ∩ NTFS Permissions**

即两套权限取交集。

|Share Permissions|NTFS Permissions|最终 SMB 访问权限|
|---|---|---|
|Full Control|Modify|Modify|
|Read|Modify|Read|
|Change|Read|Read|
|Full Control|Read|Read|
|Read|Full Control|Read|

这个表格是简化模型。实际权限计算还涉及用户所属的多个安全组、Allow/Deny ACE，以及 NTFS 的详细权限位。

但核心规则不变：

**Share 和 NTFS 两层都必须允许某项操作，该操作才能通过 SMB 成功执行。**

这也是为什么用户明明拥有 NTFS Modify 权限，却依然无法通过共享目录创建或修改文件。

### 本地访问与网络访问的区别

Share Permissions 只作用于通过 SMB 访问的连接。

例如，直接在服务器上访问：

```
D:\Shares\Accounting
```

主要由 NTFS Permissions 决定访问权限。

而通过网络访问：

```
\\apps\Accounting
```

则必须同时满足 Share Permissions 和 NTFS Permissions。

这个区别很重要。

如果某个文件夹在服务器本地可以正常修改，但通过 UNC 路径访问时只能读取，除了检查 NTFS 权限，还应该检查 SMB Share Permissions。

## 4. 为什么 NTFS 正确，用户却只有 Read 权限？

这是 Windows 文件共享管理中一个很容易忽略的问题。

假设用户所属的 AD Group 已经拥有 NTFS Modify 权限：

```
NTFS Permissions:
Accounting_Users → Modify
```

但是对应 SMB Share 的权限为：

```
Share Permissions:
Everyone → Read
```

那么用户最终通过 SMB 获得的权限将被限制为 Read。

表现通常是：

- 可以打开共享文件夹。
    
- 可以读取文件。
    
- 无法新建文件。
    
- 无法保存修改。
    
- NTFS 的 Security 页面看起来完全正常。


### 为什么容易忽略？

因为管理员通常习惯检查：

```
Folder Properties → Security
```

但这个页面显示的是 NTFS Permissions，并不是 SMB Share Permissions。

要查看共享权限，需要进入：

```
Server Manager
  → File and Storage Services
  → Shares
  → Share Properties
  → Permissions
```

也可以直接运行：

```
Get-SmbShareAccess -Name "Accounting"
```

如果发现：

```
Name        AccountName  AccessControlType  AccessRight
----        -----------  -----------------  -----------
Accounting  Everyone     Allow              Read
```

则说明 Share 层对 Everyone 只允许 Read。

即使 NTFS ACL 允许 Modify，也无法突破这一限制。

### 重组共享目录时需要注意什么？

以下操作可能导致共享配置与原先不同：

- 删除并重新创建 SMB Share。
    
- 使用新的路径重建共享。
    
- 迁移文件夹后重新配置共享。
    
- 通过脚本或 Server Manager 创建新的 Share，但未明确指定权限。


需要区分的是：

**单纯移动文件夹，并不必然导致现有 Share Permissions 被重置。**

但如果共享被删除并重新创建，新 Share 不一定会保留原来的权限配置。

因此，在调整共享目录结构后，即使 NTFS ACL 没有变化，也应该重新检查 SMB Share Permissions。

## 5. 推荐的权限设计

对于拥有多个部门共享目录，并且使用 AD Security Groups 管理权限的环境，比较常见的设计方式是：

**Share Permissions 负责共享层的整体访问范围，NTFS Permissions 负责具体文件夹的访问控制。**

### Share Permissions

一种常见的配置方法是：

```
Everyone → Full Control
```

然后在 NTFS 层限制哪些用户可以读取、修改或删除文件。

这种设计的优点是避免在两个不同层面重复管理细粒度权限。

但需要注意：

- Everyone: Full Control 并不代表用户一定能修改所有文件。
    
- NTFS Permissions 仍然会限制实际操作。
    
- 但如果 NTFS ACL 意外配置得过于宽松，Share 层就无法再提供额外限制。
    
- 某些组织的安全策略可能要求 Share Permissions 也只允许指定的 AD Groups。


因此，`Everyone: Full Control` 是一种可选的权限管理模型，而不是所有环境都必须采用的标准。

### NTFS Permissions

建议使用 AD Security Groups 控制具体权限。

例如：

```
D:\Shares\Accounting
    Accounting_Read    → Read & Execute
    Accounting_Modify  → Modify
    SYSTEM             → Full Control
    Administrators     → Full Control
```

这种结构更适合长期维护。

推荐原则：

- 尽量通过 AD Security Groups 分配权限，而不是直接添加单个用户。
    
- 权限需求相同的目录，尽量使用 Inheritance。
    
- 敏感文件夹需要不同权限时，可以调整或禁用继承。
    
- 修改继承前，先检查当前有哪些 ACE 会被继承。
    
- 谨慎使用 Explicit Deny，因为它可能影响用户通过其他 AD Groups 获得的访问权限。
    

**不要为了让 ABE 生效，就无条件关闭所有文件夹的 Inheritance。**

正确的做法是先设计 ACL，再根据实际权限需求决定是否需要中断继承。

### ABE 配置建议

如果一个父共享目录包含多个部门或不同权限级别的子文件夹，可以在该 SMB Share 上启用 ABE。

例如：

```
\\apps\Departments\
    Accounting\
    Finance\
    HR\
    IT\
```

各部门通过独立的 AD Security Groups 管理 NTFS 权限。

启用 ABE 后，用户一般只会看到自己有权限访问的部门文件夹。

但有一个容易遗漏的细节：

如果父目录的某个广泛用户组，例如 `Domain Users`，通过继承获得了所有子文件夹的 Read 权限，那么 ABE 可能无法按照预期隐藏这些子文件夹。

因此，**ABE 的效果取决于实际 ACL，而不仅仅是是否勾选了 Enable access-based enumeration。**

## 6. 常用 PowerShell 命令

以下命令可以快速查看 SMB Share、ABE 和 NTFS 的配置。

### 查看所有 SMB Shares

```powershell
Get-SmbShare |
    Select-Object Name, Path, FolderEnumerationMode
```

### 查看指定 Share 的权限

```powershell
Get-SmbShareAccess -Name "Accounting"
```

### 查看 ABE 是否启用

```powershell
Get-SmbShare -Name "Accounting" |
    Select-Object Name, FolderEnumerationMode
```

### 启用 ABE

```powershell
Set-SmbShare -Name "Accounting" `
    -FolderEnumerationMode AccessBased
```

### 查看 NTFS ACL

```powershell
Get-Acl "D:\Shares\Accounting" |
    Select-Object -ExpandProperty Access
```

### 授予 Share 层 Full Control

```powershell
Grant-SmbShareAccess -Name "Accounting" `
    -AccountName "Everyone" `
    -AccessRight Full `
    -Force
```

注意：这条命令用于添加或更新允许访问的 Share ACE，不会自动清除其他已有权限条目，尤其是 Explicit Deny。

修改完成后应使用 `Get-SmbShareAccess` 重新验证完整 ACL。

在生产环境修改权限之前，应确认目标目录的 NTFS 权限已经正确配置。

## 7. 快速参考表

|需求或现象|应该检查什么|
|---|---|
|想让 SMB Share 不出现在正常浏览列表中|共享名称末尾添加 `$`|
|想隐藏用户无权访问的子文件夹|ABE + NTFS Permissions|
|启用了 ABE，但文件夹依然可见|用户实际权限、AD Group、继承的 ACL|
|用户能读取但不能修改文件|Share Permissions + NTFS Permissions|
|服务器本地访问正常，但 UNC 访问受限|Share Permissions|
|重新创建共享后权限异常|新 Share 的 ACL|
|敏感子文件夹需要独立权限|NTFS ACL 和 Inheritance|
|需要验证 ABE 是否正确工作|使用 Standard Domain User 测试可见性与直接访问|

## 总结

Windows 文件共享中的三个机制，各自负责不同的事情：

- **Hidden Shares (**`**$**`**)：** 控制 SMB Share 是否出现在正常的共享枚举列表中。
    
- **Access-Based Enumeration (ABE)：** 根据用户的实际访问权限，控制哪些文件和文件夹会显示在目录列表中。
    
- **Share Permissions + NTFS Permissions：** 共同决定用户通过 SMB 可以对文件执行哪些操作。


在实际管理中，最重要的是保持权限结构清晰且可预测。

尽量使用 AD Security Groups，合理设计 NTFS ACL，根据需要启用 ABE，并在创建、迁移或重组共享目录后检查 Share Permissions。

**最后记住两个核心区别：**

**隐藏不等于禁止访问。**

**拥有 NTFS 权限，不代表一定拥有 SMB 网络访问权限。**

