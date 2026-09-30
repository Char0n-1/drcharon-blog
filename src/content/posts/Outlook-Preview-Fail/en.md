---
title: Fixing Outlook Attachment Preview Failures Caused by Corrupted OWA User Configuration
published: 2026-09-30
description: A real-world Microsoft 365 troubleshooting case where one user could download attachments normally but could not preview Word or PDF files in New Outlook or Outlook on the web. The issue was ultimately resolved by resetting mailbox-level OWA user configuration.
tags:
  - Outlook
  - Troubleshooting
category: Microsoft 365
draft: false
lang: en
---

# Fixing Outlook Attachment Preview Failures Caused by Corrupted OWA User Configuration

## Background

I recently worked on an Outlook issue affecting a single Microsoft 365 user.

The user could receive attachments normally and download them without any problem. Downloaded PDF and Word files opened correctly in their respective applications.

However, attachment preview failed consistently in both:

- New Outlook
- Outlook on the web

The preview pane showed:

> The document preview could not be created. Please try again later.

Because the same behavior occurred in both New Outlook and OWA, the issue quickly became less likely to be a local Outlook client problem.

---

## Problem

The affected user could not preview:

- PDF files
- Word documents
- Newly received attachments
- Attachments in Sent Items

At the same time:

- Downloaded files opened correctly
- Other users could preview the exact same attachments
- The issue reproduced in InPrivate browsing
- Restarting the computer did not help

A particularly useful test was sending one of the affected attachments to another user.

The result was:

```text
Affected user -> Sent Items -> Preview failed
Working user  -> Same attachment -> Preview succeeded
````

This confirmed that the file itself was not corrupted.

The problem followed the affected user.

---

## Analysis

### Comparing OWA mailbox policies

The first Exchange Online check was the assigned OWA mailbox policy.

```powershell
Get-CASMailbox sabriena.gauvreau@adfastcorp.com |
Format-List DisplayName,PrimarySmtpAddress,OWAEnabled,OwaMailboxPolicy
```

The affected user was assigned:

```powershell
OwaMailboxPolicy-Default
```

A known-good user had the same policy.

The relevant WAC and attachment access settings were then checked:

```powershell
Get-OwaMailboxPolicy |
Format-Table Name,
WacViewingOnPrivateComputersEnabled,
WacViewingOnPublicComputersEnabled,
DirectFileAccessOnPrivateComputersEnabled,
DirectFileAccessOnPublicComputersEnabled
```

The important values were enabled:

```powershell
WacViewingOnPrivateComputersEnabled  : True
WacViewingOnPublicComputersEnabled   : True
DirectFileAccessOnPrivateComputersEnabled : True
```

So the issue was not caused by a different OWA policy assignment.

---
### Comparing Exchange client access settings

I also compared the affected user with a working user using:

```powershell
Get-CASMailbox baduser@contasco.com | Format-List *
Get-CASMailbox gooduser@contasco.com | Format-List *
```

The important client access settings were normal:

```powershell
OWAEnabled              : True
UniversalOutlookEnabled : True
EwsEnabled              : True
MAPIEnabled             : True
OwaMailboxPolicy        : OwaMailboxPolicy-Default
```

There was no obvious mailbox access configuration difference that could explain the preview failure.

---

### Browser developer logs

The next useful step was checking Outlook on the web with browser developer tools.

Several user-specific OWA endpoints were returning errors.

Examples included:

```
GET ows/v1/OutlookCloudSettings/settings/...
401 Unauthorized
```

and:

```
GET https://outlook.office.com/ows/v1.0/OutlookOptions
401 Unauthorized
```

There were also failed requests related to Outlook user options, including:

```
PATCH /ows/v1.0/OutlookOptions/MailLayout
401 Unauthorized
```

Not every `401` was necessarily directly related to attachment preview, but the pattern showed that some user-specific OWA configuration calls were not behaving normally.

The most interesting error was:

```
POST https://outlook.office.com/owa/service.svc?action=ValidateAggregatedConfiguration&app=Mail
500 Internal Server Error
```

This suggested that Outlook was having trouble validating or loading aggregated user configuration.

At that point, the issue looked increasingly mailbox-specific.

---
## Solution

Microsoft Support eventually provided a PowerShell script to reset several mailbox-level OWA configuration objects.

The relevant commands were:

```powershell
Connect-ExchangeOnline

$mailbox = Get-Mailbox affecteduser@contasco.com

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.Suite.Storage `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.Agregated.OWAUserConfiguration `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.OWA.SessionInformation `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.OWA.UserOptions `
-Confirm:$false

Remove-MailboxUserConfiguration `
-Mailbox $mailbox.Identity `
-Identity Configuration\IPM.Configuration.OWA.ViewStateConfiguration `
-Confirm:$false
```

After the script completed, the user was asked to:

```
Sign out from Outlook on the web
Sign back in
Retest attachment preview
```

The preview immediately started working again.

---

## What the script actually reset

The script did not remove mail, folders, calendar items, contacts, or attachments.

It removed several hidden mailbox-level configuration objects used by Outlook on the web and modern Outlook services.

These included:

### Suite.Storage

```powershell
Configuration\IPM.Configuration.Suite.Storage
```

Stores part of the Microsoft 365 / Outlook user state.

### Aggregated OWA user configuration

```powershell
Configuration\IPM.Configuration.Agregated.OWAUserConfiguration
```

This was especially interesting because the browser logs had previously shown:

```powershell
ValidateAggregatedConfiguration
500 Internal Server Error
```

The final repair directly reset the corresponding aggregated OWA configuration object.

### OWA session information

```powershell
Configuration\IPM.Configuration.OWA.SessionInformation
```

Stores session-related OWA state.

Signing out and signing back in allowed Outlook to recreate this information.

### OWA user options

```powershell
Configuration\IPM.Configuration.OWA.UserOptions
```

Stores user-specific Outlook preferences and options.

### OWA view state

```powershell
Configuration\IPM.Configuration.OWA.ViewStateConfiguration
```

Stores parts of the Outlook web interface and view state.

After these objects were removed, Outlook rebuilt them during the next sign-in.

---

## Root Cause

Microsoft did not provide a formal backend root-cause report, but the evidence strongly pointed to a corrupted or inconsistent mailbox-level OWA user configuration.

The full troubleshooting path looked like this:

```
Single user affected
        |
        v
Same files work for other users
        |
        v
New Outlook and OWA both affected
        |
        v
OWA policy, licensing, CA and mailbox provisioning all healthy
        |
        v
OutlookCloudSettings / OutlookOptions errors
        |
        v
ValidateAggregatedConfiguration -> 500
        |
        v
Reset mailbox-level OWA configuration
        |
        v
Sign out / sign in
        |
        v
Attachment preview restored
```

A reasonable root-cause statement is:

> The affected mailbox had an inconsistent or corrupted OWA user configuration stored in Exchange Online. Resetting the mailbox-level OWA configuration forced Outlook to regenerate the affected objects and restored attachment preview functionality.

