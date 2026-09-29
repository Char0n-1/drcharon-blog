---
title: Restoring the UniFi Network Server Windows Service After a Controller Recovery
published: 2026-09-29
description: "A follow-up to a UniFi Controller recovery: rebuilding the missing Windows service, binding it to the bundled Java 25 runtime, and validating automatic startup after a server reboot."
tags:
  - Unifi
  - Ubiquiti
  - Windows-Server
  - Java
  - Windows-Service
  - Trou
category: Infrastructure
draft: false
lang: en
---

# Restoring the UniFi Network Server Windows Service After a Controller Recovery

In the previous troubleshooting session, the UniFi Network Controller had been brought back online manually after a Windows Server reboot.

The immediate outage was resolved by identifying a Java runtime mismatch:

```text
System Java        = Java 11
UniFi bundled Java = Java 25
````

The UniFi application required Java 25, so temporarily prioritizing the bundled JRE allowed the controller to start successfully.

However, that was only a recovery step.

The controller was still running from an interactive PowerShell session, which meant the PowerShell window had to remain open. More importantly, the controller would not automatically return after the next server reboot.

The next task was therefore to restore the UniFi Windows Service properly.

---

# 1. Confirming the Windows Service Was Missing

Before making any changes, I confirmed that the UniFi Windows Service did not exist.

```powershell
Get-Service -Name UniFi -ErrorAction SilentlyContinue
```

No result was returned.

I then confirmed it with `sc.exe`:

```powershell
sc.exe query UniFi
```

The result was:

```powershell
[SC] EnumQueryServicesStatus:OpenService FAILED 1060:

The specified service does not exist as an installed service.
```

This matched the earlier behavior of the UniFi service wrapper.

The application files still existed, but the Windows Service registration itself was missing.

---

# 2. Stopping the running process

Before installing a new service, the manually started UniFi instance needed to be stopped.

After stopping the foreground Java process, I checked for any remaining UniFi-related processes:

```powershell
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi"
} |
Select-Object ProcessName,Id,Path
```

The Java process had stopped, but one process was still running:

```powershell
ProcessName   Id   Path
-----------   --   ----
mongod        5556 C:\Users\Administrator\Ubiquiti UniFi\bin\mongod.exe
```

I checked its command line to confirm that it belonged to the UniFi installation:

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId=5556" |
Select-Object ProcessId,ExecutablePath,CommandLine |
Format-List
```

The process was using:

```powershell
--dbpath "C:\Users\Administrator\Ubiquiti UniFi\data\db"
--port 27117
--bind_ip 127.0.0.1
```

This confirmed that it was the embedded MongoDB instance used by UniFi.

It was also still listening on TCP `27117`:

```powershell
Get-NetTCPConnection -OwningProcess 5556 -ErrorAction SilentlyContinue |
Format-Table LocalAddress,LocalPort,RemoteAddress,RemotePort,State
```

Result:

```powershell
LocalAddress LocalPort RemoteAddress RemotePort State
------------ --------- ------------- ---------- -----
127.0.0.1        27117 0.0.0.0                0 Listen
```

To avoid a port or database conflict when the Windows Service started, I stopped the remaining MongoDB process:

```powershell
Stop-Process -Id 5556
```

I then confirmed that no UniFi-related process was still running.

---

# 3. Installing the UniFi Windows Service

The previous troubleshooting had already established one important requirement:

**The system-wide Java installation could not be used.**

The default `java` command on the server resolved to Java 11, while the installed UniFi application required Java 25.

Fortunately, the UniFi installation contained its own Java 25 runtime:

```
C:\Users\Administrator\Ubiquiti UniFi\jre
```

Instead of using `java -jar` I explicitly used the bundled Java executable to install the service:

```powershell
cd "C:\Users\Administrator\Ubiquiti UniFi"

& ".\jre\bin\java.exe" -jar ".\lib\ace.jar" installsvc
```

The installation completed successfully:


---

# 4. Verifying the Windows Service

After installation, I checked the newly created service:

```powershell
Get-CimInstance Win32_Service -Filter "Name='UniFi'" |
Select-Object Name,DisplayName,State,StartMode,PathName |
Format-List
```

The result showed:

```powershell
Name        : UniFi
DisplayName : UniFi Network Server
State       : Stopped
StartMode   : Auto
PathName    : "C:\Users\Administrator\Ubiquiti UniFi\bin\UniFi" //RS//UniFi
```

I also checked the Service Control Manager configuration:

```powershell
sc.exe qc UniFi
```

Important values included:

```powershell
SERVICE_NAME: UniFi
TYPE               : 10  WIN32_OWN_PROCESS
START_TYPE         : 2   AUTO_START
DISPLAY_NAME       : UniFi Network Server
SERVICE_START_NAME : LocalSystem
```

The service was now configured to start automatically with Windows.

However, there was one more important thing to verify.

---

# 5. Confirming the Service Uses Java 25

The original outage had exposed a Java version mismatch, so simply confirming that a Windows Service existed was not enough.

I needed to make sure the service itself was explicitly configured to use the UniFi bundled Java runtime rather than the system Java 11 installation.

The UniFi executable is an Apache Procrun service wrapper.

Its current service configuration can be printed using:

```powershell
& "C:\Users\Administrator\Ubiquiti UniFi\bin\UniFi.exe" //PS//UniFi
```

The output included:

```powershell
--Jvm "C:\Users\Administrator\Ubiquiti UniFi\jre\bin\server\jvm.dll"
```

It also showed:

```powershell
--Classpath "C:\Users\Administrator\Ubiquiti UniFi\lib\ace.jar"

--StartClass "com.ubnt.ace.Launcher"

--StartParams "_startw"

--StartMode "jvm"
```

This was the most important validation step.

The Windows Service was not relying on the server's default `java.exe`.

Instead, Procrun was directly loading:

```powershell
C:\Users\Administrator\Ubiquiti UniFi\jre\bin\server\jvm.dll
```

which belonged to the bundled Java 25 runtime.

The Java 11 conflict was therefore no longer relevant to service startup.

---

# 6. Starting the UniFi Service

With the service registration and JVM configuration confirmed, I started the service:

```powershell
Start-Service UniFi
```

Then checked its status:

```powershell
Get-Service UniFi
```

The service entered the expected state:

```powershell
Status   Name   DisplayName
------   ----   -----------
Running  UniFi  UniFi Network Server
```


The UniFi Portal was accessible again through:

```
https://<controller-ip>:8443/
```

This time, however, it was running as a proper Windows Service rather than inside an interactive PowerShell session.

---

# 7. Reboot Validation

Starting the service manually confirmed that the service configuration worked, but that alone was not enough.

The original problem appeared after a Windows Server reboot, so the final validation had to reproduce that condition.

During the maintenance window, I rebooted the server.

After Windows returned, I checked:

```powershell
Get-Service UniFi
```

The service had automatically entered the `Running` state.

---

# Useful Commands

## Check whether the UniFi Service exists

```powershell
Get-Service -Name UniFi -ErrorAction SilentlyContinue
```

```powershell
sc.exe query UniFi
```

## Install the service using the bundled Java runtime

```powershell
cd "C:\Users\Administrator\Ubiquiti UniFi"

& ".\jre\bin\java.exe" -jar ".\lib\ace.jar" installsvc
```

## Check the Windows Service configuration

```powershell
Get-CimInstance Win32_Service -Filter "Name='UniFi'" |
Select-Object Name,DisplayName,State,StartMode,PathName |
Format-List
```

```powershell
sc.exe qc UniFi
```

## Print the UniFi Procrun configuration

```powershell
& "C:\Users\Administrator\Ubiquiti UniFi\bin\UniFi.exe" //PS//UniFi
```

## Start the service

```powershell
Start-Service UniFi
```

## Check the service state

```powershell
Get-Service UniFi
```

## Check UniFi-related processes

```powershell
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi"
} |
Select-Object ProcessName,Id,Path
```

## Check UniFi ports

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
Where-Object {
    $_.LocalPort -in 8443,8080,8843,8880,6789,27117
} |
Sort-Object LocalPort |
Format-Table LocalAddress,LocalPort,OwningProcess
```

## Test the management interface

```powershell
Test-NetConnection 127.0.0.1 -Port 8443
```

---

# Final Result

The UniFi Network Controller is now running as a proper Windows Service again.

The controller:

- starts automatically with Windows
- no longer requires an interactive PowerShell session
- uses the correct bundled Java 25 runtime
- retains the existing UniFi configuration and database
- survives a full Windows Server reboot without manual intervention

The temporary recovery restored service availability.

Rebuilding and validating the Windows Service completed the permanent repair.
