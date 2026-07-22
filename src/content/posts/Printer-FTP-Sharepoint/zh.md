---
title: Brother 扫描仪无缝接入 SharePoint —— IIS FTP + Power Automate 自动上传方案
published: 2026-07-22
description: 记录如何让不支持 Scan to SharePoint 的 Brother 多功能打印机，通过 IIS FTP、On-premises Data Gateway 和 Power Automate，实现扫描文件自动上传到 SharePoint。
tags:
  - SharePoint
  - IIS
  - FTP
  - Printer
  - Windows-Server
  - Power-Automate
category: Microsoft 365
lang: zh
draft: false
---

# 前言

随着公司文件逐步迁移到 SharePoint，我们遇到了一个新的问题。

传统的多功能打印机（MFP）通常支持：

- Scan to Email
- Scan to SMB
- Scan to FTP

但是大多数型号，尤其是中低端 Brother 设备，并不支持直接扫描到 Scan to email/SharePoint Online。

如果继续使用传统 SMB 共享目录，那么扫描件就会脱离 SharePoint 的权限管理、版本控制以及协作体系。

我们的目标很明确：

> 保持用户使用习惯不变，同时让所有扫描文件最终进入 SharePoint。

---

# 最终架构

最终采用了下面的架构：

```text
Brother Scanner
        │
Scan to FTP
        │
Windows Server IIS FTP
        │
Power Automate
        │
SharePoint Document Library
```

整个过程对于用户完全透明。

用户只需要在打印机上按下 **Scan to FTP**。

系统会自动完成：

1. 扫描到 FTP
2. 检测新文件
3. 上传至 SharePoint

无需任何人工参与。

---
# 环境

服务器：

- Windows Server 2016 Standard

打印机：

- Brother DCP-L2640DW

文件上传：

- Microsoft Power Automate
- On-premises Data Gateway

目标平台：

- SharePoint Online

FTP：

- IIS FTP Server


---

# 安装 IIS FTP

Windows Server 默认并不会安装 FTP 服务。

需要通过 **Server Manager** 添加 IIS（Internet Information Services）相关角色。

打开：

```
Server Manager
→ Add Roles and Features
```

选择：

```
Web Server (IIS)
```

在 **Role Services** 中，除了默认的 Web Server 组件外，还需要额外安装 FTP 相关服务：

```
Web Server (IIS)
├── Common HTTP Features
├── Health and Diagnostics
├── Performance
├── Security
├── ...
└── FTP Server
    ├── FTP Service
    └── FTP Extensibility
```

其中：

- **FTP Service**：提供 FTP 服务本身。
- **FTP Extensibility**：支持扩展身份验证和后续高级功能，建议一并安装。

安装完成后，在 IIS Manager 中即可看到 **FTP Sites** 节点。

---

## 创建 FTP Site

本项目中，FTP 仅作为扫描文件的临时缓冲区（Staging Area）。

因此，我们在服务器上创建了专用目录：

```
C:\FTPScan
```

随后在 IIS 中新建 FTP Site：
打开IIS manager

```
Server Manager
    ↓
Tools
    ↓
Internet Information Services (IIS) Manager
```

打开：
```
PRINTER
```

## 创建新的 FTP Site
右键：
```
Sites
    ↓
Add FTP Site...
```

参考配置如下
```
Site Name
Scanner FTP

Physical Path
C:\FTPScan

IP Address
192.168.x.x

Port
21

No SSL
```


> [!NOTE] 为什么不用 SSL？
> Brother DCP-L2640DW 支持普通 FTP，而 FTPS（FTP over SSL）兼容性因型号和固件而异。我们的目标是先验证整个流程，等以后如果有合规要求，再升级到 FTPS。因为服务器和打印机都在公司内网，先用普通 FTP 是一个合理的起点。

身份验证选择：

```
Basic Authentication
```

授权方式：

```
Specified users
```

仅允许用于扫描的 FTP 用户访问。

## 创建新的FTP专用账户

打开：

```
Computer Management
    ↓
Local Users and Groups
    ↓
Users
    ↓
New User...
```

创建：

```
Username:
scanftp
```

---

## 建议提前规划目录结构

虽然目前只有一台打印机，但建议一开始就按照打印机或部门划分目录。

例如：

```
C:\FTPScan
├── MTL-P73
├── MTL-P74
├── QC-P01
└── HR
```

每台 Brother 打印机配置自己的 **Store Directory**。

例如：

```
Store Directory

MTL-P73
```

这样可以让后续 Power Automate 根据目录自动上传到不同的 SharePoint Library，而无需修改打印机配置，也方便未来扩展更多设备。

---


# 第一个坑：Windows Firewall

FTP 本地测试一切正常。

但是客户端始终无法连接。
## 确认FTP服务运行，FTP Site启动，监听21端口
```Powershell
PS C:\Windows\system32> systeminfo | findstr /B /C:"OS Name" /C:"OS Version" 
OS Name:    Microsoft Windows Server 2016 Standard 
OS Version: 10.0.14393 N/A Build 14393 

PS C:\Windows\system32> Get-Service ftpsvc 
Status     Name     DisplayName 
------     ----     ----------- 
Running    ftpsvc   Microsoft FTP Service 

PS C:\Windows\system32> Get-WebSite 
Name             ID     State     Physical Path                 Bindings 
----             --     -----     -------------                 -------- 
Default Web Site 1      Started   %SystemDrive%\inetpub\wwwroot http *:80: 
Scanner FTP      2      Started   C:\FTPScan                    ftp 192.168.1.129:21: 

PS C:\Windows\system32> netstat -ano | findstr :21 
TCP 0.0.0.0:21 0.0.0.0:0 LISTENING 8504 
TCP 192.168.1.xx:21290 4.174.148.129:443 ESTABLISHED 8684 
TCP 192.168.1.xx:21291 4.174.148.129:443 ESTABLISHED 5624 
TCP [::]:21 [::]:0 LISTENING 8504 


```

## 分析
✅ FTP 服务运行中

```
Running  ftpsvc
```

✅ FTP Site 已启动

```
Scanner FTP   Started
```

✅ 21 端口正在监听

```
0.0.0.0:21 LISTENING
```

所以 **服务器端已经没有明显问题**

### 测试TCP连接
打开一台客户端的Powershell, 执行：
```PowerShell
Test-NetConnection 192.168.1.129 -Port 21
```

输出：
```PowerShell
WARNING: TCP connect to (192.168.1.129 : 21) failed 
ComputerName : 192.168.1.129 
RemoteAddress : 192.168.1.129 
RemotePort : 21 
InterfaceAlias : 
Ethernet 4 SourceAddress : 192.168.1.191 
PingSucceeded : True 
PingReplyDetails (RTT) : 1 ms 
TcpTestSucceeded : False
```

## 检测防火墙规则

在FTP服务器执行：
```PowerShell
Get-NetFirewallRule -DisplayGroup "FTP Server" | Select DisplayName, Enabled
```

输出：
```PowerShell
DisplayName Enabled 
----------- ------- 
FTP Server (FTP Traffic-In) True 
FTP Server (FTP Traffic-Out) True 
FTP Server Secure (FTP SSL Traffic-In) True 
FTP Server Secure (FTP SSL Traffic-Out) True 
FTP Server Passive (FTP Passive Traffic-In) True
```

看起来没有问题


> [!NOTE] Windows Firewall
> 因为这台服务器加入了AD域，也许domain的Firewall Profile 影响到了FTP，我们先关掉来测试一下

在服务器执行：

```PowerShell
Set-NetFirewallProfile -Profile Domain -Enabled False
```
![](Pasted%20image%2020260722115720.png)

关闭Domain Firewall Rule 之后，`TcpTestSucceeded : True`
这说明：

> **就是 Windows Defender Firewall（或者域 GPO 控制的防火墙）导致的。**

## 先不要一直关着防火墙

把它重新打开：

```PowerShell
Set-NetFirewallProfile -Profile Domain -Enabled True
```

我们**不要依赖 IIS 自动创建的 FTP Rule**。

直接自己创建一条明确的规则。

服务器执行：

```PowerShell
New-NetFirewallRule `
    -DisplayName "Scanner FTP 21" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 21 `
    -Action Allow `
    -Profile Domain
```

加入这条防火墙规则之后，FTP就通了


---

# 第二个坑：Passive Mode

解决了 21 端口以后。

命令行 FTP 可以正常登录。

但是 Windows Explorer 一直提示：

```
The operation timed out.
```

![](Pasted%20image%2020260722120132.png)
经过排查发现：

Windows Explorer 使用 Passive FTP。

而 IIS 默认并没有配置 Passive Port。

## 现在配置 Passive Mode

打开 IIS：

```
服务器
    ↓
Scanner FTP
    ↓
点击最上面的服务器节点
```

**注意：不是 FTP Site，而是左侧树最顶端的服务器名 `PRINTER`。**

然后打开：

```
FTP Firewall Support
```

应该能看到：

- Data Channel Port Range
- External IP Address

---

### 设置

**Data Channel Port Range**

输入：

```
50000-50050
```

**External IP Address**

留空。

（因为我们在内网，不需要填写。）

点击：

```
Apply
```

---

## 然后放行这些端口

PowerShell：

```
New-NetFirewallRule `
    -DisplayName "FTP Passive Ports" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 50000-50050 `
    -Action Allow `
    -Profile Domain
```

---

## 最后一步

重启 FTP Service：

```
Restart-Service ftpsvc
```

---

# 打印机 配置

Brother 配置非常简单。

FTP Server：

```
192.168.x.x
```

Port：

```
21
```

Passive Mode：

```
Enable
```

Store Directory：

```
MTL-P73
```

Username和Password填写刚才注册的本地账户

这里需要注意：

Store Directory 是相对于 FTP Root 的路径。

例如：

```
Root

C:\FTPScan
```

Store Directory：

```
MTL-P73
```

最终文件实际保存位置：

```
C:\FTPScan\MTL-P73
```

---

# Power Automate

由于文件位于本地服务器。

最终采用：

```
On-premises Data Gateway
```

连接本地文件系统。

整个 Flow 非常简单：

```
When a file is created
        │
Get file content
        │
Create file (SharePoint)
```

整个流程无需任何脚本。

全部使用微软官方 Connector。
## Step 1：确认 Gateway 是否已安装

先不要创建 Flow。

打开服务器（PRINTER），检查是否已经安装：

```
On-premises data gateway
```

开始菜单搜索：

```
gateway
```

如果看到：

> **On-premises data gateway**

说明已经安装。

如果没有，我们先安装。

官方下载：

> https://aka.ms/onpremgateway

安装时：

- **Mode**：Standard
- 登录：你的 `username@contasco.com`
- Gateway Name：例如 `PRINTER-GW`
- Recovery Key：设置一个强密码并妥善保存（以后迁移或恢复 Gateway 会用到）。
## Step 2：创建 Automated Cloud Flow

打开：

> [https://make.powerautomate.com](https://make.powerautomate.com)

然后：

**Create（创建）** → **Automated cloud flow**

填写：

**Flow Name**

```
FTP Scan to SharePoint
```

**Choose your flow's trigger**

搜索：

```
File System
```

选择：

> **When a file is created (properties only)**

![](Pasted%20image%2020260722120836.png)

## Step 3：创建 Connection
![](Pasted%20image%2020260722120934.png)


| 字段                      | 填写内容                  |
| ----------------------- | --------------------- |
| **Connection name**     | `PRINTER File System` |
| **Root folder**         | `C:\FTPScan`          |
| **Authentication Type** | `Windows`             |
| **Username**            | 刚才创建的本地账户             |
| **Password**            | 对应 Windows 账户密码       |
| **Gateway**             | 选择刚刚创建的 `PRINTER-GW`  |


## Step 4：配置 Trigger

Trigger：

> **When a file is created (properties only)**
。
## Folder

点击右边的**文件夹图标**（如果有），或者填写相对于 Root Folder 的路径：

```
/MTL-P73
```

因为 Root Folder 已经是：

```
C:\FTPScan
```

所以 Trigger 实际监控的是：

```
C:\FTPScan\MTL-P73
```
![](Pasted%20image%2020260722121152.png)

## Step 5：添加读取文件内容

点击中间的 **➕**。

选择：

> **Add an action**

搜索：

```
File System
```

选择：

> **Get file content**

在 **Get file content → File** 中选择：

```
body/Id
```
![](Pasted%20image%2020260722121314.png)

完成后，点击下方的 **＋**，下一步添加：

> **SharePoint — Create file**
![](Pasted%20image%2020260722121351.png)

配置Action：

![](Pasted%20image%2020260722121532.png)

> File name 和File Content选择动态内容，接受**Get file content**的输出 

点击右上角 Save 保存 Flow。
Power automate 的最终流程:
```
When a file is created (properties only)
             │
             ▼
Get file content
             │
             ▼
SharePoint Create file
```

---
# 最终效果

整个流程最终变成：

```
扫描
    │
    ▼
FTP
    │
    ▼
Power Automate
    │
    ▼
SharePoint
```

对于最终用户来说。

扫描流程没有任何变化。

但所有文件最终都统一进入 SharePoint，享受：

- 权限管理
- 在线协作
- 版本控制
- Microsoft 365 统一管理

整个改造过程中，打印机无需支持 SharePoint，也无需安装任何第三方软件。

这也是一种比较容易复制到其他打印机的部署方式。

# Toolbox

下面整理了本次部署过程中使用到的主要 PowerShell 与 Windows 命令，可作为后续部署或排障时的参考。

---

## 1. 检查 FTP 服务状态

查看 IIS FTP 服务是否已经启动。

```powershell
Get-Service ftpsvc
```

启动 FTP 服务：

```powershell
Start-Service ftpsvc
```

停止 FTP 服务：

```powershell
Stop-Service ftpsvc
```

重启 FTP 服务：

```powershell
Restart-Service ftpsvc
```

---

## 2. 检查端口监听状态

确认 FTP Server 是否已经开始监听 TCP 21。

```powershell
netstat -ano | findstr :21
```

如果能够看到：

```text
LISTENING
```

说明 IIS 已经成功绑定到 21 端口。

---

## 3. 测试网络连通性

验证客户端是否能够访问 FTP Server。

```powershell
Test-NetConnection 192.168.x.x -Port 21
```

重点关注：

```text
TcpTestSucceeded
```

- True：网络连接正常
- False：需要继续检查防火墙或网络配置

---

## 4. 测试 FTP 登录

使用 Windows 自带 FTP Client 测试登录。

```cmd
ftp 192.168.x.x
```

登录成功后可以使用：

```cmd
dir
```

查看目录内容。

退出：

```cmd
bye
```

---

## 5. 查看 Windows Firewall 状态

查看各 Firewall Profile 是否启用。

```powershell
Get-NetFirewallProfile
```

---

## 6. 临时关闭 Firewall（仅用于排障）

验证问题是否由防火墙导致。

```powershell
Set-NetFirewallProfile -Profile Domain -Enabled False
```

恢复：

```powershell
Set-NetFirewallProfile -Profile Domain -Enabled True
```

> 不建议长期关闭防火墙，仅用于快速定位问题。

---

## 7. 创建 FTP Firewall Rule

开放 FTP 控制连接（TCP 21）。

```powershell
New-NetFirewallRule `
    -DisplayName "Scanner FTP" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 21 `
    -Action Allow `
    -Profile Domain
```

---

## 8. 查看 Firewall Rules

列出 FTP 相关规则。

```powershell
Get-NetFirewallRule |
Where-Object DisplayName -like "*FTP*"
```

---


## 9. 常见排障顺序

建议按照下面的顺序进行排查，而不是同时修改多个配置：

1. FTP 服务是否启动？
2. 21 端口是否监听？
3. 本机是否可以 FTP 登录？
4. `Test-NetConnection` 是否成功？
5. Firewall 是否阻挡？
6. Passive Mode 是否配置？
7. Brother FTP Test 是否通过？
8. 文件是否成功写入 FTP Root？
9. Power Automate 是否触发？
10. SharePoint 是否成功收到文件？

按照以上流程，可以快速定位问题所在，避免盲目修改配置。