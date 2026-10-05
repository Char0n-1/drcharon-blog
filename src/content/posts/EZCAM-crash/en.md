---
title: EZ-CAM 2019 Crashes at Startup Because of a Retired Default Printer
published: 2026-10-05
description: A troubleshooting case where EZ-CAM 2019 appeared to require administrator privileges, but the actual cause was a stale default network printer that had already been removed from the print server.
tags:
  - EZcam
  - Windows
  - Printer
  - Troubleshooting
category: Infrastructure
draft: false
lang: en
---
# EZ-CAM 2019 Crashes at Startup Because of a Retired Default Printer

We recently ran into a strange issue with **EZ-CAM Express 2019**.

The application had been working normally, but suddenly users could no longer launch it. Double-clicking the shortcut produced no window and no visible error message.

At first, the problem looked like a permissions or Windows compatibility issue.

It was not.

The actual cause was a **retired network printer that was still configured as the user's default printer**.

## Symptoms

The affected application was:

```text
EZ-CAM Express 2019
Version 26
ez-cam32.exe
````

The behavior was:

- Double-clicking EZ-CAM did nothing.
- No error message appeared.
- Launching it with a different administrator account appeared to work.
- The issue occurred on both Windows 10 and Windows 11 systems.
- Other EZ-CAM modules could still launch normally.

Windows Event Viewer showed that `ez-cam32.exe` was actually starting and then crashing.

The recurring exception was:

```
Exception code: 0xC0000005
Faulting module: ez-cam32.exe
Fault offset: 0x000825c6
```

The crash consistently occurred at the same location inside the executable. Pasted text

## Initial Troubleshooting

Because the application seemed to work when launched using an administrator account, we initially investigated permissions.

We checked:

- NTFS permissions on the EZ-CAM installation directory
- Write access to all EZ-CAM subdirectories
- User-specific EZ-CAM registry settings under `HKCU`
- Compatibility settings
- Windows Exploit Protection
- Local Administrator membership

The application directory was writable by the affected user, and resetting the EZ-CAM user registry profile did not resolve the problem.

We also added the affected user to the local Administrators group as a test.

EZ-CAM still crashed.

This confirmed that **administrator privileges were not actually the determining factor**.

## Go Deeper

We need to know how the process died
```powershell title="Powershell"
$p = Start-Process "C:\EZCAMW\EZCAMX26\ez-cam32.exe" -PassThru
$p.WaitForExit()
$p.ExitCode
'{0:X8}' -f ($p.ExitCode -band 0xffffffff)
```
After it crushes:
```powershell title="Powershell"
$since = (Get-Date).AddMinutes(-3)

Get-WinEvent -FilterHashtable @{
    LogName='Application'
    StartTime=$since
} -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProviderName -match 'Application Error|Windows Error Reporting|SideBySide|\.NET Runtime'
    -or $_.Message -match 'ez-cam|EZCAM'
} |
Select-Object TimeCreated,ProviderName,Id,Message |
Format-List
```

We see from the event log, the application constantly crushes on same offset:
```
Exception code : 0xc0000005
Fault offset   : 0x000825c6
Fault module   : ez-cam32.exe
```

## The Clue: Windows Printing

The Windows Error Reporting data showed that EZ-CAM loaded the Windows printing subsystem during startup, including:

```
WINSPOOL.DRV
```

along with its normal GUI, MFC, OpenGL, and EZ-CAM components. 

That led us to check the user's default printer:

```powershell title="PowerShell"
Get-CimInstance Win32_Printer |
Where-Object Default |
Select-Object Name,DriverName,PortName
```

The result pointed to an old network printer:

```powershell title="PowerShell"
\\printserver\OLD-PRINTER
```

The printer had already been **retired and removed from the print server**, but the user's Windows profile still had the old connection configured as the default printer.

## Root Cause

EZ-CAM 2019 initializes the Windows printing environment during application startup.

When the default printer pointed to a network print queue that no longer existed, the application did not handle the failure correctly.

Instead of ignoring the unavailable printer and continuing to start, EZ-CAM crashed with:

```
0xC0000005 - Access Violation
```

This is why the issue initially looked unrelated to printing: the user never attempted to print anything.

The crash happened simply because EZ-CAM queried the default printer while starting.

## Fix

We temporarily changed the default printer to:

```
Microsoft Print to PDF
```

using:

```powershell title="PowerShell"
rundll32 printui.dll,PrintUIEntry /y /n "Microsoft Print to PDF"
```

Immediately afterward, EZ-CAM launched normally.

The stale network printer connection could then be removed:

```powershell title="PowerShell"
Remove-Printer -Name "\\printserver\OLD-PRINTER"
```

After assigning a valid default printer, EZ-CAM continued to start normally without administrator privileges.

## Quick Diagnostic

If EZ-CAM 2019 suddenly stops launching with no visible error, check the default printer before spending too much time on permissions or reinstalling the application.

Check the current default printer:

```powershell title="PowerShell"
Get-CimInstance Win32_Printer |
Where-Object Default |
Select-Object Name,DriverName,PortName
```

Temporarily switch it to Microsoft Print to PDF:

```powershell title="PowerShell"
rundll32 printui.dll,PrintUIEntry /y /n "Microsoft Print to PDF"
```

Then try launching EZ-CAM again.

If the application starts normally, investigate the previous default printer connection.

## Takeaway

Legacy Windows applications sometimes initialize printer drivers and printer settings during startup, even when no printing action is requested.

In this case:

```
Retired network printer
        ↓
Still configured as default
        ↓
EZ-CAM initializes printing during startup
        ↓
Printer queue no longer exists
        ↓
Unhandled condition inside EZ-CAM
        ↓
0xC0000005
        ↓
Application exits with no visible error
```

So if **EZ-CAM 2019 appears to require administrator privileges or suddenly refuses to start**, check the user's default printer.

Sometimes the problem is not EZ-CAM, Windows Update, or permissions.

It is an old printer that should no longer be there.
