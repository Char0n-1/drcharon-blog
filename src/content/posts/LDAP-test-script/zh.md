---
title: PowerShell 脚本验证LDAP
published: 2026-08-12
description: 用这个PowerShell脚本来验证LDAP连接
tags:
  - Active-Directory
  - LDAP
  - PowerShell
category: Toolbox
draft: false
lang: zh
---

使用前修改`server` 和 `port` 的值
```powershell
Add-Type -AssemblyName System.DirectoryServices.Protocols

$server = "dc01.contoso.com"
$port = 389

$credential = Get-Credential

$identifier = New-Object System.DirectoryServices.Protocols.LdapDirectoryIdentifier(
    $server,
    $port
)

$connection = New-Object System.DirectoryServices.Protocols.LdapConnection(
    $identifier
)

$connection.Credential = $credential
$connection.AuthType = [System.DirectoryServices.Protocols.AuthType]::Negotiate

try {
    $connection.Bind()
    Write-Host "LDAP connection and bind successful"
}
catch {
    Write-Host "LDAP bind failed:"
    Write-Host $_.Exception.Message
}
finally {
    $connection.Dispose()
}
```