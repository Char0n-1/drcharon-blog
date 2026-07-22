---
title: systemd 使用笔记
published: 2024-07-28
description: 一份实用的 systemd 速查笔记，涵盖常用命令、自定义服务、unit 文件位置、日志查看、故障排查以及软件包归属查询。
tags:
  - Linux
  - Systemd
  - Ubuntu
  - DevOps
category: Linux
draft: false
lang: zh
---
## 常用命令

列出已配置为开机启用的 service unit

```bash
systemctl list-unit-files --type=service --state=enabled
```

查看当前正在运行的服务：

```bash
systemctl list-units --type=service --state=running
```

分别判断开机启动和当前运行状态：

```bash
systemctl is-enabled nginx.service
systemctl is-active nginx.service
```

开启，关闭，重启，设为开机自启，查看状态

```bash
systemctl start nginx
systemctl stop nginx
systemctl restart nginx
systemctl enable nginx
systemctl status nginx
```

创建一个自定义的Springboot service

```bash
cat <<'EOF' >/etc/systemd/system/hello.service
[Unit]
Description=Spring Boot HelloWorld
After=syslog.target
After=network.target

[Service]
User=username
Type=simple
ExecStart=/usr/bin/java -jar /root/hello.jar
Restart=always
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=helloworld

[Install]
WantedBy=multi-user.target
EOF
```

service文件的位置(详情参考 man systemd.unit)

```bash
 Table 1.  Load path when running in system mode (--system).
       ┌────────────────────┬─────────────────────────────┐
       │Path                │ Description                 │
       ├────────────────────┼─────────────────────────────┤
       │/etc/systemd/system │ Local configuration         │
       ├────────────────────┼─────────────────────────────┤
       │/run/systemd/system │ Runtime units               │
       ├────────────────────┼─────────────────────────────┤
       │/lib/systemd/system │ Units of installed packages │
       └────────────────────┴─────────────────────────────┘
```


> [!NOTE] 注释
> `/etc/systemd/system`文件夹里的是本地创建的服务。 
> `/lib/systemd/system`路径里的是软件包创建的服务。（`/usr/lib/systemd/system`）
> `/run/systemd/system` 用于运行时临时配置


## 修改 unit 后重新加载

```
systemctl daemon-reload
```

只要创建或修改了 unit 文件，就应该运行它。它不会自动重启服务，通常还需要：

```
systemctl restart hello.service
```

## 检查 unit 文件语法

```
systemd-analyze verify /etc/systemd/system/hello.service
```

## 查看失败的 unit

```
systemctl --failed
```

仅查看失败的服务：

```
systemctl --failed --type=service
```

## 查看服务日志

```
journalctl -u hello.service
journalctl -u hello.service -b
journalctl -u hello.service -f
journalctl -u hello.service --since "30 minutes ago"
```

## 清除 failed 状态

修复问题后，如果服务仍显示 failed：

```
systemctl reset-failed hello.service
```

然后重新启动：

```
systemctl start hello.service
```

## 推荐使用 drop-in，而不是修改软件包文件

不要直接修改：

```
/lib/systemd/system/nginx.service
```

因为软件升级可能覆盖修改。

使用：

```
systemctl edit nginx.service
```

例如：

```
[Service]
Restart=on-failure
RestartSec=5s
```

查看合并后的结果：

```
systemctl cat nginx.service
```

恢复并删除本地覆盖：

```
systemctl revert nginx.service
```


## 查看/lib/systemd/system路径下的服务是由什么软件包创建的

```bash
dpkg-query -S /lib/systemd/system/* | sort -u 
```

Output:

```bash
dpkg-query: no path found matching pattern /lib/systemd/system/ecs_mq.service
dpkg-query: no path found matching pattern /lib/systemd/system/SplunkForwarder.service
dpkg-query: no path found matching pattern /lib/systemd/system/system-systemd\x2dcryptsetup.slice
accountsservice: /lib/systemd/system/accounts-daemon.service
apparmor: /lib/systemd/system/apparmor.service
apt: /lib/systemd/system/apt-daily.service
apt: /lib/systemd/system/apt-daily.timer
apt: /lib/systemd/system/apt-daily-upgrade.service
apt: /lib/systemd/system/apt-daily-upgrade.timer
at: /lib/systemd/system/atd.service
auditd: /lib/systemd/system/auditd.service
base-files: /lib/systemd/system/motd-news.service
base-files: /lib/systemd/system/motd-news.timer
```

<aside>  
💡 可以看到dpkg找不到前三个服务对应的软件包。这可能是因为这些服务的由deb文件手动安装的，比如所splunk forwarder

</aside>


> [!NOTE] 注释
> `dpkg-query` 找不到这些文件，表示 dpkg 数据库中没有软件包声明拥有该路径。它们可能是手工创建、由第三方安装脚本创建、由软件包安装脚本动态生成，或由 systemd generator 生成。仅仅使用 `dpkg -i` 手动安装 `.deb`，通常不会导致 `dpkg-query -S` 无法找到包内文件。
