---
title: Integrating a Brother Scanner with SharePoint Using IIS FTP and Power Automate
published: 2026-07-22
description: Learn how to integrate a Brother multifunction printer that does not support Scan to SharePoint by using IIS FTP, an On-premises Data Gateway, and Power Automate to automatically upload scanned documents to SharePoint Online.
tags:
  - SharePoint
  - IIS
  - FTP
  - Printer
  - Power-Automate
  - Active-Directory
category: Microsoft 365
lang: en
draft: false
---

# Introduction

As our organization gradually migrated its document storage to SharePoint Online, we encountered a new challenge.

Traditional multifunction printers (MFPs) typically support:

- Scan to Email
- Scan to SMB
- Scan to FTP

However, most Brother printers—especially entry-level and mid-range models—do not support scanning directly to SharePoint Online.

Continuing to use a traditional SMB shared folder would mean scanned documents remain outside the SharePoint ecosystem, losing the benefits of centralized permission management, version control, and collaboration.

Our objective was straightforward:

> Keep the scanning experience unchanged for end users while ensuring every scanned document ultimately ends up in SharePoint.

---

# Solution Architecture

After evaluating several options, we adopted the following architecture:

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

The entire process is completely transparent to end users.

Users simply select **Scan to FTP** on the Brother printer.

The system automatically performs the remaining tasks:

1. Save the scanned document to the FTP server.
2. Detect the newly created file.
3. Upload it to the designated SharePoint document library.

No manual intervention is required.

---

# Environment

**Server**

- Windows Server 2016 Standard

**Printer**

- Brother DCP-L2640DW

**Automation**

- Microsoft Power Automate
- On-premises Data Gateway

**Destination**

- SharePoint Online

**FTP Server**

- IIS FTP Server

---

# Installing IIS FTP

Windows Server does not install the FTP service by default.

Open **Server Manager** and launch the **Add Roles and Features Wizard**.

```
Server Manager
    ↓
Add Roles and Features
```

Select:

```
Web Server (IIS)
```

Under **Role Services**, install the FTP components in addition to the default IIS features:

```text
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

These two components serve different purposes:

- **FTP Service** provides the core FTP functionality.
- **FTP Extensibility** enables advanced authentication methods and future extensibility, so it is recommended to install it together with the FTP Service.

After the installation completes, a new **FTP Sites** node will appear in IIS Manager.

---

# Creating an FTP Site

In this solution, the FTP server is used only as a temporary staging area for scanned documents.

Create a dedicated directory on the server:

```text
C:\FTPScan
```

Then open IIS Manager:

```text
Server Manager
    ↓
Tools
    ↓
Internet Information Services (IIS) Manager
```

Expand the server node:

```text
PRINTER
```

Right-click **Sites** and select:

```text
Add FTP Site...
```

Configure the site using the following settings:

```text
Site Name
Scanner FTP

Physical Path
C:\FTPScan

IP Address
192.168.x.x

Port
21

SSL
No SSL
```

> [!NOTE]
> **Why not use FTPS?**
>
> The Brother DCP-L2640DW supports standard FTP out of the box, while FTPS (FTP over SSL) compatibility varies depending on the printer model and firmware version.
>
> Since our initial goal was to validate the complete workflow, we chose standard FTP for the first deployment. Because both the FTP server and the printer reside within the internal corporate network, this approach provides a reasonable balance between simplicity and functionality.
>
> If security or compliance requirements change in the future, upgrading to FTPS can be considered without changing the overall architecture.

For authentication, select:

```text
Basic Authentication
```

For authorization:

```text
Specified users
```

Grant access only to the dedicated FTP account used by the scanner.

---

# Creating a Dedicated FTP Account

Instead of using an administrator account, create a dedicated local user with the minimum permissions required.

Open:

```text
Computer Management
    ↓
Local Users and Groups
    ↓
Users
    ↓
New User...
```

Create the following account:

```text
Username
scanftp
```

Using a dedicated account follows the principle of least privilege and simplifies future auditing and maintenance.

---

# Planning the Directory Structure

Although this deployment initially included only a single printer, it is worth planning a scalable directory structure from the beginning.

For example:

```text
C:\FTPScan
├── MTL-P73
├── MTL-P74
├── QC-P01
└── HR
```

Each Brother printer is configured to use its own **Store Directory**.

For example:

```text
Store Directory

MTL-P73
```

This allows Power Automate to monitor different folders and automatically upload documents to different SharePoint document libraries without requiring any changes to the printer configuration.

It also makes the solution easy to expand as additional printers are deployed.

# Troubleshooting #1: Windows Defender Firewall

Local FTP testing worked perfectly.

However, client computers were unable to connect to the FTP server.

## Verify the FTP Service, FTP Site, and Port 21

Run the following commands on the FTP server:

```ps1
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

TCP    0.0.0.0:21                  0.0.0.0:0              LISTENING
TCP    [::]:21                     [::]:0                 LISTENING
```

## Analysis

✅ The FTP service is running.

```text
Running    ftpsvc
```

✅ The FTP Site has started successfully.

```text
Scanner FTP      Started
```

✅ Port 21 is listening.

```text
0.0.0.0:21    LISTENING
```

At this point, there were no obvious issues on the server side.

### Test the TCP Connection

Open PowerShell on a client computer and run:

```ps1
Test-NetConnection 192.168.1.129 -Port 21
```

Output:

```ps1
WARNING: TCP connect to (192.168.1.129 : 21) failed

ComputerName     : 192.168.1.129
RemoteAddress    : 192.168.1.129
RemotePort       : 21
SourceAddress    : 192.168.1.191
PingSucceeded    : True
TcpTestSucceeded : False
```

## Check the Firewall Rules

Run the following command on the FTP server:

```ps1
Get-NetFirewallRule -DisplayGroup "FTP Server" | Select DisplayName, Enabled
```

Output:

```ps1
DisplayName                                 Enabled
-----------                                 -------
FTP Server (FTP Traffic-In)                 True
FTP Server (FTP Traffic-Out)                True
FTP Server Secure (FTP SSL Traffic-In)      True
FTP Server Secure (FTP SSL Traffic-Out)     True
FTP Server Passive (FTP Passive Traffic-In) True
```

Everything appeared to be configured correctly.

> [!NOTE]
> Since this server is joined to an Active Directory domain, we suspected that the **Domain Firewall Profile** might be blocking FTP traffic.
>
> To verify this assumption, we temporarily disabled the Domain Firewall Profile.

Run:

```ps1
Set-NetFirewallProfile -Profile Domain -Enabled False
```

![](Pasted%20image%2020260722115720.png)

After disabling the Domain Firewall Profile, the result changed to:

```text
TcpTestSucceeded : True
```

This confirmed that:

> **Windows Defender Firewall (or a firewall policy applied through Group Policy) was blocking the FTP connection.**

## Do Not Leave the Firewall Disabled

Re-enable the firewall:

```ps1
Set-NetFirewallProfile -Profile Domain -Enabled True
```

Instead of relying on the firewall rules created automatically by IIS, we created an explicit inbound rule for FTP.

Run:

```ps1
New-NetFirewallRule `
    -DisplayName "Scanner FTP 21" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 21 `
    -Action Allow `
    -Profile Domain
```

After adding this firewall rule, FTP connections worked successfully.
# Troubleshooting #2: FTP Passive Mode

After resolving the firewall issue, the client was finally able to establish an FTP connection.

However, a new problem appeared.

The FTP session could be established successfully, but file uploads still failed.

At this point, we knew that:

- Port 21 was reachable.
- The FTP service was running normally.
- Authentication succeeded.

The problem occurred **after** the control connection had been established.
![](Pasted%20image%2020260722120132.png)

---

## Understanding FTP Passive Mode

FTP uses two separate connections:

- **Control Connection** (TCP 21)
- **Data Connection** (a dynamically assigned TCP port)

When using **Passive Mode**, the server opens a random TCP port for the data connection.

If these dynamic ports are not allowed through the firewall, the FTP client can log in successfully but will fail when transferring files.

This is a common issue when deploying an FTP server on Windows Server.

---

## Configure a Passive Port Range

Open **IIS Manager**.

Select the server node, then open:

```text
FTP Firewall Support
```

Configure a dedicated passive port range.

For example:

```text
Data Channel Port Range

50000-50050
```



Using a fixed range makes firewall configuration much simpler than allowing all dynamic ports.

---

## Allow the Passive Ports Through Windows Firewall

After configuring the passive port range in IIS, Windows Defender Firewall must also allow those ports.

Run:

```ps1
New-NetFirewallRule `
    -DisplayName "FTP Passive Ports" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 50000-50050 `
    -Action Allow `
    -Profile Domain
```

Restart FTP service
```
Restart-Service ftpsvc
```

---

# Printer Configuration

Configuring the Brother printer is very straightforward.

**FTP Server:**

```text
192.168.x.x
```

**Port:**

```text
21
```

**Passive Mode:**

```text
Enable
```

**Store Directory:**

```text
MTL-P73
```

For the **Username** and **Password**, enter the local account that was created earlier.

One thing to note is:

The **Store Directory** is a path relative to the FTP Root.

For example:

```text
Root

C:\FTPScan
```

Store Directory:

```text
MTL-P73
```

The actual file storage location will be:

```text
C:\FTPScan\MTL-P73
```

---

# Power Automate

Since the files are stored on a local server, we used:

```text
On-premises Data Gateway
```

to connect to the local file system.

The Flow itself is very simple:

```text
When a file is created
        │
Get file content
        │
Create file (SharePoint)
```

No scripts are required.

The entire workflow uses only Microsoft official connectors.

## Step 1: Verify that the Gateway Is Installed

Do not create the Flow yet.

On the server (**PRINTER**), first verify whether the following is already installed:

```text
On-premises data gateway
```

Search the Start menu for:

```text
gateway
```

If you see:

> **On-premises data gateway**

then it is already installed.

If not, install it first.

Download it from:

> https://aka.ms/onpremgateway

During the installation, configure the following:

- **Mode:** Standard
- Sign in with your `username@contasco.com`
- **Gateway Name:** For example, `PRINTER-GW`
- **Recovery Key:** Create a strong password and store it securely. It will be required if the Gateway needs to be migrated or restored in the future.

## Step 2: Create an Automated Cloud Flow

Open:

> https://make.powerautomate.com

Then navigate to:

**Create** → **Automated cloud flow**

Enter the following:

**Flow Name**

```text
FTP Scan to SharePoint
```

**Choose your flow's trigger**

Search for:

```text
File System
```

Select:

> **When a file is created (properties only)**

![](Pasted%20image%2020260722120836.png)

## Step 3: Create the Connection

![](Pasted%20image%2020260722120934.png)

| Field | Value |
|------|------|
| **Connection name** | `PRINTER File System` |
| **Root folder** | `C:\FTPScan` |
| **Authentication Type** | `Windows` |
| **Username** | The local account created earlier |
| **Password** | The password for the Windows account |
| **Gateway** | Select the `PRINTER-GW` gateway created earlier |

## Step 4: Configure the Trigger

Trigger:

> **When a file is created (properties only)**

### Folder

Click the **folder icon** on the right (if available), or manually enter the path relative to the Root Folder:

```text
/MTL-P73
```

Since the Root Folder is already:

```text
C:\FTPScan
```

the Trigger is actually monitoring:

```text
C:\FTPScan\MTL-P73
```

![](Pasted%20image%2020260722121152.png)

## Step 5: Add the File Content Action

Click the **➕** button in the middle.

Select:

> **Add an action**

Search for:

```text
File System
```

Select:

> **Get file content**

For **Get file content → File**, select:

```text
body/Id
```

![](Pasted%20image%2020260722121314.png)

After that, click the **➕** button below to add the next action:

> **SharePoint — Create file**

![](Pasted%20image%2020260722121351.png)

Configure the action:

![](Pasted%20image%2020260722121532.png)

> For **File Name** and **File Content**, select the dynamic content returned by **Get file content**.

Click **Save** in the upper-right corner to save the Flow.

The final Power Automate workflow is:

```text
When a file is created (properties only)
             │
             ▼
Get file content
             │
             ▼
SharePoint Create file
```

---

# Final Result

The final workflow becomes:

```text
Scan
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

For end users, nothing changes in the scanning process.

However, every scanned document is ultimately stored in SharePoint, where it benefits from:

- Permission management
- Online collaboration
- Version control
- Centralized Microsoft 365 management

Throughout the entire deployment, the printer does not need to support SharePoint, nor is any third-party software required.

This approach is also easy to replicate for other printers.

# Toolbox

The following PowerShell and Windows commands were used throughout this deployment and can serve as a reference for future deployments and troubleshooting.

---

## 1. Check the FTP Service Status

Verify that the IIS FTP service is running.

```ps1
Get-Service ftpsvc
```

Start the FTP service:

```ps1
Start-Service ftpsvc
```

Stop the FTP service:

```ps1
Stop-Service ftpsvc
```

Restart the FTP service:

```ps1
Restart-Service ftpsvc
```

---

## 2. Check Whether Port 21 Is Listening

Verify that the FTP server is listening on TCP port 21.

```ps1
netstat -ano | findstr :21
```

If you see:

```text
LISTENING
```

then IIS has successfully bound to port 21.

---

## 3. Test Network Connectivity

Verify that the client can reach the FTP server.

```ps1
Test-NetConnection 192.168.x.x -Port 21
```

Pay attention to:

```text
TcpTestSucceeded
```

- **True** — Network connectivity is working.
- **False** — Continue troubleshooting the firewall or network configuration.

---

## 4. Test FTP Login

Use the built-in Windows FTP client to test the connection.

```cmd
ftp 192.168.x.x
```

After logging in successfully, use:

```cmd
dir
```

to list the directory contents.

Exit the session with:

```cmd
bye
```

---

## 5. Check the Windows Firewall Status

View the status of all Firewall Profiles.

```ps1
Get-NetFirewallProfile
```

---

## 6. Temporarily Disable the Firewall (Troubleshooting Only)

Use this only to verify whether the firewall is causing the issue.

```ps1
Set-NetFirewallProfile -Profile Domain -Enabled False
```

Re-enable it afterward:

```ps1
Set-NetFirewallProfile -Profile Domain -Enabled True
```

> It is not recommended to leave the firewall disabled. This should only be used for troubleshooting.

---

## 7. Create an FTP Firewall Rule

Allow the FTP control connection (TCP 21).

```ps1
New-NetFirewallRule `
    -DisplayName "Scanner FTP" `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 21 `
    -Action Allow `
    -Profile Domain
```

---

## 8. View Firewall Rules

List all FTP-related firewall rules.

```ps1
Get-NetFirewallRule |
Where-Object DisplayName -like "*FTP*"
```

---

## 9. Recommended Troubleshooting Order

It is recommended to troubleshoot in the following order instead of changing multiple settings at the same time:

1. Is the FTP service running?
2. Is port 21 listening?
3. Can you log in to the FTP server locally?
4. Does `Test-NetConnection` succeed?
5. Is the firewall blocking the connection?
6. Is Passive Mode configured correctly?
7. Does the Brother FTP Test pass?
8. Is the file successfully written to the FTP Root?
9. Is Power Automate triggered?
10. Does the file successfully appear in SharePoint?

Following this sequence makes it much easier to isolate the root cause and avoids making unnecessary configuration changes.