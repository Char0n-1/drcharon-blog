---
title: Linux auditd 使用笔记
published: 2024-07-25
tags:
  - Linux
  - auditd
  - Security
  - Sysadmin
category: Linux
draft: false
description: 记录 auditd 的基本配置、审计规则（Audit Rules）以及常用示例，并简要介绍 Linux Audit Framework 的工作原理。
lang: zh
---
# auditd

## 配置文件

auditd 的主配置文件位于：

```bash
/etc/audit/auditd.conf
```

用于控制 auditd 自身的行为，例如日志写入方式、日志轮转以及磁盘空间不足时的处理策略。

```bash
# Log writing behavior
flush = INCREMENTAL
freq = 20

# Log rotation
num_logs = 5
max_log_file = 6
max_log_file_action = ROTATE

# Dispatcher
disp_qos = lossy
dispatcher = /sbin/audispd
name_format = NONE

# Disk space threshold
space_left = 75

#The "_action" options determine how errors or disk space issues should be handled:
admin_space_left_action = SUSPEND
disk_full_action = SUSPEND
disk_error_action = SUSPEND
```

> **Note**
>
> - `max_log_file` 的单位为 **MB**。
> - `num_logs` 仅在 `max_log_file_action = ROTATE` 时生效。
> - 较新的 Linux 发行版（如 RHEL 9、Ubuntu 24.04）已将 `audispd` 的功能整合到 `auditd` 中，因此部分系统可能没有独立的 `audispd` 进程，但配置项仍可能保留用于兼容。

---

## Audit Rules

Audit Rule 可分为三种类型：

1. **Control Rules** —— 控制 Auditd 的行为。
2. **File Watch Rules**（File System Rules）—— 审计指定文件或目录。
3. **System Call Rules** —— 审计指定的 System Call。

现代 Linux 通常建议将自定义规则放在：

```bash
/etc/audit/rules.d/*.rules
```

然后执行：

```bash
augenrules --load
```

自动生成并加载：

```bash
/etc/audit/audit.rules
```

虽然仍然可以直接编辑 `audit.rules`，但官方更推荐使用 `rules.d` 的方式，便于维护和版本管理。

---

## 示例规则

```bash
# ----------------------------
# Control Rules
# ----------------------------

# Delete all existing rules
-D

# Kernel backlog queue size
## Increase the buffers to survive stress events. 
## Make this bigger for busy systems
-b 8192

## Set failure mode to panic
# 0 = silent
# 1 = printk
# 2 = panic
-f 2


# ----------------------------
# File Watch Rules
# ----------------------------

-w /etc/passwd  -p wa -k passwd_changes
-w /etc/group   -p wa -k group_changes
-w /etc/shadow  -p wa -k shadow_changes
-w /etc/sudoers -p wa -k sudoers_changes
```

其中：

| Option | Description |
|---------|-------------|
| `-w` | 监控指定文件或目录 |
| `-p` | 权限类型（r、w、x、a） |
| `-k` | 为规则添加 Key，方便使用 `ausearch -k` 搜索 |

权限说明：

| Flag | Meaning |
|------|---------|
| `r` | Read |
| `w` | Write |
| `x` | Execute |
| `a` | Attribute Change（如 chmod、chown、touch 等） |

例如：

```bash
ausearch -k passwd_changes
```

---

# 补充阅读：什么是 auditd？

在 Linux 中，几乎所有与安全相关的操作最终都会经过 **Kernel（内核）**。 

例如： 
- 用户登录或注销 
- 执行 `sudo` 
- 启动一个程序 
- 修改 `/etc/passwd` 
- 修改文件权限（`chmod`） 
- 删除文件 
- 创建新的进程 

这些操作最终都会转换成一个或多个 **System Call（系统调用）**，由 Linux Kernel 处理。 
为了满足安全审计（Security Auditing）和合规（Compliance）的需求，Linux Kernel 内置了一套 **Linux Audit Framework**，用于记录这些安全相关事件。 
而 **auditd（Linux Audit Daemon）**，则是这套框架对应的用户空间（Userspace）守护进程。

它负责：

- 接收 Kernel 发送的 Audit Event
- 将事件写入 `/var/log/audit/audit.log`
- 管理日志轮转（Log Rotation）
- 将事件转发给其他插件或日志系统（如 rsyslog、SIEM）

整个流程可以理解为：

```text
System Call / File Change
            │
            ▼
Linux Kernel (Audit Framework)
            │
      Generate Audit Event
            │
            ▼
         auditd
            │
            ▼
/var/log/audit/audit.log
```

整个过程中，可以简单理解为： 
1. 管理员加载 Audit Rules。 
2. Linux Kernel 根据这些规则监控系统行为。 
3. 当发生匹配事件时，Kernel 生成一个 **Audit Event**。 
4. auditd 接收该事件，并写入 `/var/log/audit/audit.log`。 
5. 管理员使用 `ausearch`、`aureport` 等工具查询或分析日志。 
6. 因此，各组件的职责分别是： 

| Component             | Function                             |
| --------------------- | ------------------------------------ |
| Linux Audit Framework | Kernel 内置的审计框架，负责根据规则产生 Audit Event。 |
| auditd                | 接收 Audit Event，并保存到日志。               |
| auditctl              | 动态管理 Kernel 中的 Audit Rules。          |
| augenrules            | 将 `/etc/audit/rules.d/` 中的规则合并并加载。   |
| ausearch              | 根据条件搜索 Audit Log。                    |
| aureport              | 根据 Audit Log 生成统计报告。                 |

理解这一点之后，很多现象就变得容易解释了。 例如： 

- 为什么 `auditctl` 修改规则后立即生效？ 
	- 因为它直接修改的是 Kernel 中的 Audit Rules，而不是修改配置文件。 
	
- 为什么重启之后规则消失？ 
	- 因为 `auditctl` 修改的是运行时规则，重启后需要重新从配置文件加载。 
	
- 为什么 auditd 停止以后，系统依然可能继续产生 Audit Event？ 
	- 因为真正负责审计的是 Linux Kernel，只是没有用户空间进程继续接收并写入日志。 

可以把整个 Linux Audit System 理解成一句话： > **Audit Rules 告诉 Kernel 要监控什么；Kernel 负责发现事件；auditd 负责保存事件；ausearch 和 aureport 负责分析事件。**