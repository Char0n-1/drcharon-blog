---
title: Bulk Populate Missing Email Addresses in Active Directory
published: 2025-08-01
description: Populate missing AD mail attributes based on the user's sAMAccountName.
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
During the deployment of a system that supports **LDAP synchronization**, I noticed that many users were successfully synced but had no email address associated with their accounts.

After checking Active Directory, I found that the issue wasn't with the LDAP configuration at all. Instead, many user objects simply had an empty **mail** attribute.

This turned out to be a historical issue. Over the years, AD accounts had been created manually by different IT staff members. Since neither Windows logon nor Exchange depends on the `mail` attribute, users could work normally even if it was left blank, so the missing values went unnoticed for a long time.

Fortunately, our organization follows a consistent email naming convention, for example:

```text
<sAMAccountName>@yourdomain.com
```

With a predictable naming convention, it's easy to populate the missing **mail** attributes automatically using PowerShell.

## PowerShell Script

```powershell
# Load Active Directory module if not already loaded
Import-Module ActiveDirectory

# Define the group name
$groupName = "changeme"

# Process users and update missing emails
Get-ADGroupMember -Identity $groupName -Recursive |
    Where-Object { $_.objectClass -eq 'user' } |
    ForEach-Object {
        $user = Get-ADUser -Identity $_ -Properties mail

        if (-not $user.mail) {
            $email = "$($user.SamAccountName)@yourdomain.com"
            Set-ADUser -Identity $user.SamAccountName -EmailAddress $email
            Write-Host "Set email for $($user.SamAccountName): $email" -ForegroundColor Green
        }
        else {
            Write-Host "Email already set for $($user.SamAccountName): $($user.mail)" -ForegroundColor Yellow
        }
    }
```

## What the Script Does

The script performs the following actions:

1. Retrieves all users from the specified AD group, including nested groups.
2. Checks whether the **mail** attribute is empty.
3. If the attribute is missing, generates an email address using the user's **sAMAccountName**.
4. Writes the generated email address back to the **mail** attribute in Active Directory.
5. Skips users who already have an email address configured, ensuring that existing values are not overwritten.

## Notes

- Replace `changeme` with the target Active Directory group.
- Replace `yourdomain.com` with your organization's email domain.
- The account running the script must have permission to modify Active Directory user objects.
- Always test the script against a small pilot group before running it in a production environment.