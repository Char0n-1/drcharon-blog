---
title: 恢复 UniFi Network Server 的 Windows Service
published: 2026-07-13
description: "A follow-up to a UniFi Controller recovery: rebuilding the missing Windows service, binding it to the bundled Java 25 runtime, and validating automatic startup after a server reboot."
tags:
  - Unifi
  - Ubiquiti
  - Windows-Server
  - Java
  - Windows-Service
  - Trou
category: Infrastructure
draft: true
lang: zh
---

# 恢复 UniFi Network Server 的 Windows Service

上一篇里，我已经把 Windows Server 重启后无法访问的 UniFi Network Controller 临时恢复了。

当时定位到的直接原因是 Java 版本不匹配：

```text
System Java        = Java 11
UniFi bundled Java = Java 25
````

当前版本的 UniFi 需要 Java 25，但服务器系统环境里的默认 Java 还是 Java 11。临时把 UniFi 自带的 JRE 放到 PATH 前面后，Controller 可以正常启动。

不过，这只能算是应急恢复。

当时 UniFi 仍然跑在一个手动打开的 PowerShell 窗口里，窗口一旦关闭，Controller 就会跟着停掉。而且下一次服务器重启后，它也不会自动启动。

所以接下来要做的，就是把 UniFi 的 Windows Service 正式恢复起来。

---

# 1. 确认 UniFi Service 确实不存在

开始之前，先确认系统里目前没有 UniFi Service：

```powershell
Get-Service -Name UniFi -ErrorAction SilentlyContinue
```

没有任何输出。

再用 `sc.exe` 确认一次：

```powershell
sc.exe query UniFi
```

返回：

```powershell
[SC] EnumQueryServicesStatus:OpenService FAILED 1060:

The specified service does not exist as an installed service.
```

也就是说，UniFi 的程序文件还在，但对应的 Windows Service 注册已经不存在了。

---

# 2. 停掉当前正在运行的 UniFi 进程

在重新安装 Service 之前，需要先把之前手动启动的 UniFi 完全停掉。

关掉前台运行的 Java 进程后，我检查了一下还有没有相关进程残留：

```powershell
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi"
} |
Select-Object ProcessName,Id,Path
```

Java 已经停了，但 MongoDB 还在运行：

```powershell
ProcessName   Id   Path
-----------   --   ----
mongod        5556 C:\Users\Administrator\Ubiquiti UniFi\bin\mongod.exe
```

为了确认这确实是 UniFi 自己的 MongoDB，我又看了一下它的启动参数：

```powershell
Get-CimInstance Win32_Process -Filter "ProcessId=5556" |
Select-Object ProcessId,ExecutablePath,CommandLine |
Format-List
```

可以看到：

```powershell
--dbpath "C:\Users\Administrator\Ubiquiti UniFi\data\db"
--port 27117
--bind_ip 127.0.0.1
```

这已经可以确定，它就是 UniFi 自带的 MongoDB。

同时检查端口：

```powershell
Get-NetTCPConnection -OwningProcess 5556 -ErrorAction SilentlyContinue |
Format-Table LocalAddress,LocalPort,RemoteAddress,RemotePort,State
```

结果：

```powershell
LocalAddress LocalPort RemoteAddress RemotePort State
------------ --------- ------------- ---------- -----
127.0.0.1        27117 0.0.0.0                0 Listen
```

MongoDB 还占着 `27117`。

为了避免稍后新的 UniFi Service 启动时发生端口冲突，或者两个实例同时操作同一个数据库，先把这个残留进程停掉：

```powershell
Stop-Process -Id 5556
```

之后再次确认，已经没有 UniFi 相关进程在运行。

---

# 3. 重新安装 UniFi Windows Service

上一篇已经确认过一个关键点：

**不能直接使用服务器系统里的默认 Java。**

服务器上的 `java` 指向 Java 11，而当前 UniFi 需要 Java 25。

好在 UniFi 自己已经带了一套 Java 25：

```
C:\Users\Administrator\Ubiquiti UniFi\jre
```

所以这里不使用普通的：

```powershell
java -jar
```

而是直接指定 UniFi 自带的 Java：

```powershell
cd "C:\Users\Administrator\Ubiquiti UniFi"

& ".\jre\bin\java.exe" -jar ".\lib\ace.jar" installsvc
```

Service 安装完成。

---

# 4. 检查新建的 Windows Service

安装完成后，先确认 Service 的基本信息：

```powershell
Get-CimInstance Win32_Service -Filter "Name='UniFi'" |
Select-Object Name,DisplayName,State,StartMode,PathName |
Format-List
```

结果：

```powershell
Name        : UniFi
DisplayName : UniFi Network Server
State       : Stopped
StartMode   : Auto
PathName    : "C:\Users\Administrator\Ubiquiti UniFi\bin\UniFi" //RS//UniFi
```

再看一下 Service Control Manager 里的配置：

```powershell
sc.exe qc UniFi
```

其中比较重要的几项：

```powershell
SERVICE_NAME: UniFi
TYPE               : 10  WIN32_OWN_PROCESS
START_TYPE         : 2   AUTO_START
DISPLAY_NAME       : UniFi Network Server
SERVICE_START_NAME : LocalSystem
```

`START_TYPE` 已经是 `AUTO_START`，说明 UniFi 会随 Windows 自动启动。

不过，这里还有一个必须确认的问题：

**这个 Service 启动时，到底会用哪个 Java？**

---

# 5. 确认 Service 使用的是 Java 25

上一篇的问题本身就是 Java 版本不匹配，所以仅仅看到 Service 创建成功还不够。

必须确认它启动时不会再次调用系统里的 Java 11。

UniFi 这里使用的是 Apache Procrun 作为 Windows Service Wrapper，可以直接把当前 Service 的配置打印出来：

```powershell
& "C:\Users\Administrator\Ubiquiti UniFi\bin\UniFi.exe" //PS//UniFi
```

输出中最关键的是这一项：

```powershell
--Jvm "C:\Users\Administrator\Ubiquiti UniFi\jre\bin\server\jvm.dll"
```

同时还可以看到：

```powershell
--Classpath "C:\Users\Administrator\Ubiquiti UniFi\lib\ace.jar"

--StartClass "com.ubnt.ace.Launcher"

--StartParams "_startw"

--StartMode "jvm"
```

这一步确认了一个非常重要的事实：

UniFi Service 启动时并不会去调用系统 PATH 里的 `java.exe`。

Procrun 会直接加载：

```powershell
C:\Users\Administrator\Ubiquiti UniFi\jre\bin\server\jvm.dll
```

也就是 UniFi 自带的 Java 25 JVM。

因此，系统里那个 Java 11 已经不会再影响 UniFi Service 的启动。

---

# 6. 启动 UniFi Service

确认 Service 和 JVM 配置都没问题后，启动 UniFi：

```powershell
Start-Service UniFi
```

检查状态：

```powershell
Get-Service UniFi
```

结果正常：

```powershell
Status   Name   DisplayName
------   ----   -----------
Running  UniFi  UniFi Network Server
```

此时 UniFi Portal 也恢复访问：

```
https://<controller-ip>:8443/
```

和之前不同的是，这次 UniFi 已经真正作为 Windows Service 在后台运行，不再依赖那个手动打开的 PowerShell 窗口。

---

# 7. 重启验证

手动启动成功只能说明 Service 本身能跑，还不能证明问题已经彻底解决。

毕竟这次故障最开始就是发生在服务器重启之后。

所以最后一步是在 Maintenance Window 里重新启动 Windows Server。

服务器回来后检查：

```powershell
Get-Service UniFi
```

UniFi Service 已经自动进入：

```powershell
Running
```

不需要登录服务器手动打开 PowerShell，也不需要再运行 `start.bat`。

到这里，这次修复才算真正完成。

---

# Useful Commands

## 检查 UniFi Service 是否存在

```powershell
Get-Service -Name UniFi -ErrorAction SilentlyContinue
```

```powershell
sc.exe query UniFi
```

## 使用 UniFi 自带的 Java 安装 Service

```powershell
cd "C:\Users\Administrator\Ubiquiti UniFi"

& ".\jre\bin\java.exe" -jar ".\lib\ace.jar" installsvc
```

## 查看 Windows Service 配置

```powershell
Get-CimInstance Win32_Service -Filter "Name='UniFi'" |
Select-Object Name,DisplayName,State,StartMode,PathName |
Format-List
```

```powershell
sc.exe qc UniFi
```

## 查看 UniFi Procrun 配置

```powershell
& "C:\Users\Administrator\Ubiquiti UniFi\bin\UniFi.exe" //PS//UniFi
```

## 启动 UniFi Service

```powershell
Start-Service UniFi
```

## 检查 Service 状态

```powershell
Get-Service UniFi
```

## 检查 UniFi 相关进程

```powershell
Get-Process -ErrorAction SilentlyContinue |
Where-Object {
    $_.ProcessName -match "java|mongo|unifi"
} |
Select-Object ProcessName,Id,Path
```

## 检查 UniFi 常用端口

```powershell
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
Where-Object {
    $_.LocalPort -in 8443,8080,8843,8880,6789,27117
} |
Sort-Object LocalPort |
Format-Table LocalAddress,LocalPort,OwningProcess
```

## 测试管理端口

```powershell
Test-NetConnection 127.0.0.1 -Port 8443
```

---

# 最终结果

修复完成后，UniFi Network Controller 已经重新以正常的 Windows Service 方式运行。

现在它可以：

- 随 Windows 自动启动
- 不再依赖手动打开的 PowerShell 窗口
- 固定使用 UniFi 自带的 Java 25
- 保留原有的 UniFi 配置和数据库
- 服务器重启后自动恢复，无需人工干预

上一篇解决的是“先把 UniFi 救回来”。

这一篇解决的则是“让它以后自己能起来”。

至此，这次 UniFi Controller 故障才算完整处理完毕。