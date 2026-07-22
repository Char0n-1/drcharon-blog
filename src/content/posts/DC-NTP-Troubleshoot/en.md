---
title: Complete Troubleshooting Guide for Windows Time Synchronization Issues in an Active Directory Domain
published: 2026-07-10
description: A complete troubleshooting record of a non-PDC Domain Controller using Local CMOS Clock and generating Windows Time Service Event ID 129.
tags:
  - NTP
  - W32Time
  - Troubleshooting
  - Active-Directory
  - Windows-Server
category: Infrastructure
lang: en
draft:
---
# Introduction

In Active Directory, time synchronization is a foundation for almost every authentication process.

Kerberos, Active Directory replication, certificates, Group Policy, and many other components all depend on accurate time.

The recommended domain time hierarchy is not complicated:

```
Internet NTP
     │
     ▼
PDC Emulator
     │
     ▼
Other Domain Controllers
     │
     ▼
Domain Members
```

However, we encountered an unusual issue in our environment:

- The PDC Emulator was already configured to use public NTP servers
    
- The Domain Controllers could communicate with one another
    
- DNS was working
    
- Active Directory was healthy
    
- The Secure Channel was healthy
    

Yet some Domain Controllers continued to use:

```
Local CMOS Clock
```

The final investigation showed that the issue was not with the public NTP servers, DNS, basic network connectivity, or Active Directory itself. The fault was isolated to the local Windows Time Service configuration or service state on the affected Domain Controller.

This article documents the complete troubleshooting process and the reasoning that proved most useful along the way.

---

# NTP Fundamentals in an Active Directory Domain

Before troubleshooting, it is important to understand how time synchronization works in a Windows domain.

In a workgroup environment, each Windows device can synchronize directly with a specified public NTP server. In an Active Directory environment, however, Windows normally relies on the **domain hierarchy provided by Windows Time Service**.

The Windows Time Service is named:

```
W32Time
```

It maintains the Windows system clock and provides the time foundation required by Kerberos, Active Directory, certificate validation, and other time-sensitive services.

## Why Time Matters in a Domain

Active Directory does not require every device to have exactly the same clock value, but the difference between systems must stay within an acceptable range.

Kerberos is the most common example. Kerberos tickets include timestamps to help prevent replay attacks. If a client, server, and Domain Controller differ too much in time, the environment may experience:

- Users being unable to sign in with domain accounts
    
- Kerberos authentication failures
    
- Repeated password prompts when accessing file shares
    
- Group Policy processing failures
    
- Active Directory replication or Secure Channel problems
    
- Certificates being treated as not yet valid or already expired
    
- Inconsistent timestamps across logs
    

Time synchronization in a domain is therefore not only about displaying the correct time in the taskbar. It is part of the authentication architecture itself.

## Domain Time Hierarchy

In a single-forest, single-domain environment, the standard time hierarchy normally looks like this:

```
Public NTP Server
        │
        ▼
Forest Root Domain PDC Emulator
        │
        ▼
Other Domain Controllers
        │
        ▼
Domain Member Servers and Workstations
```

The **PDC Emulator** in the forest root domain sits at the top of the domain time hierarchy.

It should obtain time from a reliable external source, such as:

- An internal GPS clock
    
- A trusted network device
    
- A public NTP service
    

Other domain devices then synchronize through the Active Directory hierarchy.

## The Role of the PDC Emulator

Active Directory has five FSMO roles. In addition to password updates, account lockout handling, and compatibility-related functions, the PDC Emulator also has a central role in domain time synchronization.

To identify the current PDC Emulator:

```
netdom query fsmo
```

You can also use the Active Directory PowerShell module:

```
Get-ADDomain | Select-Object PDCEmulator
```

Only the current PDC Emulator should normally be explicitly configured as the reliable external time source for the domain.

For example:

```
w32tm /config `
    /manualpeerlist:"time.cloudflare.com,0x8 time.google.com,0x8" `
    /syncfromflags:manual `
    /reliable:yes `
    /update
```

The parameters mean:

- `/manualpeerlist`: Specifies the external NTP peers
    
- `/syncfromflags:manual`: Uses the manually configured time sources
    
- `/reliable:yes`: Marks the server as a reliable time source for the domain
    
- `/update`: Tells Windows Time Service to reload its configuration
    

After configuration, restart the service and request synchronization:

```
Restart-Service w32time
w32tm /resync /force
```

## The Difference Between `NT5DS` and `NTP`

Use the following command to view the current synchronization mode:

```
w32tm /query /configuration
```

The most important value is:

```
Type
```

### `Type: NTP`

This means the computer uses manually specified NTP peers.

This mode is commonly appropriate for:

- The PDC Emulator
    
- Non-domain devices
    
- Special isolated systems
    
- Devices that cannot use the Active Directory time hierarchy
    

### `Type: NT5DS`

This means the computer discovers a time source through the Active Directory domain hierarchy.

This mode is normally appropriate for:

- Non-PDC Domain Controllers
    
- Domain member servers
    
- Domain-joined workstations
    

A non-PDC server should generally not point directly to a public NTP server. It should remain configured as:

```
Type: NT5DS
```

## Member Servers Do Not Always Synchronize Directly with the PDC

Using `NT5DS` does not mean that every domain member connects directly to the PDC Emulator.

A member server may show:

```
Source: DC01.example.local
```

instead of:

```
Source: PDC01.example.local
```

This is not necessarily a problem.

As long as DC01 ultimately receives correct time from the PDC Emulator, the following chain is valid:

```
Public NTP
    │
    ▼
PDC Emulator
    │
    ▼
DC01
    │
    ▼
Member Server
```

When validating time synchronization, do not look only at whether one server points directly to the PDC. Confirm that the complete upstream chain ultimately traces back to the PDC Emulator.

## Useful Diagnostic Commands

View the current time source:

```
w32tm /query /source
```

View detailed synchronization status:

```
w32tm /query /status
```

View the full configuration:

```
w32tm /query /configuration
```

View manually configured peers:

```
w32tm /query /peers
```

Check the time status of all Domain Controllers:

```
w32tm /monitor
```

Measure the time offset from a specified source:

```
w32tm /stripchart /computer:PDC01.example.local /samples:5 /dataonly
```

View recent Windows Time Service events:

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 20 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

---

# Troubleshooting Environment

All server names, domain names, and IP addresses in this article have been anonymized.

The affected environment was a long-running, single-forest, single-domain Active Directory deployment with four Domain Controllers:

|Example Name|Role|Expected Time Source|
|---|---|---|
|PDC01|PDC Emulator and FSMO role holder|External public NTP|
|DC01|Standard Domain Controller|Domain hierarchy|
|DC02|Standard Domain Controller|Domain hierarchy|
|DC03|Standard Domain Controller|Domain hierarchy|

The domain also contained multiple Windows member servers and workstations.

The expected time architecture was:

```
External NTP
      │
      ▼
PDC01 — PDC Emulator
      │
      ▼
DC01 / DC02 / DC03
      │
      ▼
Member Servers and Workstations
```

The intended configuration was:

- PDC01 uses `Type: NTP`
    
- PDC01 is the only server explicitly configured as the reliable external time source
    
- Other Domain Controllers use `Type: NT5DS`
    
- Member servers and workstations use `Type: NT5DS`
    
- Domain members may synchronize with another healthy Domain Controller instead of connecting directly to the PDC
    

---

# Symptoms

On the affected Domain Controller, I first checked the current time source:

```
w32tm /query /source
```

The result was:

```
Local CMOS Clock
```

I then checked the detailed status:

```
w32tm /query /status
```

The important values were:

```
Stratum: 1
ReferenceId: LOCL
Source: Local CMOS Clock
```

This meant that the Domain Controller was not using an upstream domain time source. It was relying directly on its own hardware clock.

For a non-PDC Domain Controller, this was clearly not the expected state.

---

# Step 1: Identify the PDC Emulator

I first confirmed all FSMO role holders:

```
netdom query fsmo
```

The output showed that all FSMO roles were located on:

```
PDC01.example.local
```

The PDC role also correctly pointed to PDC01.

I then used the PDC Locator directly:

```
nltest /dsgetdc:example.local /PDC
```

The result was similar to:

```
DC: \\PDC01.example.local
Flags: PDC GC DS LDAP KDC TIMESERV GTIMESERV
```

This confirmed that Active Directory could correctly identify the current PDC Emulator.

---

# Step 2: Validate the PDC External Time Source

On PDC01, I checked the current time source:

```
w32tm /query /source
```

The output showed the configured public sources:

```
time.cloudflare.com,time.google.com
```

I then checked the synchronization status:

```
w32tm /query /status
```

The important values were similar to:

```
Leap Indicator: 0 (no warning)
Stratum: 4
Source: time.cloudflare.com,time.google.com
Last Successful Sync Time: <timestamp>
```

Next, I reviewed the complete configuration:

```
w32tm /query /configuration
```

The important values were:

```
Type: NTP
AnnounceFlags: 5
NtpServer: time.cloudflare.com,time.google.com
```

These results confirmed that:

- The PDC Emulator could synchronize with the external NTP sources
    
- Windows Time Service was running correctly on the PDC
    
- The external NTP configuration was not the main cause of the incident
    

---

# Step 3: Inspect the Actual Configuration on the Affected DC

Back on DC01, I checked the full configuration:

```
w32tm /query /configuration
```

The key result was:

```
Type: NT5DS
```

This meant DC01 was configured to discover a time source through the Active Directory domain hierarchy.

As a non-PDC Domain Controller, it should locate an appropriate upstream domain time source. In this single-domain environment, its time chain should ultimately trace back to the PDC Emulator.

However, another source check still returned:

```
w32tm /query /source
```

```
Local CMOS Clock
```

This revealed the first major contradiction:

- The configuration said the server should use `NT5DS`
    
- The actual runtime state showed `Local CMOS Clock`
    

For this reason, `Type: NT5DS` alone was not enough to conclude that the server was healthy. The configuration had to be compared with the active source and synchronization status.

---

# Step 4: Use `w32tm /monitor` to Check the Entire Domain

To determine whether the problem affected only DC01, I ran:

```
w32tm /monitor
```

The output showed several notable conditions:

```
DC01
    RefID: LOCL
    Stratum: 1
    Offset: approximately -61 seconds

PDC01
    RefID: external NTP source
    Stratum: 4

DC02
    RefID: another external NTP source

DC03
    NTP query timeout
```

This suggested that the environment had more than one time configuration issue:

- DC01 had fallen back to `Local CMOS Clock`
    
- DC02 might still have a historical configuration that synchronized directly with a public NTP source
    
- DC03 did not respond to the NTP query
    
- Only PDC01 matched the expected design
    

Although the incident was first noticed on DC01, the monitor output exposed historical inconsistencies across the domain time configuration.

---

# Step 5: Validate the Active Directory Foundation

Because `NT5DS` depends on Active Directory to discover a domain time peer, I next verified that DC01 could access the domain, locate the PDC, and maintain a healthy Secure Channel.

## Check the Secure Channel

```
Test-ComputerSecureChannel -Verbose
```

Output:

```
True
```

I also verified it with:

```
nltest /sc_verify:example.local
```

Result:

```
NERR_Success
```

This confirmed that the machine account and Secure Channel were healthy.

## Locate the PDC Emulator Explicitly

```
nltest /dsgetdc:example.local /PDC
```

Result:

```
DC: \\PDC01.example.local
```

This confirmed that the PDC Locator worked correctly.

## List All Domain Controllers

```
nltest /dclist:example.local
```

All Domain Controllers appeared in the list, and PDC01 was correctly marked as the PDC.

## Confirm the FSMO Roles Again

```
netdom query fsmo
```

The roles still pointed correctly to PDC01.

## Check DNS and Basic Connectivity

```
nslookup PDC01
```

The name resolved successfully.

```
ping PDC01
```

Basic network connectivity was also successful.

At this stage, the following components had been validated:

- Secure Channel
    
- DC Locator
    
- PDC Locator
    
- FSMO role ownership
    
- DNS
    
- Basic network communication
    

The issue still remained.

---

# Step 6: Review the Windows Time Service Logs

I then reviewed Windows Time Service events in the System log:

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 20 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

The log contained Event ID 129:

```
NtpClient was unable to set a domain peer to use as a time source because of discovery error.

The error was:

The entry is not found.
```

This was the most important event in the investigation.

It showed that the problem was not simply that Windows had selected a time source but failed to receive time data.

More precisely, Windows Time Service failed during the domain peer discovery stage.

In other words:

- This was not merely NTP packet loss after selecting the PDC
    
- W32Time had failed to establish the Domain Peer it was supposed to use
    

That distinction changed the direction of the troubleshooting process.

---

# Step 7: Analyze the Local W32Time Configuration

I checked the configuration again:

```
w32tm /query /configuration
```

The following combination appeared:

```
Type: NT5DS
AnnounceFlags: 5
```

`Type: NT5DS` meant that the server should discover its time source through the Active Directory hierarchy.

`AnnounceFlags: 5` is commonly associated with a server advertising itself as a reliable time source.

It is important to note that a Domain Controller acting as both a time client and a time server is not inherently a conflict. A DC can synchronize from an upstream server while providing time to downstream domain members.

The important issue was the combination of the following facts:

- DC01 was not the current PDC Emulator
    
- It was still marked as a reliable time source
    
- It was using only `Local CMOS Clock`
    
- Windows Time Service was reporting a Domain Peer discovery failure
    

This suggested that the local W32Time configuration or service state on DC01 might contain historical manual settings, remnants from a previous role configuration, or another inconsistent local state.

`AnnounceFlags: 5` alone did not prove that it was the only direct cause of Event ID 129. However, when combined with all other findings, it was reasonable to isolate the fault to the local Windows Time Service configuration or state on DC01.

At this point, repeatedly running the following command was unlikely to help:

```
w32tm /resync
```

The service had not established a valid Domain Peer in the first place.

---

# Step 8: Re-register Windows Time Service

Instead of adding more registry settings or NTP configuration on top of the existing state, I decided to return Windows Time Service to a cleaner default state.

Stop the service:

```
net stop w32time
```

Unregister Windows Time Service:

```
w32tm /unregister
```

Register it again:

```
w32tm /register
```

Start the service:

```
net start w32time
```

Then explicitly restore the expected domain hierarchy mode for a non-PDC Domain Controller:

```
w32tm /config /syncfromflags:domhier /reliable:no /update
```

Finally, request synchronization and force domain rediscovery:

```
w32tm /resync /rediscover
```

Note that the following command does not exist as a standalone command:

```
w32tm /rediscover
```

`/rediscover` must be used as a parameter of `/resync`.

---

# Step 9: Verify the Repair

After the repair, I checked the source again:

```
w32tm /query /source
```

The result immediately changed to:

```
PDC01.example.local
```

This confirmed that Windows Time Service had rediscovered the correct domain time source.

I then checked:

```
w32tm /query /status
```

The important values to confirm were:

- `Source` pointed to a healthy domain time source
    
- `Last Successful Sync Time` had updated
    
- `ReferenceId` was no longer `LOCL`
    
- `Stratum` was no longer the local reference clock value of 1
    

I also reviewed the complete configuration again:

```
w32tm /query /configuration
```

The server still correctly showed:

```
Type: NT5DS
```

and the non-PDC Domain Controller was no longer configured as a reliable root time source.

Finally, I checked the recent events again:

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 10 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

No new Event ID 129 entries continued to appear after the repair.

---

# Step 10: Why Some Member Servers Still Synchronized with DC01

After DC01 was repaired, I checked several member servers and found that:

```
w32tm /query /source
```

returned:

```
DC01.example.local
```

At first, this could suggest that a Group Policy had previously forced those servers to use DC01.

I then checked:

```
w32tm /query /configuration
```

The important values were:

```
Type: NT5DS (Local)
AnnounceFlags: 10 (Local)
NtpServer Enabled: 0 (Local)
```

This showed that:

- The server was not using a manually configured NTP peer
    
- The local NTP Server Provider was disabled
    
- The server was automatically selecting a source through the Active Directory hierarchy
    
- Selecting DC01 as its current time partner was normal behavior
    

The actual time chain was:

```
External NTP
      │
      ▼
PDC01
      │
      ▼
DC01
      │
      ▼
Member Server
```

As long as DC01 remained synchronized with PDC01, this was a normal and supported domain time hierarchy.

## Additional Check: Was the Configuration Applied by Group Policy?

You can generate a Resultant Set of Policy report with:

```
gpresult /h C:\Temp\gpresult.html
```

Search the report for:

```
Configure Windows NTP Client
Enable Windows NTP Client
Enable Windows NTP Server
```

`w32tm /query /configuration` also shows the effective source of each setting, for example:

```
Type: NT5DS (Local)
```

In this case, the effective configuration appeared as a local default state. There was no evidence that Group Policy had forced the member server to use a specific NTP server.

---

# Root Cause and Evidence Boundaries

The investigation confirmed that the problem was not caused by:

- The PDC Emulator external NTP configuration
    
- DNS name resolution
    
- Active Directory DC Locator
    
- The Secure Channel
    
- Basic communication between Domain Controllers
    

The fault was isolated to Windows Time Service on DC01.

The DC01 configuration contained:

```
Type: NT5DS
AnnounceFlags: 5
```

This showed that the effective W32Time configuration did not fully match the server's current role.

However, `AnnounceFlags: 5` alone was not enough to prove that it was the sole direct cause of Event ID 129.

What could be confirmed was:

- W32Time could not establish a valid Domain Peer
    
- After re-registering W32Time and restoring `domhier`, DC01 immediately began synchronizing with PDC01
    
- The fault therefore existed in the local Windows Time Service configuration or service state on DC01
    
- Active Directory, DNS, the network, and the PDC Emulator were not the primary causes of the incident
    

---

# Final Time Synchronization Architecture

The domain should maintain the following design:

```
External NTP
      │
      ▼
PDC Emulator — the only server explicitly configured with public NTP
      │
      ▼
Other Domain Controllers — NT5DS
      │
      ▼
Member Servers and Workstations — NT5DS
```

The main rules are:

- Only the PDC Emulator is configured with public NTP servers
    
- Other Domain Controllers use `NT5DS`
    
- Domain members use `NT5DS`
    
- Member servers may synchronize with any healthy Domain Controller
    
- Every time chain should ultimately trace back to the PDC Emulator
    

---

# Troubleshooting Approach Summary

The most valuable part of this incident was not the final repair command. It was the process of narrowing the fault domain step by step.

When a server shows:

```
Local CMOS Clock
```

it is not safe to assume immediately that the public NTP service, UDP 123, or a firewall is the problem.

A better approach is to identify the server's role in the domain hierarchy and determine at which stage the time source was lost.

## General Troubleshooting Sequence

```
Identify the device role
      │
      ▼
Confirm the PDC Emulator and FSMO roles
      │
      ▼
Validate the PDC external NTP source
      │
      ▼
Check Source, Status, and Type on the affected server
      │
      ▼
Use w32tm /monitor to inspect the entire domain
      │
      ▼
Validate Secure Channel, DNS, and PDC Locator
      │
      ▼
Review Windows Time Service events
      │
      ▼
Determine whether the failure is discovery, communication, or local configuration
      │
      ▼
Restore W32Time and rejoin the domain time hierarchy
      │
      ▼
Validate the complete synchronization chain
```

## Common Symptoms and What to Check First

|   |   |
|---|---|
|Symptom|First Checks|
|PDC uses `Local CMOS Clock`|External NTP, UDP 123, PDC configuration|
|Non-PDC DC uses `Local CMOS Clock`|`NT5DS`, DC Locator, Event ID 129|
|`No time data was available`|Current peer, network connectivity, event logs|
|Standard DC shows `Type: NTP`|Historical manual configuration or Group Policy|
|Member server synchronizes with a standard DC|Usually normal; validate the upstream chain|
|`w32tm /monitor` times out|W32Time service, firewall, UDP 123|
|`RefID: LOCL`|The computer is currently using its local clock|

## The Most Important Diagnostic Principle

Windows Time problems generally fall into one of the following categories:

1. **Configuration error**: The device uses a `Type` or peer that does not match its role.
    
2. **Discovery failure**: W32Time cannot establish a Domain Peer through the domain hierarchy.
    
3. **Communication failure**: A source has been selected, but time data cannot be received.
    
4. **Local service problem**: The configuration appears correct, but the runtime state does not match it.
    
5. **Normal domain hierarchy behavior**: A member server selects a standard Domain Controller instead of the PDC directly.
    

When a server displays `Local CMOS Clock`, the real question is not:

> Which public NTP server should I configure instead?

The real question is:

> What is this server's role in the domain time hierarchy, and at which stage did it lose its correct time source?

Only after determining whether the failure occurred during configuration, discovery, communication, or synchronization should corrective settings be applied. Otherwise, troubleshooting may simply add another layer of historical configuration.

---

# Command Toolbox

## Role and Domain Discovery

```
netdom query fsmo
Get-ADDomain | Select-Object PDCEmulator
nltest /dsgetdc:example.local /PDC
nltest /dclist:example.local
```

## Secure Channel

```
Test-ComputerSecureChannel -Verbose
nltest /sc_verify:example.local
```

## Windows Time Status

```
w32tm /query /source
w32tm /query /status
w32tm /query /configuration
w32tm /query /peers
w32tm /monitor
```

## Time Offset Test

```
w32tm /stripchart /computer:PDC01.example.local /samples:5 /dataonly
```

## Event Log Review

```
Get-WinEvent -LogName System |
    Where-Object {
        $_.ProviderName -eq "Microsoft-Windows-Time-Service"
    } |
    Select-Object -First 20 `
        TimeCreated,
        Id,
        LevelDisplayName,
        Message
```

## Restore Windows Time Service on a Non-PDC Domain Controller

```
net stop w32time
w32tm /unregister
w32tm /register
net start w32time
w32tm /config /syncfromflags:domhier /reliable:no /update
w32tm /resync /rediscover
```

## Group Policy Check

```
gpresult /h C:\Temp\gpresult.html
```