---
title: "Windows File Sharing: ABE, Hidden Shares, and Share vs. NTFS Permissions"
published: 2026-10-09
description: Figure out the 3 key concepts while configuring SMB share
tags:
  - Windows-Server
  - Active-Directory
  - SMB
category: Infrastructure
draft: false
lang: en
---
# Windows File Sharing: ABE, Hidden Shares, and Share vs. NTFS Permissions

When managing shared folders on Windows Server, three concepts are often confused:

- **Hidden Shares (**`**$**`**):** Prevent SMB shares from appearing in normal network browsing.
    
- **Access-Based Enumeration (ABE):** Determines which files and folders are visible to users based on their access permissions.
    
- **Share vs. NTFS Permissions:** Two independent permission layers that work together to determine what users can do when accessing files over the network.


These features serve different purposes. Understanding how they work and their limitations is important when designing, maintaining, or reorganizing Windows file shares.

## 1. Hidden Shares: What Does `$` Actually Do?

Adding `$` to the end of an SMB share name makes it a **hidden share**.

For example:

```
\\apps\Accounting
\\apps\Accounting$
```

When a user browses the server through File Explorer:

```
\\apps
```

Normally, `Accounting` appears in the list of shares, while `Accounting$` does not.

However, if a user knows the full UNC path, they can still attempt to access it directly:

```
\\apps\Accounting$
```

Whether access is granted depends on the user's Share Permissions and NTFS Permissions.

### Important: `$` Does Not Hide Regular Folders

Suppose the server has the following directory structure:

```
D:\Shares\
    Accounting\
    Accounting$\
    Finance\
```

If an administrator shares `D:\Shares` as `\\apps\Data`, users browsing that share may still see the `Accounting$` folder.

The reason is simple:

`**$**` **has a special meaning only when it appears at the end of an SMB share name. In a regular directory name, it is just an ordinary character.**

A hidden share does not prevent users from accessing the resource, nor does it replace proper security permissions.

## 2. Access-Based Enumeration (ABE)

ABE controls the visibility of files and subfolders inside an SMB share based on the user's access permissions.

By default, when ABE is disabled, users may still see folder names in File Explorer even if they do not have permission to open those folders.

When ABE is enabled, Windows filters directory listings based on each user's permissions.

### Example

Suppose the shared folder contains:

```
\\apps\Accounting\
    General\
    Payables\
    Management\
    Confidential\
```

A user has access only to `General` and `Payables`.

With ABE enabled, the user will see:

```
\\apps\Accounting\
    General\
    Payables\
```

Folders the user is not authorized to access will not appear in the directory listing.

### How ABE Works

When a user enumerates a directory, ABE evaluates the user's effective access permissions to determine which items should be displayed.

For typical NTFS-backed SMB shares, Windows uses the applicable file system permissions to make this determination.

Important details:

- ABE evaluates visibility based on the user's security token and effective permissions.
    
- ABE only filters directory listings. It does not modify existing NTFS Permissions.
    
- ABE does not replace Share Permissions.
    
- A resource hidden by ABE may still be accessible through another path or share if permissions allow it.
    
- If a user already has access through an AD Group or inherited ACL, ABE may continue to display the folder.


Therefore, **ABE is primarily a visibility-control feature, not an independent security boundary.**

### How to Enable ABE

**GUI method:**

1. Open Server Manager.
    
2. Navigate to File and Storage Services → Shares.
    
3. Select the SMB share and open its Properties.
    
4. Under Settings, check **Enable access-based enumeration**.
    
5. Apply the changes.


**PowerShell method:**

```powershell
Set-SmbShare -Name "Accounting" `
    -FolderEnumerationMode AccessBased
```

Verify the current setting:

```powershell
Get-SmbShare -Name "Accounting" |
    Select-Object Name, FolderEnumerationMode
```

When enabled, the value should be:

```powershell
FolderEnumerationMode : AccessBased
```

### How to Test ABE Correctly

It is recommended to test ABE using a **standard domain user** whose AD Security Group memberships match the intended access scenario.

Do not rely solely on an administrator account for validation.

Administrators may have broader access through the Administrators group, inherited ACLs, or other privileges.

However, administrators do not automatically bypass ABE. Visibility still depends on the permissions evaluated for the account.

Proper testing should include two separate checks:

1. **Visibility Test:** Can the user see folders that should be hidden from them?
    
2. **Access Test:** Can the user directly open restricted folders using their full UNC paths?


An important distinction:

**A folder being invisible does not necessarily mean it is inaccessible.**

Visibility and access control must be verified separately.

## 3. Share Permissions vs. NTFS Permissions

Windows uses two independent permission layers for files accessed through SMB.

|                   | Share Permissions                   | NTFS Permissions                                 |
| ----------------- | ----------------------------------- | ------------------------------------------------ |
| Scope             | Network access through an SMB share | Local and network file system access             |
| Configured on     | SMB share                           | Files and folders                                |
| Permission levels | Read, Change, Full Control          | Read, Write, Modify, Full Control, etc.          |
| Inheritance       | Does not inherit through subfolders | Supports inheritance                             |
| Main purpose      | Controls access at the share level  | Provides granular file and folder access control |

### How Are Effective Permissions Calculated?

When a user accesses files through SMB, Windows evaluates both permission layers.

An operation must be permitted by both Share Permissions and NTFS Permissions to succeed.

A simplified way to understand this is:

**Effective Network Permissions = Share Permissions ∩ NTFS Permissions**

In other words, the effective access is the intersection of both permission sets.

|Share Permissions|NTFS Permissions|Effective SMB Access|
|---|---|---|
|Full Control|Modify|Modify|
|Read|Modify|Read|
|Change|Read|Read|
|Full Control|Read|Read|
|Read|Full Control|Read|

This table represents a simplified model. Actual permission evaluation also considers multiple group memberships, Allow/Deny Access Control Entries (ACEs), and granular NTFS permission bits.

However, the core rule remains:

**Both Share Permissions and NTFS Permissions must allow an operation for it to succeed over SMB.**

This explains why a user may have NTFS Modify permission but still be unable to create or modify files through a network share.

### Local Access vs. Network Access

Share Permissions apply only to connections made through SMB.

For example, accessing the following path directly on the server:

```
D:\Shares\Accounting
```

is primarily controlled by NTFS Permissions.

However, accessing the same folder through a UNC path:

```
\\apps\Accounting
```

requires both Share Permissions and NTFS Permissions.

This distinction is important.

If a folder can be modified locally on the server but becomes read-only when accessed through its UNC path, check the SMB Share Permissions in addition to the NTFS Permissions.

## 4. Why Do Users Have Read-Only Access Even When NTFS Permissions Are Correct?

This is an easy-to-overlook issue in Windows file sharing.

Suppose an AD Group has NTFS Modify permission:

```
NTFS Permissions:
Accounting_Users → Modify
```

However, the corresponding SMB share is configured with:

```
Share Permissions:
Everyone → Read
```

The user's effective access over SMB will be limited to Read.

Typical symptoms include:

- Users can open the shared folder.
    
- Users can read existing files.
    
- Users cannot create new files.
    
- Users cannot save modifications.
    
- The NTFS Security tab appears correctly configured.


### Why Is This Easy to Miss?

Administrators often start by checking:

```
Folder Properties → Security
```

However, this tab displays **NTFS Permissions**, not SMB Share Permissions.

To inspect Share Permissions, navigate to:

```
Server Manager
  → File and Storage Services
  → Shares
  → Share Properties
  → Permissions
```

Alternatively, run:

```powershell
Get-SmbShareAccess -Name "Accounting"
```

If the output shows:

```
Name        AccountName  AccessControlType  AccessRight
----        -----------  -----------------  -----------
Accounting  Everyone     Allow              Read
```

it indicates that the share grants Everyone only Read access.

Even if the NTFS ACL allows Modify, that permission cannot override the restriction at the share level.

### What Should You Watch for When Reorganizing Shares?

The following operations may result in share configurations that differ from the original setup:

- Deleting and recreating an SMB share.
    
- Rebuilding a share using a different path.
    
- Reconfiguring a share after migrating folders.
    
- Creating a new share through a script or Server Manager without explicitly defining permissions.


One important distinction:

**Simply moving a folder does not necessarily reset the Share Permissions of an existing SMB share.**

However, if a share is deleted and recreated, the new share may not retain the original permission configuration.

Therefore, after reorganizing shared folders, always verify the SMB Share Permissions, even if the NTFS ACLs remain unchanged.

## 5. Recommended Permission Design

For environments with multiple departmental shares managed through AD Security Groups, a common approach is:

**Use Share Permissions to define the overall access boundary and NTFS Permissions to control access to individual folders and files.**

### Share Permissions

One common configuration is:

```
Everyone → Full Control
```

Detailed Read, Modify, and Delete permissions are then enforced through NTFS.

The main advantage of this approach is that administrators do not need to maintain the same granular permissions at two separate layers.

However, there are several considerations:

- Everyone: Full Control does not automatically mean that every user can modify all files.
    
- NTFS Permissions still restrict the operations users can perform.
    
- If NTFS permissions are accidentally configured too broadly, the share layer will not provide an additional restriction.
    
- Some organizations require Share Permissions to be limited to specific AD Security Groups.
    

Therefore, `Everyone: Full Control` is an optional permission-management model, not a universal requirement.

### NTFS Permissions

Using AD Security Groups for folder-level access control is recommended.

For example:

```
D:\Shares\Accounting
    Accounting_Read    → Read & Execute
    Accounting_Modify  → Modify
    SYSTEM             → Full Control
    Administrators     → Full Control
```

This structure is easier to maintain over time.

Recommended practices:

- Assign permissions through AD Security Groups rather than individual user accounts whenever possible.
    
- Use inheritance for folders that share the same access requirements.
    
- Adjust or disable inheritance when sensitive folders require different permissions.
    
- Review existing inherited Access Control Entries (ACEs) before changing inheritance.
    
- Use explicit Deny entries carefully, as they may affect access granted through other AD Groups.
    

**Do not disable inheritance on every folder simply to make ABE work.**

The correct approach is to design the ACL structure first, then decide where inheritance needs to be modified based on actual access requirements.

### ABE Configuration Recommendations

If a parent share contains folders for multiple departments or different permission levels, ABE can be enabled on that SMB share.

For example:

```
\\apps\Departments\
    Accounting\
    Finance\
    HR\
    IT\
```

Each department's NTFS permissions can be managed through dedicated AD Security Groups.

With ABE enabled, users will generally see only the departmental folders they are authorized to access.

However, there is one easily overlooked detail:

If a broad group such as `Domain Users` inherits Read access to every subfolder, ABE may not hide those folders as expected.

Therefore, **ABE behavior depends on the actual ACL configuration, not simply whether the Enable access-based enumeration option is checked.**

## 6. Useful PowerShell Commands

The following commands can be used to quickly inspect SMB Share, ABE, and NTFS configurations.

### List All SMB Shares

```powershell title="Powershell"
Get-SmbShare |
    Select-Object Name, Path, FolderEnumerationMode
```

### Check Share Permissions

```powershell title="Powershell"
Get-SmbShareAccess -Name "Accounting"
```

### Check Whether ABE Is Enabled

```powershell title="Powershell"
Get-SmbShare -Name "Accounting" |
    Select-Object Name, FolderEnumerationMode
```

### Enable ABE

```powershell title="Powershell"
Set-SmbShare -Name "Accounting" `
    -FolderEnumerationMode AccessBased
```

### Inspect NTFS ACLs

```powershell title="Powershell"
Get-Acl "D:\Shares\Accounting" |
    Select-Object -ExpandProperty Access
```

### Grant Full Control at the Share Level

```powershell title="Powershell"
Grant-SmbShareAccess -Name "Accounting" `
    -AccountName "Everyone" `
    -AccessRight Full `
    -Force
```

Note that this command adds or updates an Allow entry in the Share ACL. It does not automatically remove other existing entries, especially explicit Deny entries.

After making changes, use `Get-SmbShareAccess` to verify the complete Share ACL.

Before modifying permissions in production, confirm that the NTFS permissions on the target directory are correctly configured.

## 7. Quick Reference

|Requirement or Symptom|What to Check|
|---|---|
|Hide an SMB share from normal network browsing|Add `$` to the end of the share name|
|Hide subfolders from unauthorized users|ABE + NTFS Permissions|
|Folders remain visible even with ABE enabled|Effective user permissions, AD Group memberships, inherited ACLs|
|Users can read files but cannot modify them|Share Permissions + NTFS Permissions|
|Local access works, but UNC access is restricted|Share Permissions|
|Permissions behave unexpectedly after recreating a share|ACL of the new SMB share|
|Sensitive subfolders require separate access rules|NTFS ACLs and inheritance|
|Verify whether ABE works correctly|Test visibility and direct access using a standard domain user|

## Summary

The three Windows file-sharing mechanisms serve different purposes:

- **Hidden Shares (**`**$**`**):** Control whether an SMB share appears during normal share enumeration.
    
- **Access-Based Enumeration (ABE):** Controls which files and folders appear in directory listings based on users' effective access permissions.
    
- **Share Permissions + NTFS Permissions:** Work together to determine which operations users can perform on files over SMB.


In practice, the most important goal is to maintain a clear and predictable permission structure.

Use AD Security Groups whenever possible, design NTFS ACLs carefully, enable ABE where appropriate, and verify Share Permissions after creating, migrating, or reorganizing shared folders.

**Two important distinctions to remember:**

**Hiding a resource does not mean access is denied.**

**Having NTFS permissions does not necessarily mean a user has the same access over SMB.**