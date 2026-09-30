---
title: Troubleshooting a UniFi Controller That Failed to Start After a Windows Server Reboot
published: 2026-09-29
description: A real-world troubleshooting case involving a UniFi Network Controller that stopped responding after a Windows Server reboot, eventually traced to a missing service registration and a Java runtime version mismatch.
tags:
  - Unifi
  - Uniquiti
  - Windows-Server
  - Java
  - Network
  - Troubleshooting
category: Infrastructure
draft: false
lang: en
---

# Troubleshooting a UniFi Controller That Failed to Start After a Windows Server Reboot

After a Windows Server reboot, the UniFi Network Controller became completely inaccessible.

The UniFi devices themselves were still operating, but attempting to open the management portal resulted in:

```text
ERR_CONNECTION_REFUSED
````
The controller was normally accessed through:

```
https://<controller-ip>:8443/
```

Since the browser received an immediate connection refusal rather than a timeout, the first suspicion was that the server itself was reachable, but nothing was listening on TCP port `8443`.

This turned out to be correct — but the root cause involved more than just a stopped application.

---

## Environment

The controller in this case was running on:

- Windows Server 2016
- Traditional Windows-based UniFi Network Controller
- Local installation under an Administrator user profile
- Embedded MongoDB
- Java-based UniFi backend
- Management interface on TCP `8443`

The server had recently rebooted following Windows updates.

The goal was to restore the existing controller **without reinstalling UniFi or touching the existing configuration database**.

---

# 1. Confirming That the Controller Was Not Listening

The first step was to check the common UniFi ports.

```powershell title="PowerShell terminal"
$ports = 8443,8080,8843,8880,6789,27117

foreach ($port in $ports) {
    $result = Get-NetTCPConnection `
        -LocalPort $port `
        -State Listen `
        -ErrorAction SilentlyContinue

    if ($result) {
        Write-Host "Port $port : LISTENING"
    }
    else {
        Write-Host "Port $port : NOT LISTENING"
    }
}
```

The result was:

```powershell title="PowerShell terminal"
Port 8443 : NOT LISTENING
Port 8080 : NOT LISTENING
Port 8843 : NOT LISTENING
Port 8880 : NOT LISTENING
Port 6789 : NOT LISTENING
Port 27117 : NOT LISTENING
```

A direct TCP test confirmed the same thing:

```powershell title="PowerShell terminal"
Test-NetConnection 127.0.0.1 -Port 8443
```

Result:

```
PingSucceeded    : True
TcpTestSucceeded : False
```

This was an important distinction.

The server itself was alive and reachable. The problem was not initially a routing or firewall issue.

There was simply no process listening on the UniFi management port.
# 2. Checking for UniFi, Java, and MongoDB Processes

Next, I checked whether any UniFi-related backend processes were running.

```
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi|ubiquiti"
} |
Select-Object ProcessName,Id,Path
```

No relevant processes were found.

I also checked for Windows services associated with UniFi:

```
Get-CimInstance Win32_Service |
Where-Object {
    $_.Name -match "UniFi|Ubiquiti|Mongo" -or
    $_.DisplayName -match "UniFi|Ubiquiti|Mongo"
} |
Select-Object Name,DisplayName,State,StartMode,PathName
```

Again, nothing was returned.
The next question was therefore:

> Where was UniFi actually installed, and how had it previously been started?

---

# 3. Finding the Existing UniFi Installation

Since no UniFi service or related backend process was running, the next step was to determine whether the controller was still installed on the server and where its files were located.

Instead of checking installed applications manually, I used PowerShell to search:

- uninstall registry entries
- common UniFi installation paths
- user profile directories
- Java-based Windows services
- scheduled tasks
- startup commands

The following script was used:

```powershell title="PowerShell terminal"
Write-Host "`n=== SERVER UPTIME ===" -ForegroundColor Cyan
Get-CimInstance Win32_OperatingSystem |
Select-Object LastBootUpTime

Write-Host "`n=== INSTALLED APPLICATIONS ===" -ForegroundColor Cyan
$paths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

Get-ItemProperty $paths -ErrorAction SilentlyContinue |
Where-Object {
    $_.DisplayName -match "UniFi|Ubiquiti|Mongo|Java"
} |
Select-Object DisplayName,DisplayVersion,InstallLocation,Publisher |
Format-Table -AutoSize


Write-Host "`n=== POSSIBLE UNIFI FOLDERS ===" -ForegroundColor Cyan

$folders = @(
    "C:\Program Files\Ubiquiti UniFi",
    "C:\Program Files (x86)\Ubiquiti UniFi",
    "C:\ProgramData\Ubiquiti UniFi",
    "C:\Ubiquiti UniFi"
)

foreach ($folder in $folders) {
    if (Test-Path $folder) {
        Write-Host "FOUND: $folder" -ForegroundColor Green
        Get-ChildItem $folder -Force |
        Select-Object Name,LastWriteTime
    }
}

Write-Host "`n=== USER PROFILE UNIFI FOLDERS ===" -ForegroundColor Cyan

Get-ChildItem C:\Users -Directory -ErrorAction SilentlyContinue |
ForEach-Object {

    $candidate = Join-Path $_.FullName "Ubiquiti UniFi"

    if (Test-Path $candidate) {
        Write-Host "FOUND: $candidate" -ForegroundColor Green
        Get-ChildItem $candidate -Force |
        Select-Object Name,LastWriteTime
    }

    $candidate2 = Join-Path $_.FullName "UniFi"

    if (Test-Path $candidate2) {
        Write-Host "FOUND: $candidate2" -ForegroundColor Green
        Get-ChildItem $candidate2 -Force |
        Select-Object Name,LastWriteTime
    }
}


Write-Host "`n=== JAVA-BASED SERVICES ===" -ForegroundColor Cyan

Get-CimInstance Win32_Service |
Where-Object {
    $_.PathName -match "java|mongo|ace.jar"
} |
Select-Object Name,DisplayName,State,StartMode,PathName |
Format-List


Write-Host "`n=== SCHEDULED TASKS ===" -ForegroundColor Cyan

Get-ScheduledTask -ErrorAction SilentlyContinue |
Where-Object {
    $_.TaskName -match "UniFi|Ubiquiti|Java" -or
    $_.TaskPath -match "UniFi|Ubiquiti"
} |
Select-Object TaskName,TaskPath,State |
Format-Table -AutoSize


Write-Host "`n=== STARTUP COMMANDS ===" -ForegroundColor Cyan

Get-CimInstance Win32_StartupCommand |
Where-Object {
    $_.Command -match "UniFi|Ubiquiti|java|ace.jar"
} |
Select-Object Name,Command,Location,User |
Format-List
````

The search returned several useful findings.

First, the server had rebooted recently:

```powershell title="PowerShell terminal"
LastBootUpTime
--------------
9/27/2026 11:25:47 PM
```

The uninstall registry still contained:

```powershell title="PowerShell terminal"
Ubiquiti UniFi (remove only)
```

More importantly, the actual controller installation was discovered under:

```powershell title="PowerShell terminal"
C:\Users\Administrator\Ubiquiti UniFi
```

The directory contained:

```powershell title="PowerShell terminal"
bin
data
dl
jre
lib
logs
run
webapps
```

No related scheduled tasks, startup commands, or Java-based Windows services were found.

This narrowed the problem considerably.

The controller files were still present, including the application runtime and data directories, but there was no active startup mechanism currently launching the controller after reboot.

At this point, the focus shifted from "Is UniFi still installed?" to:

> How was this installation originally being started, and why was that startup path no longer working?

# 4. Inspecting `start.bat`

The controller included its own startup script:

```
C:\Users\Administrator\Ubiquiti UniFi\bin\start.bat
```

Its contents were essentially:

```
cd ..

java ^
 --add-opens java.base/java.lang=ALL-UNNAMED ^
 --add-opens java.base/java.time=ALL-UNNAMED ^
 --add-opens java.base/sun.security.util=ALL-UNNAMED ^
 --add-opens java.base/java.io=ALL-UNNAMED ^
 --add-opens java.rmi/sun.rmi.transport=ALL-UNNAMED ^
 -Xmx1024M ^
 -jar lib\ace.jar start
```

This was useful because it showed that the UniFi controller could be launched directly through:

```
lib\ace.jar
```

So I tried:

```
cd "C:\Users\Administrator\Ubiquiti UniFi\bin"
.\start.bat
```

Instead of starting normally, Java returned:

```
Error: LinkageError occurred while loading main class com.ubnt.ace.Launcher

java.lang.UnsupportedClassVersionError:

com/ubnt/ace/Launcher has been compiled by a more recent version
of the Java Runtime (class file version 69.0),

this version of the Java Runtime only recognizes class file
versions up to 55.0
```

This was the key error.

---

# 5. Understanding the Java Error

Java class file versions correspond to specific Java releases.

In this case:

```
55.0 = Java 11
69.0 = Java 25
```

So the message was effectively saying:

```
UniFi requires Java 25
but
start.bat is launching Java 11
```

I checked the default Java runtime:

```
java -version
```

Result:

```
openjdk version "11.0.20"
OpenJDK Runtime Environment Temurin-11.0.20+8
OpenJDK 64-Bit Server VM Temurin-11.0.20+8
```

However, the UniFi installation also contained its own Java runtime:

```
C:\Users\Administrator\Ubiquiti UniFi\jre
```

Checking that version:

```
& "C:\Users\Administrator\Ubiquiti UniFi\jre\bin\java.exe" -version
```

returned:

```
openjdk version "25" 2025-09-16 LTS
OpenJDK Runtime Environment Temurin-25+36
OpenJDK 64-Bit Server VM Temurin-25+36
```

Now the cause of the startup failure was clear.

---

# 6. Why `start.bat` Used the Wrong Java

The startup script simply called:

```
java
```

It did not explicitly call:

```
C:\Users\Administrator\Ubiquiti UniFi\jre\bin\java.exe
```

Windows therefore searched the system `PATH` and found Java 11 first.

The UniFi application itself had already been updated to a build compiled for Java 25, but the startup environment still pointed to Java 11.
# 7. Temporarily Restoring Service First

At this point, the root cause of the startup failure was understood:

- the UniFi application required Java 25
- the system `PATH` was resolving `java` to Java 11
- the bundled UniFi JRE already provided the required Java 25 runtime

The immediate priority, however, was not to redesign the startup mechanism.

The controller first needed to be brought back online so that normal network management could resume. Changes to the Windows service registration, startup behavior, and Java path could then be handled during a maintenance window.

For that reason, I chose a temporary recovery method.

Instead of modifying the system-wide Java configuration, I placed the UniFi bundled JRE at the beginning of the `PATH` for the current PowerShell session only:

```powershell title="PowerShell terminal"
$env:Path =
"C:\Users\Administrator\Ubiquiti UniFi\jre\bin;" +
$env:Path
````

I then verified that the shell was now resolving `java` to the correct runtime:

```powershell title="PowerShell terminal"
java -version
```

The result showed Java 25.

With the correct runtime temporarily active, I launched the existing UniFi startup script again:

```powershell title="PowerShell terminal"
cd "C:\Users\Administrator\Ubiquiti UniFi\bin"

.\start.bat
```

This time, the controller initialized successfully.

This was intentionally treated as a recovery step rather than the final fix.
# 8. UniFi Controller Restored

Once the Java runtime mismatch was corrected, the UniFi Network Controller successfully started again.

The management interface became available at:

```
https://<controller-ip>:8443/
```

The original configuration database was preserved.

The immediate outage was resolved simply by understanding the existing deployment and launching the controller with the correct Java runtime.

---

# Root Cause

There were actually two separate issues discovered during troubleshooting.

## Issue 1 — UniFi was not running after the server reboot

After the Windows Server restart:

```
No UniFi backend
No Java process
No MongoDB process
No listener on TCP 8443
```

The Windows service registration expected by `UniFi.exe` was also missing.

## Issue 2 — Manual startup used the wrong Java runtime

The provided `start.bat` script called:

```
java
```

which resolved to the system installation:

```
Java 11
```

The installed UniFi version had been compiled for:

```
Java 25
```

causing:

```
UnsupportedClassVersionError
```

UniFi's bundled JRE already contained Java 25, so temporarily prioritizing it in `PATH` allowed the controller to start normally.

---

# Troubleshooting Summary

The troubleshooting sequence was:

```
UniFi Portal unavailable
        |
        v
Check TCP 8443
        |
        v
8443 not listening
        |
        v
Check UniFi / Java / Mongo processes
        |
        v
Nothing running
        |
        v
Locate existing UniFi installation
        |
        v
Existing data and application files found
        |
        v
Inspect start.bat
        |
        v
Run start.bat
        |
        v
UnsupportedClassVersionError
        |
        v
System Java = 11
UniFi bundled Java = 25
        |
        v
Temporarily prioritize bundled JRE
        |
        v
Run start.bat again
        |
        v
UniFi Controller restored
```

---

# Useful Commands

## Check whether  a port is listening

```powershell title="PowerShell terminal"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
Where-Object {
    $_.LocalPort -in 8443,8080,8843,8880,6789,27117
} |
Sort-Object LocalPort
```

## Test port

```
Test-NetConnection 127.0.0.1 -Port 8443
```

## Find related processes

```powershell title="PowerShell terminal"
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi|ubiquiti"
} |
Select-Object ProcessName,Id,Path
```

## Check the system Java version

```powershell title="PowerShell terminal"
java -version
```

## Check UniFi's bundled Java version

```powershell title="PowerShell terminal"
& "C:\Users\Administrator\Ubiquiti UniFi\jre\bin\java.exe" -version
```

## Temporarily prioritize the bundled JRE

```powershell title="PowerShell terminal"
$env:Path =
"C:\Users\Administrator\Ubiquiti UniFi\jre\bin;" +
$env:Path
```


---

# Current State

The controller is operational again, but there is one important limitation.

It is currently running from an interactive PowerShell session.

That means this is a **recovery**, not yet the permanent fix.

The PowerShell window must remain open for the current controller process to remain running.

The next task is to restore a proper unattended startup mechanism so that the UniFi Controller automatically starts after a Windows Server reboot and explicitly uses the correct bundled Java runtime.

That will be covered separately.