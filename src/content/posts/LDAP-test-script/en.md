---
title: A quick PowerShell script to test LDAP connectivity
published: 2026-08-12
description: A quick PowerShell script to test LDAP connectivity
tags:
  - Active-Directory
  - LDAP
  - PowerShell
category: Toolbox
draft: false
lang: en
---

Change the `server` value to your own. `port` 389 is default
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