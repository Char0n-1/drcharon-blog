---
title: 使用 PowerShell 批量补全 Active Directory 用户邮箱属性
published: 2025-08-01
description: 根据用户的 SAMAccountName 批量补全 Active Directory 中缺失的 mail 属性。
tags:
  - Active-Directory
  - PowerShell
  - LDAP
  - Windows-Server
category: Toolbox
draft: false
lang: zh
---

---

在一次部署支持 **LDAP Sync** 的系统时，我发现不少用户同步完成后都没有邮箱信息。 
检查 Active Directory 后才发现，并不是 LDAP 配置有问题，而是很多用户对象根本没有填写 **mail** 属性。 
这是一个历史遗留问题。多年来，公司里的 AD 用户一直由不同的 IT 人员手动创建。由于 Windows 登录和 Exchange 并不会依赖这个属性，因此即使留空，用户平时也完全不会察觉，大家也就一直没有处理。

好在公司的邮箱命名规则比较统一，例如：

```text
<sAMAccountName>@yourdomain.com
```

那么就可以通过 PowerShell 根据用户的登录名自动补全缺失的邮箱属性。

## PowerShell 脚本

```powershell
# 加载 Active Directory 模块
Import-Module ActiveDirectory

# 指定需要处理的 AD 组
$groupName = "changeme"

# 遍历组内所有用户
Get-ADGroupMember -Identity $groupName -Recursive |
    Where-Object { $_.objectClass -eq 'user' } |
    ForEach-Object {
        $user = Get-ADUser -Identity $_ -Properties mail

        if (-not $user.mail) {
            $email = "$($user.SamAccountName)@yourdomain.com"
            Set-ADUser -Identity $user.SamAccountName -EmailAddress $email
            Write-Host "已设置邮箱：$($user.SamAccountName) -> $email" -ForegroundColor Green
        }
        else {
            Write-Host "邮箱已存在：$($user.SamAccountName) -> $($user.mail)" -ForegroundColor Yellow
        }
    }
```

## 脚本说明

该脚本会执行以下操作：

1. 获取指定 AD 组中的所有用户（包含嵌套组）。
2. 检查每个用户的 **mail** 属性是否为空。
3. 如果为空，则使用 **sAMAccountName** 自动生成邮箱地址。
4. 将生成的邮箱写入 Active Directory 的 **mail** 属性。
5. 已经存在邮箱的用户将自动跳过，不会被覆盖。

## 注意事项

- 将 `changeme` 修改为需要处理的 AD 组名称。
- 将 `yourdomain.com` 修改为实际使用的邮箱域名。
- 运行脚本的账户需要具有修改 Active Directory 用户属性的权限。
- 建议先在测试环境或少量用户上验证，再应用到生产环境。