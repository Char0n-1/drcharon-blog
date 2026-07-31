---
title: Troubleshooting a Microsoft Entra Hybrid Join Device That Would Not Enroll in Intune
published: 2026-07-31
description: A complete troubleshooting walkthrough for a domain-joined Windows device stuck in Microsoft Entra Hybrid Join Pending state, including SCP discovery errors, stale Workplace Join cleanup, Intune auto-enrollment, PRT recovery, and Windows Hello for Business provisioning.
tags:
  - Entra-ID
  - Intune
  - Windows-Hello
  - Active-Directory
  - Troubleshooting
category: Microsoft 365
draft: false
lang: en
---
> The domain names, tenant ID, usernames, and selected device information in this article have been anonymized.

In a hybrid identity environment, joining a computer to the on-premises Active Directory domain does not mean that the device will automatically appear in Microsoft Intune.

The device normally has to complete the following stages:

```
Join the on-premises AD domain
        ↓
Synchronize the computer object to Microsoft Entra ID
        ↓
Complete Microsoft Entra Hybrid Join
        ↓
The user obtains a Primary Refresh Token
        ↓
Automatically enroll in Intune through Group Policy
        ↓
Receive device policies
        ↓
Provision Windows Hello for Business
```

In this case:

- The computer was already joined to the on-premises AD domain.
- The device object was visible in Microsoft Entra ID.
- The device remained in `Pending` status for a long time.
- The device did not appear in Intune.
- Windows Hello for Business could not be configured.

The issue was not caused by a single Intune enrollment failure. Several problems were involved:

1. The device had not actually completed Microsoft Entra Hybrid Join.
2. The device temporarily failed to read the Hybrid Join registration information from Active Directory
3. The user profile still contained an old Workplace Join registration.
4. The user therefore could not obtain an Entra Primary Refresh Token.
5. Intune automatic enrollment and Windows Hello only started working after the old Workplace Join was removed.

This article documents the complete troubleshooting process.

# Environment

The environment used in this case included:

- On-premises Active Directory
- Microsoft Entra Connect Sync
- Microsoft Entra Hybrid Join
- Microsoft Intune
- Windows 11
- Group Policy-based automatic MDM enrollment
- Windows Hello for Business
- Device name: `L108`
- On-premises domain: `corp.example.com`
- NetBIOS domain name: `CORP`

The target device was already joined to the on-premises AD domain:

```
L108.corp.example.com
```

---

# Symptoms

When searching for `L108` in the Microsoft Entra admin center, several device objects with the same name were displayed.

Some of them showed:

```
Join type: Microsoft Entra registered
```

Another one showed:

```
Join type: Microsoft Entra hybrid joined
Registered: Pending
MDM: None
```

The last object was the one corresponding to the on-premises AD computer object.

`Pending` means:

> Entra Connect has synchronized the on-premises AD computer object to Microsoft Entra ID, but the device itself has not yet completed Hybrid Join registration.

Because Hybrid Join had not actually completed, the later Intune automatic enrollment process had not started either.

# Microsoft Entra Registered vs. Hybrid Joined

The first step in this type of troubleshooting is to distinguish between two different device identities.

## Microsoft Entra registered

This type of registration is usually created when a user manually adds a work account from:

```
Settings
→ Accounts
→ Access work or school
→ Connect
```

It is a user-scoped Workplace Join registration.

If several users have connected their work accounts on the same computer, Microsoft Entra ID may contain multiple `Microsoft Entra registered` objects with the same device name.

## Microsoft Entra hybrid joined

This is the device-scoped relationship between the on-premises AD computer object and Microsoft Entra ID.

The expected local state is:

```
AzureAdJoined : YES
DomainJoined  : YES
```

For an on-premises domain-joined computer, the Hybrid Joined identity is normally the identity used for Intune automatic enrollment and Windows Hello for Business.

# TL;DR: Complete Repair Commands

> Use this sequence when an on-premises AD device has synchronized to Entra, but Hybrid Join remains `Pending`, the device is missing from Intune, and Windows Hello cannot be configured.

```powershell
# 1. Check the current Hybrid Join, PRT, Workplace Join, and MDM state
dsregcmd /status


# 2. Refresh computer Group Policy
gpupdate /force


# 3. Check and trigger the Microsoft Entra Hybrid Join task
Get-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"

Start-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"


# 4. Debug Hybrid Join
dsregcmd /debug /join


# 5. If a domain controller cannot be located, check DC discovery,
#    the computer secure channel, and whether a VPN connection is required
nltest /dsgetdc:corp.example.com
nltest /sc_verify:corp.example.com
Test-ComputerSecureChannel -Verbose


# 6. If error 0x801c001d appears, inspect the Active Directory SCP
$ConfigNC = ([ADSI]"LDAP://RootDSE").configurationNamingContext

$SCPPath = "LDAP://CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
           "CN=Device Registration Configuration," +
           "CN=Services,$ConfigNC"

$SCP = [ADSI]$SCPPath

$SCP.distinguishedName
$SCP.keywords


# 7. Confirm that the computer does not have an incorrect local tenant override
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CDJ\AAD"


# 8. Trigger Hybrid Join again and wait for the background task to finish
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"

Start-Sleep -Seconds 90

dsregcmd /debug /join
dsregcmd /status


# 9. After Hybrid Join succeeds, check for an old Workplace Join
# If dsregcmd shows WorkplaceJoined = YES:
# Settings > Accounts > Access work or school
# Disconnect the user's Work or school account
# Do not disconnect the on-premises AD domain connection


# 10. Sign out and sign back in with the user's own domain account
shutdown /l


# 11. After sign-in, verify the PRT, WAM state, and MDM URL
dsregcmd /status

# Expected state:
# AzureAdJoined    : YES
# DomainJoined     : YES
# WorkplaceJoined  : NO
# WamDefaultSet    : YES
# AzureAdPrt       : YES
# MdmUrl           : https://enrollment.manage.microsoft.com/...


# 12. Check the automatic MDM enrollment GPO
gpupdate /force

reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\MDM"

# Expected values:
# AutoEnrollMDM        REG_DWORD    0x1
# UseAADCredentialType REG_DWORD    0x1


# 13. Manually trigger Intune MDM enrollment
C:\Windows\System32\deviceenroller.exe /c /AutoEnrollMDM


# 14. Check whether the complete EnterpriseMgmt enrollment tasks were created
Get-ScheduledTask |
    Where-Object {
        $_.TaskPath -like "\Microsoft\Windows\EnterpriseMgmt\*"
    } |
    Select-Object TaskPath, TaskName, State


# 15. Check recent Intune MDM events
$Since = (Get-Date).AddMinutes(-10)

Get-WinEvent -FilterHashtable @{
    LogName   = "Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin"
    StartTime = $Since
} |
Select-Object TimeCreated, Id, LevelDisplayName, Message |
Format-List


# 16. Confirm that Windows Hello for Business can be provisioned
dsregcmd /status

# Expected state:
# IsDeviceJoined   : YES
# IsUserAzureAD    : YES
# PolicyEnabled    : YES
# DeviceEligible   : YES
# PreReqResult     : WillProvision
```

# Step 1: Check the Local Device State

Run the following command on the device:

```powershell
dsregcmd /status
```

At the beginning of the investigation, the device showed:

```powershell
AzureAdJoined : NO
DomainJoined  : YES
```

This meant that:

- The computer was joined to the on-premises AD domain.
    
- The computer had not completed Microsoft Entra Hybrid Join.
    

This matched the `Pending` status shown in Entra.

---

# Step 2: Manually Trigger Hybrid Join

Microsoft Entra Hybrid Join is normally triggered by the following scheduled task:

```
\Microsoft\Windows\Workplace Join\Automatic-Device-Join
```

First, refresh computer policy:

```powershell
gpupdate /force
```

Check whether the task exists:

```powershell
Get-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"
```

Start it manually:

```powershell
Start-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"
```

The same task can also be started with:

```powershell
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"
```

After waiting for a short time, check the device again:

```powershell
dsregcmd /status
```

The device had still not completed registration, so the next command was used:

```powershell
dsregcmd /debug /join
```

---

# First Error: A Domain Controller Could Not Be Located

The first attempt returned:

```powershell
DsrCmdAccountMgr::IsDomainControllerAvailable:
DsGetDcName No domain controller is available for the specified domain
or the domain does not exist: 0x8007054b.

preCheckResult: DoNotJoin
isDcAvailable: NO

The device can NOT be joined because a domain controller could not be located.
```

This meant that the device could not locate a domain controller when the Hybrid Join task ran.

The computer was not connected to the corporate network at that time, so a VPN connection was required before the domain controller could be reached.

Domain controller discovery was tested with:

```powershell
nltest /dsgetdc:corp.example.com
```

A successful result looked similar to:

```powershell
DC: \\DC2.corp.example.com
Address: \\192.168.1.8
Flags: GC DS LDAP KDC TIMESERV WRITABLE DNS_DC
```

The computer secure channel was then checked:

```powershell
nltest /sc_verify:corp.example.com
```

The result was:

```powershell
Trusted DC Connection Status Status = 0 0x0 NERR_Success
Trust Verification Status = 0 0x0 NERR_Success
```

This confirmed that:

- The device could locate a domain controller after the VPN was connected.
    
- The computer account secure channel was healthy.
    
- The earlier domain controller failure was caused by temporary network or DC discovery conditions rather than a broken computer account.
    

---

# Second Error: Hybrid Join Registration Data Could Not Be Read from AD

Running the following command again:

```powershell
dsregcmd /debug /join
```

returned:

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

The main error code was:

```powershell
0x801c001d
```

The device could now reach a domain controller, but it could not read the tenant registration information required for Microsoft Entra Hybrid Join from Active Directory.

The Hybrid Join client normally reads the following values from the Active Directory Service Connection Point, or SCP:

```powershell
azureADName
azureADId
```

---

# Step 3: Check the Active Directory SCP

On a domain controller, or on a management computer with the Active Directory PowerShell module installed, run:

```powershell
$ConfigNC = (Get-ADRootDSE).configurationNamingContext

$SCPPath = "CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
           "CN=Device Registration Configuration," +
           "CN=Services,$ConfigNC"

$SCP = [ADSI]"LDAP://$SCPPath"

$SCP.distinguishedName
$SCP.keywords
```

The result was similar to:

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

This confirmed that the SCP object existed and that the tenant ID was correct.

Using a `.onmicrosoft.com` value for `azureADName` is not inherently a problem, provided that it is a verified domain in the tenant.

---

# Step 4: Read the SCP Directly from the Affected Computer

To rule out a domain controller or AD replication issue, the same SCP was queried directly from L108:

```powershell
$ConfigNC = ([ADSI]"LDAP://RootDSE").configurationNamingContext

$SCPPath = "LDAP://CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
           "CN=Device Registration Configuration," +
           "CN=Services,$ConfigNC"

$SCP = [ADSI]$SCPPath

$SCP.distinguishedName
$SCP.keywords
```

L108 successfully returned:

```powershell
azureADName:tenant.onmicrosoft.com
azureADId:00000000-0000-0000-0000-000000000000
```

The current domain controller was then specified explicitly:

```powershell
$SCPDN = "CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
         "CN=Device Registration Configuration," +
         "CN=Services,CN=Configuration,DC=corp,DC=example,DC=com"

$SCP = [ADSI]"LDAP://DC2.corp.example.com/$SCPDN"

$SCP.distinguishedName
$SCP.keywords
```

This query also succeeded.

The results confirmed that:

- The SCP existed.
- DC2 contained the correct SCP information.
- The administrator could read the SCP from L108.
- Replication of the AD Configuration partition appeared to be working correctly.

---

# Step 5: Check for a Local Tenant Override

Windows can use a local registry configuration to override the Active Directory SCP.

Check the following path:

```powershell
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CDJ\AAD"
```

The computer returned:

```powershell
ERROR: The system was unable to find the specified registry key or value.
```

This was a normal result.

When the key does not exist, Windows continues to use the Active Directory SCP.

If the key exists, check that these values match the current tenant:

```powershell
TenantId
TenantName
```

An incorrect tenant ID, an old domain name, or an empty value can override an otherwise correct SCP configuration.

---

# Step 6: Wait for the Existing Join Task to Finish

The scheduled task was started again:

```powershell
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"
```

Immediately running:

```powershell
dsregcmd /debug /join
```

returned:

```powershell
Another instance of the Join Task is already running.
Please retry after sometime.
```

This indicated that the scheduled task was still running in the background.

At this point, repeatedly starting additional join processes would not help. The correct action was to wait for the current task to finish.

After a few minutes, the command was run again:

```powershell
dsregcmd /debug /join
```

This time the output showed:

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

The important fields were:

```powershell
deviceKeysHealthy: YES
isJoined: YES
```

This confirmed that the device had successfully completed Microsoft Entra Hybrid Join.

---

# Step 7: Verify the Hybrid Join State

Run:

```powershell
dsregcmd /status
```

The device state had changed to:

```powershell
AzureAdJoined    : YES
DomainJoined     : YES
DeviceAuthStatus : SUCCESS
```

For example:

```powershell
Device State
------------

AzureAdJoined : YES
DomainJoined  : YES
DomainName    : CORP
Device Name   : L108.corp.example.com
```

The device details also showed:

```powershell
DeviceAuthStatus : SUCCESS
TpmProtected     : YES
KeyProvider      : Microsoft Platform Crypto Provider
```

This meant that:

- The device certificate was valid.
- The private key was protected by the TPM.
- Microsoft Entra ID could authenticate the device.
- Hybrid Join had completed successfully.

The Hybrid Joined object that previously showed:

```powershell
Registered: Pending
```

would then update to a specific registration time in the Entra admin center.

---

# Step 8: Identify the Old Workplace Join

Although Hybrid Join was now working, the user context still showed:

```powershell
WorkplaceJoined : YES
WorkAccountCount: 1
AzureAdPrt      : NO
```

There was also a separate Workplace device ID:

```powershell
WorkplaceDeviceId : 08486976-c661-4d5a-8648-730a4200c3ee
```

This meant that the user profile still contained an old user-scoped device identity.

```powershell
Microsoft Entra registered
```


This registration had probably been created when the user previously added a work account from:

```powershell
Settings
→ Accounts
→ Access work or school
→ Connect
```

The same computer could therefore have:

- One Hybrid Joined device object.
- One or more Entra Registered device objects.

An old Workplace Join does not always block Hybrid Join, but it can contribute to:

- Conflicting user device identities.
- An incorrect WAM default account.
- Failure to obtain a PRT.
- Incomplete MDM discovery information.
- Intune automatic enrollment not starting.
- Windows Hello for Business provisioning failures.

---

# Step 9: Remove the Old Work or School Account

In the user's own Windows session, open:

```
Settings
→ Accounts
→ Access work or school
```

Two different connections may be shown.

Remove the user-scoped connection:

```
user@example.com
Work or school account
```

Do not remove:

```
corp.example.com
Connected to CORP AD domain
```

The first connection is the old Workplace Join.

The second connection is the on-premises Active Directory domain relationship. Disconnecting it would remove the computer from the domain.

After disconnecting the old work account, sign out:

```powershell
shutdown /l
```

Then sign back in with the user's on-premises domain account.

---

# Step 10: Recheck the User Identity State

After signing back in, run:

```powershell
dsregcmd /status
```

The user state changed to:

```powershell
WorkplaceJoined : NO
WamDefaultSet   : YES
AzureAdPrt      : YES
```

The Tenant Details section also contained the complete MDM URLs:

```powershell
TenantName       : example.com
MdmUrl           : https://enrollment.manage.microsoft.com/enrollmentserver/discovery.svc
MdmTouUrl        : https://portal.manage.microsoft.com/TermsofUse.aspx
MdmComplianceUrl : https://portal.manage.microsoft.com/?portalAction=Compliance
```

The SSO state showed:

```powershell
AzureAdPrt : YES
CloudTgt   : YES
```

This confirmed that:

- The user had obtained a Primary Refresh Token.
- Windows Web Account Manager was using the correct default identity.
- The user was included in the MDM automatic enrollment scope.
- Intune MDM discovery had succeeded.

---

# What Is an Entra PRT?

PRT stands for:

```
Primary Refresh Token
```

It is a long-lived identity token issued by Microsoft Entra ID after the user signs in to Windows.

It is used for:

- Microsoft 365 single sign-on.
    
- Conditional Access.
    
- Intune automatic enrollment.
    
- Windows Hello for Business.
    
- Enterprise application authentication.
    

For a Hybrid Joined device, the expected state is normally:

```powershell
AzureAdJoined : YES
DomainJoined  : YES
AzureAdPrt    : YES
```

A device completing Hybrid Join does not automatically mean that the user has obtained a PRT.

Device identity and user identity must be checked separately.

---

# Step 11: Check the Automatic MDM Enrollment GPO

Run the following from an elevated PowerShell window:

```powershell
gpupdate /force
```

Then check the registry:

```powershell
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\MDM"
```

The computer returned:

```powershell
AutoEnrollMDM         REG_DWORD    0x1
UseAADCredentialType  REG_DWORD    0x1
MDMApplicationId      REG_SZ
```

This confirmed that the automatic MDM enrollment GPO was applied.

The corresponding Group Policy setting is located at:

```
Computer Configuration
→ Policies
→ Administrative Templates
→ Windows Components
→ MDM
→ Enable automatic MDM enrollment using default Microsoft Entra credentials
```

For a standard user-based Hybrid Joined device, the configuration is normally:

```
Enabled
Credential Type: User Credential
```

---

# Step 12: Check the EnterpriseMgmt Tasks

Run:

```powershell
Get-ScheduledTask |
    Where-Object {
        $_.TaskPath -like "\Microsoft\Windows\EnterpriseMgmt\*"
    } |
    Select-Object TaskPath, TaskName, State
```

A complete enrollment task folder had been created on the device:

```powershell
\Microsoft\Windows\EnterpriseMgmt\
\Microsoft\Windows\EnterpriseMgmt\236348F8-2E95-4D98-BB22-D71AFD9B03B4\
```

It contained tasks such as:

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

This confirmed that a formal MDM enrollment had been created.

The enrollment ID was:

```powershell
236348F8-2E95-4D98-BB22-D71AFD9B03B4
```

---

# Step 13: Manually Trigger MDM Enrollment

The following command can be used to trigger enrollment manually:

```powershell
C:\Windows\System32\deviceenroller.exe /c /AutoEnrollMDM
```

The command normally does not display a window or return visible output.

Wait for one minute:

Then review the recent MDM events:

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

# Step 14: Confirm That the Device Is Receiving Intune Policies

The log contained many new MDM PolicyManager events:

```powershell
MDM PolicyManager: Set policy int
EnrollmentID requesting merge: 236348F8-2E95-4D98-BB22-D71AFD9B03B4
Enrollment Type: 0x6
Current User: Device
```

Application installation events also appeared:

```powershell
EnterpriseDesktopAppManagement CSP:
Application content download started.
```

and:

```powershell
MDMAppInstaller task has started.
```

This confirmed that the device had not only completed enrollment, but was actively:

- Receiving Intune configuration profiles.
- Receiving Microsoft Defender policies.
- Receiving Device Health Monitoring settings.
- Downloading assigned applications.
- Performing MDM synchronization.

---

# Step 15: Verify Windows Hello for Business

The final `dsregcmd /status` output showed:

```powershell
NgcSet             : NO
IsDeviceJoined     : YES
IsUserAzureAD      : YES
PolicyEnabled      : YES
PostLogonEnabled   : YES
DeviceEligible     : YES
SessionIsNotRemote : YES
PreReqResult       : WillProvision
```

The most important field was:

```powershell
PreReqResult : WillProvision
```

This meant that Windows considered both the device and the user eligible for Windows Hello for Business provisioning.

At this point, the user could sign out and sign back in:

```powershell
shutdown /l
```

Windows should then display:

```
Your organization requires you to set up Windows Hello
```

Windows Hello can also be configured manually from:

```
Settings
→ Accounts
→ Sign-in options
→ PIN (Windows Hello)
→ Set up
```

The user can then create the PIN.

---

# About the MDM Policy Warning from gpupdate

During troubleshooting, `gpupdate /force` returned:

```powershell
Windows failed to apply the MDM Policy settings.
MDM Policy settings might have its own log file.
```

At the same time, the registry already contained:

```powershell
AutoEnrollMDM = 1
UseAADCredentialType = 1
```

The device had also created the complete EnterpriseMgmt task set and had started receiving Intune policy.

The warning therefore did not mean that enrollment had failed.

Later events also contained:

```powershell
ADMXInstall
0x86000009
The system cannot find the file specified.
```

This was more consistent with a failure to process a specific MDM ADMX policy than with a failure of automatic enrollment itself.

That policy issue should be investigated separately, but it did not change the conclusion that Hybrid Join and Intune enrollment were working.

---

# About the BitLocker Warnings

The event log also contained:

```
OS Drive not protected.
```

and:

```
TPM not used for protection of OS Drives,
but is required by policy.
```

This showed that Intune had started evaluating the device's BitLocker state, but the operating system drive did not yet meet the configured policy requirements.

If the organization's compliance policy requires BitLocker, the device may temporarily appear as:

```
Not compliant
```

This is a separate issue from Hybrid Join, MDM enrollment, and Windows Hello, and should be handled independently.

---

# Final State

After troubleshooting, L108 had the following final state.

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
PolicyEnabled  : YES
DeviceEligible : YES
PreReqResult   : WillProvision
```

## EnterpriseMgmt

```powershell
A complete enrollment GUID task folder was created.
The device started receiving Intune policies and applications.
```

---

# Root Cause Summary

The issue was not simply, "The computer is in AD, so why did it not automatically appear in Intune?"

The actual sequence was:

```
The on-premises AD computer object was synchronized to Entra
        ↓
The device appeared as Hybrid Joined / Pending in Entra
        ↓
The local device still showed AzureAdJoined = NO
        ↓
The Hybrid Join task initially could not locate a domain controller
        ↓
The SCP discovery error 0x801c001d appeared
        ↓
Hybrid Join succeeded after the Automatic-Device-Join task completed
        ↓
The user profile still contained an old Workplace Join
        ↓
AzureAdPrt = NO
        ↓
The MDM URL was empty
        ↓
Intune automatic enrollment could not complete normally
        ↓
The old Work or school account was removed
        ↓
The user signed back in and obtained a PRT
        ↓
The MDM URL appeared
        ↓
The EnterpriseMgmt enrollment was created
        ↓
The device started receiving Intune policies
        ↓
Windows Hello changed to WillProvision
```

---

# Troubleshooting Approach Summary

The most important lesson from this case is not to treat the following states as if they were the same thing:

```
Joining the on-premises AD domain
Synchronizing the device object through Entra Connect
Microsoft Entra Hybrid Join
User Workplace Join
The user obtaining an Entra PRT
Intune MDM enrollment
Windows Hello for Business provisioning
```

They are separate stages.

A device appearing in Entra only proves that a cloud object exists. It does not prove that the local device has completed registration.

When a device displays `Microsoft Entra hybrid joined` but still shows `Registered = Pending`, the first local check should be:

```powershell
dsregcmd /status
```

If the result is:

```powershell
AzureAdJoined : NO
```

Hybrid Join must be repaired before troubleshooting Intune enrollment.

After Hybrid Join succeeds, if the device shows:

```powershell
WorkplaceJoined : YES
AzureAdPrt      : NO
```

check for an old user-scoped Work or school account.

Intune automatic enrollment and Windows Hello have a reliable foundation only when the following states are all healthy:

```powershell
AzureAdJoined    : YES
DomainJoined     : YES
DeviceAuthStatus : SUCCESS
WorkplaceJoined  : NO
AzureAdPrt       : YES
MdmUrl           : not empty
PolicyEnabled    : YES
```

---

# Troubleshooting Toolbox

## Check Hybrid Join Status

```powershell
dsregcmd /status
```

Important fields:

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

## Debug Hybrid Join Manually

```powershell
dsregcmd /debug /join
```

---

## Trigger Automatic Device Join

```powershell
Start-ScheduledTask `
    -TaskPath "\Microsoft\Windows\Workplace Join\" `
    -TaskName "Automatic-Device-Join"
```

or:

```powershell
schtasks /Run /TN "\Microsoft\Windows\Workplace Join\Automatic-Device-Join"
```

---

## Check Domain Controller Discovery

```powershell
nltest /dsgetdc:corp.example.com
```

---

## Check the Computer Secure Channel

```powershell
nltest /sc_verify:corp.example.com
```

or:

```powershell
Test-ComputerSecureChannel -Verbose
```

---

## Check the Active Directory SCP

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

## Read the SCP from a Specific Domain Controller

```powershell
$SCPDN = "CN=62a0ff2e-97b9-4513-943f-0d221bd30080," +
         "CN=Device Registration Configuration," +
         "CN=Services,CN=Configuration,DC=corp,DC=example,DC=com"

$SCP = [ADSI]"LDAP://DC2.corp.example.com/$SCPDN"

$SCP.distinguishedName
$SCP.keywords
```

---

## Check the Local Hybrid Join Tenant Override

```powershell
reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\CDJ\AAD"
```

---

## Check the MDM Automatic Enrollment GPO

```powershell
reg query "HKLM\SOFTWARE\Policies\Microsoft\Windows\CurrentVersion\MDM"
```

The expected result includes:

```
AutoEnrollMDM = 1
```

---

## Generate a Group Policy Report

```powershell
New-Item C:\Temp -ItemType Directory -Force | Out-Null

gpresult /scope computer /h C:\Temp\GPReport.html

Start-Process C:\Temp\GPReport.html
```

---

## Check EnterpriseMgmt Tasks

```powershell
Get-ScheduledTask |
    Where-Object {
        $_.TaskPath -like "\Microsoft\Windows\EnterpriseMgmt\*"
    } |
    Select-Object TaskPath, TaskName, State
```

---

## Manually Trigger MDM Enrollment

```powershell
C:\Windows\System32\deviceenroller.exe /c /AutoEnrollMDM
```

---

## View Recent MDM Events

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

## View Hybrid Join Events

```powershell
Get-WinEvent `
    -LogName "Microsoft-Windows-User Device Registration/Admin" `
    -MaxEvents 50 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

---

## View Entra Identity Events

```powershell
Get-WinEvent `
    -LogName "Microsoft-Windows-AAD/Operational" `
    -MaxEvents 100 |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List
```

---

## Sign Out the Current User

```powershell
shutdown /l
```

---

## Lock the Computer

```powershell
rundll32.exe user32.dll,LockWorkStation
```

---

# Conclusion

The most misleading part of this incident was that the device already appeared in Microsoft Entra ID and its Join Type was shown as Microsoft Entra hybrid joined.

However, as long as the object still showed:

```
Registered: Pending
```

Hybrid Join had not been completed successfully.

The local command:

```powershell
dsregcmd /status
```

should be treated as the primary source of truth when troubleshooting the device registration state.

In the end, L108 successfully enrolled in Intune and met the requirements for Windows Hello for Business after Hybrid Join completed, the old Workplace Join was removed, and the user obtained a new PRT.