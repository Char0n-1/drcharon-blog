---
title: Bulk Configure Universal Print Connector Printers with PowerShell
published: 2026-07-13
description: Use the UniversalPrintManagement PowerShell module to configure printer locations, create printer shares, grant access, and export deployment results in bulk.
tags:
  - PowerShell
  - Azure
  - Universal-Print
category: Microsoft 365
draft: false
lang: en
---
# Introduction

When deploying Microsoft Universal Print Connector, registering printers with Universal Print is only the first step.

After registration, each printer still requires several additional configuration tasks:

- Set the Organization
    
- Set the Subdivision
    
- Set the Site
    
- Create a Printer Share
    
- Configure share access permissions
    

For an environment with only a few printers, completing these tasks manually in the Universal Print portal is not difficult.

However, when the environment contains dozens or even hundreds of printers, these repetitive tasks consume a significant amount of time and can easily lead to inconsistent naming, incorrect location information, or missing access permissions.

Because our printer names already include a site prefix, the script can identify the Site directly from each printer name and use PowerShell to complete the remaining configuration automatically.

This article documents the complete script that was successfully tested and used in a production environment.

# Environment

The environment used in this article includes:

- Microsoft Universal Print
    
- Universal Print Connector
    
- Windows Print Server
    
- Windows PowerShell 5.1
    
- UniversalPrintManagement PowerShell module
    

# PowerShell Script

```powershell
#Requires -Version 5.1

<#
.SYNOPSIS
    Configure and share unshared Universal Print Connector printers.

.DESCRIPTION
    For each Universal Print Connector printer that is not already shared:

    1. Determine the site from the printer-name prefix.
    2. Set Organization, Subdivision, and Site.
    3. Create a printer share named:
           <PrinterName> Cloud connector
    4. Grant access to all users.
    5. Export the execution results to CSV.

.NAMING RULES
    ELK-*  -> Adfast USA / USA / ELK
    STL-*  -> Adfast USA / USA / STL
    MIA-*  -> Adfast USA / USA / MIA

    All other prefixes:
    CAL-*  -> Adfast Canada / Canada / CAL
    MTL-*  -> Adfast Canada / Canada / MTL
    TOR-*  -> Adfast Canada / Canada / TOR
    etc.
#>

$ErrorActionPreference = 'Stop'

# ============================================================
# Configuration
# ============================================================

$USASites = @(
    'ELK',
    'STL',
    'MIA'
)

$CanadaOrganization = 'Adfast Canada'
$CanadaSubdivision  = 'Canada'

$USAOrganization = 'Adfast USA'
$USASubdivision  = 'USA'

$ShareSuffix = 'Cloud connector'

# Set to $true to preview changes without modifying anything.
# Set to $false for actual execution.
$DryRun = $false

# Delay before re-querying a newly created share.
$ShareLookupDelaySeconds = 2

# ============================================================
# Helper functions
# ============================================================

function Get-UPResultItems {
    param(
        [Parameter(Mandatory)]
        $InputObject
    )

    if ($null -eq $InputObject) {
        return @()
    }

    if ($InputObject.PSObject.Properties.Name -contains 'Results') {
        return @($InputObject.Results)
    }

    return @($InputObject)
}

function Get-PrinterSite {
    param(
        [Parameter(Mandatory)]
        [string]$PrinterName
    )

    if ($PrinterName -notmatch '^([^-]+)-') {
        throw "Printer name '$PrinterName' does not contain a valid site prefix followed by '-'."
    }

    return $Matches[1].Trim().ToUpperInvariant()
}

function Test-ConnectorPrinter {
    param(
        [Parameter(Mandatory)]
        $Printer
    )

    # Get-UPPrinter -IncludeConnectorDetails normally provides
    # the Connectors property for Connector-registered printers.
    if ($Printer.PSObject.Properties.Name -contains 'Connectors') {
        return @($Printer.Connectors).Count -gt 0
    }

    # Fallback for module versions that expose connector details
    # under a singular Connector property.
    if ($Printer.PSObject.Properties.Name -contains 'Connector') {
        return $null -ne $Printer.Connector
    }

    if ($Printer.PSObject.Properties.Name -contains 'ConnectorId') {
        return -not [string]::IsNullOrWhiteSpace(
            [string]$Printer.ConnectorId
        )
    }

    return $false
}

function Get-SharePrinterId {
    param(
        [Parameter(Mandatory)]
        $Share
    )

    if (
        $Share.PSObject.Properties.Name -contains 'PrinterId' -and
        $Share.PrinterId
    ) {
        return [string]$Share.PrinterId
    }

    if (
        $Share.PSObject.Properties.Name -contains 'Printer' -and
        $Share.Printer -and
        $Share.Printer.Id
    ) {
        return [string]$Share.Printer.Id
    }

    return $null
}

# ============================================================
# Connect to Universal Print
# ============================================================

Write-Host ''
Write-Host 'Connecting to Universal Print...' -ForegroundColor Cyan

Import-Module UniversalPrintManagement -ErrorAction Stop
Connect-UPService

# ============================================================
# Retrieve printers and shares
# ============================================================

Write-Host 'Retrieving Universal Print printers...' -ForegroundColor Cyan

$PrinterResponse = Get-UPPrinter -IncludeConnectorDetails
$Printers = Get-UPResultItems -InputObject $PrinterResponse

Write-Host "Printers retrieved: $($Printers.Count)"

Write-Host 'Retrieving existing printer shares...' -ForegroundColor Cyan

$ShareResponse = Get-UPPrinterShare
$ExistingShares = Get-UPResultItems -InputObject $ShareResponse

Write-Host "Existing shares retrieved: $($ExistingShares.Count)"

# ============================================================
# Process printers
# ============================================================

$Results = [System.Collections.Generic.List[object]]::new()

foreach ($Printer in $Printers) {

    $PrinterName = ([string]$Printer.DisplayName).Trim()
    $PrinterId   = [string]$Printer.Id

    if ([string]::IsNullOrWhiteSpace($PrinterName)) {
        Write-Warning 'Skipped a printer because its DisplayName is empty.'
        continue
    }

    if ([string]::IsNullOrWhiteSpace($PrinterId)) {
        Write-Warning "Skipped '$PrinterName' because its PrinterId is empty."
        continue
    }

    # Only process Connector-registered printers.
    if (-not (Test-ConnectorPrinter -Printer $Printer)) {
        Write-Host "Skipping non-Connector printer: $PrinterName" `
            -ForegroundColor DarkGray

        continue
    }

    # Determine whether this printer already has a share.
    $ExistingPrinterShare = $ExistingShares |
        Where-Object {
            (Get-SharePrinterId -Share $_) -eq $PrinterId
        } |
        Select-Object -First 1

    # Additional check in case the printer object contains share details.
    $PrinterReportsShared = $false

    if ($Printer.PSObject.Properties.Name -contains 'IsShared') {
        $PrinterReportsShared = [bool]$Printer.IsShared
    }

    if (
        -not $PrinterReportsShared -and
        $Printer.PSObject.Properties.Name -contains 'Shares'
    ) {
        $PrinterReportsShared = @($Printer.Shares).Count -gt 0
    }

    if ($ExistingPrinterShare -or $PrinterReportsShared) {
        Write-Host "Skipping already shared printer: $PrinterName" `
            -ForegroundColor DarkGray

        continue
    }

    $Result = [ordered]@{
        PrinterName  = $PrinterName
        PrinterId    = $PrinterId
        Organization = ''
        Subdivision  = ''
        Site         = ''
        ShareName    = ''
        ShareId      = ''
        Location     = 'Not attempted'
        Share        = 'Not attempted'
        Permission   = 'Not attempted'
        Status       = 'Pending'
        Error        = ''
    }

    try {
        $Site = Get-PrinterSite -PrinterName $PrinterName

        if ($Site -in $USASites) {
            $Organization = $USAOrganization
            $Subdivision  = $USASubdivision
        }
        else {
            $Organization = $CanadaOrganization
            $Subdivision  = $CanadaSubdivision
        }

        $ShareName = "$PrinterName $ShareSuffix"

        $Result.Organization = $Organization
        $Result.Subdivision  = $Subdivision
        $Result.Site         = $Site
        $Result.ShareName    = $ShareName

        Write-Host ''
        Write-Host "Processing: $PrinterName" -ForegroundColor Yellow
        Write-Host "  Printer ID   : $PrinterId"
        Write-Host "  Organization : $Organization"
        Write-Host "  Subdivision  : $Subdivision"
        Write-Host "  Site         : $Site"
        Write-Host "  Share name   : $ShareName"
        Write-Host '  Access       : All users'

        # Check for a duplicate share name.
        $DuplicateShare = $ExistingShares |
            Where-Object {
                ([string]$_.DisplayName).Trim() -eq $ShareName
            } |
            Select-Object -First 1

        if ($DuplicateShare) {
            throw "A printer share named '$ShareName' already exists."
        }

        if ($DryRun) {
            $Result.Location   = 'Preview only'
            $Result.Share      = 'Preview only'
            $Result.Permission = 'Preview only'
            $Result.Status     = 'Dry run'

            Write-Host '  Dry run: no changes were made.' `
                -ForegroundColor Cyan
        }
        else {
            # ------------------------------------------------
            # Set printer location properties
            # ------------------------------------------------

            Set-UPPrinterProperty `
                -PrinterId $PrinterId `
                -Organization @($Organization) `
                -Subdivision @($Subdivision) `
                -Site $Site `
                -Confirm:$false `
                -ErrorAction Stop |
                Out-Null

            $Result.Location = 'Updated'

            Write-Host '  Location updated.' `
                -ForegroundColor Green

            # ------------------------------------------------
            # Create printer share
            # ------------------------------------------------

            $NewShare = New-UPPrinterShare `
                -PrinterId $PrinterId `
                -ShareName $ShareName `
                -Confirm:$false `
                -ErrorAction Stop

            $Result.Share = 'Created'

            Write-Host '  Share created.' `
                -ForegroundColor Green

            # The module might return a share object without an Id.
            # Re-query the share if necessary.
            $ShareId = [string]$NewShare.Id

            if ([string]::IsNullOrWhiteSpace($ShareId)) {
                Start-Sleep -Seconds $ShareLookupDelaySeconds

                $RefreshedShareResponse = Get-UPPrinterShare
                $RefreshedShares = Get-UPResultItems `
                    -InputObject $RefreshedShareResponse

                $NewShare = $RefreshedShares |
                    Where-Object {
                        ([string]$_.DisplayName).Trim() -eq $ShareName
                    } |
                    Select-Object -First 1

                $ShareId = [string]$NewShare.Id
            }

            if ([string]::IsNullOrWhiteSpace($ShareId)) {
                throw "The share was created, but its ShareId could not be retrieved."
            }

            $Result.ShareId = $ShareId

            # ------------------------------------------------
            # Grant access to all users
            # ------------------------------------------------

            Grant-UPAccess `
                -ShareId $ShareId `
                -AllUsersAccess `
                -Confirm:$false `
                -ErrorAction Stop |
                Out-Null

            $Result.Permission = 'All users'
            $Result.Status     = 'Success'

            Write-Host '  All-users access granted.' `
                -ForegroundColor Green

            # Add the new share to the local collection so that
            # later printers cannot create the same share name.
            $ExistingShares += $NewShare

            Write-Host '  Completed successfully.' `
                -ForegroundColor Green
        }
    }
    catch {
        $Result.Status = 'Failed'
        $Result.Error  = $_.Exception.Message

        Write-Warning "$PrinterName failed: $($_.Exception.Message)"
    }

    $Results.Add([pscustomobject]$Result)
}

# ============================================================
# Export results
# ============================================================

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$LogPath = Join-Path `
    -Path ([Environment]::GetFolderPath('Desktop')) `
    -ChildPath "UniversalPrint-Batch-$Timestamp.csv"

if ($Results.Count -gt 0) {
    $Results |
        Export-Csv `
            -Path $LogPath `
            -NoTypeInformation `
            -Encoding UTF8

    Write-Host ''
    Write-Host 'Execution results:' -ForegroundColor Cyan

    $Results |
        Sort-Object PrinterName |
        Format-Table `
            PrinterName,
            Organization,
            Subdivision,
            Site,
            Location,
            Share,
            Permission,
            Status,
            Error `
            -AutoSize `
            -Wrap

    $SuccessfulCount = @(
        $Results | Where-Object Status -eq 'Success'
    ).Count

    $FailedCount = @(
        $Results | Where-Object Status -eq 'Failed'
    ).Count

    $DryRunCount = @(
        $Results | Where-Object Status -eq 'Dry run'
    ).Count

    Write-Host ''
    Write-Host '============================================================'
    Write-Host "Processed : $($Results.Count)"
    Write-Host "Successful: $SuccessfulCount" -ForegroundColor Green
    Write-Host "Failed    : $FailedCount" -ForegroundColor Red
    Write-Host "Dry run   : $DryRunCount" -ForegroundColor Cyan
    Write-Host '============================================================'
    Write-Host "Log saved to: $LogPath"
}
else {
    Write-Host ''
    Write-Host 'No unshared Connector printers were found.' `
        -ForegroundColor Yellow
}
```

# Running the Script

Save the script as:

```
Publish-UniversalPrinters.ps1
```

Open PowerShell and change to the directory containing the script.

If necessary, temporarily allow script execution for the current PowerShell session only:

```
Set-ExecutionPolicy -Scope Process Bypass
```

Start with Dry Run enabled:

```
$DryRun = $true
```

After confirming that the output is correct, change it to:

```
$DryRun = $false
```

Then run:

```
.\Publish-UniversalPrinters.ps1
```

During execution, sign in with a Microsoft account that has the required Universal Print administrative permissions.

# Execution Result
![](Pasted%20image%2020260727124800.png)

# Script Workflow

The script follows this complete workflow:

```
Connect to Universal Print
        │
        ▼
Retrieve all printers
        │
        ▼
Retrieve all Printer Shares
        │
        ▼
Filter Connector-registered printers
        │
        ▼
Skip printers that are already shared
        │
        ▼
Extract the Site from the printer name
        │
        ▼
Determine whether the printer is in Canada or the USA
        │
        ▼
Set location properties
        │
        ▼
Create the Printer Share
        │
        ▼
Retrieve the Share ID
        │
        ▼
Grant access to All Users
        │
        ▼
Record the execution result
        │
        ▼
Export the CSV log
```

# Naming Convention

The script depends on a consistent printer naming convention.

For example:

```
CAL-P01
MTL-P15
TOR-P22
ELK-P08
STL-P12
MIA-P03
```

The value before the first hyphen (`-`) is treated as the site name.

For example:

```
CAL-P01
│
└── Site = CAL
```

The script extracts the prefix with the following regular expression:

```
'^([^-]+)-'
```

If a printer name does not contain a hyphen, the script cannot determine its Site. Instead of continuing with an incorrect location value, it marks that printer as failed.

# Canada and USA Classification Logic

The script defines the US sites in an array:

```
$USASites = @(
    'ELK',
    'STL',
    'MIA'
)
```

If the printer prefix appears in this list, the script assigns:

```
Organization : US Organization
Subdivision  : USA
```

For example:

```
ELK-P08
STL-P12
MIA-P03
```

All other sites are assigned:

```
Organization : Canada Organization
Subdivision  : Canada
```

For example:

```
CAL-P01
MTL-P15
TOR-P22
```

This approach avoids maintaining a separate mapping for every individual printer.

As long as newly added printers continue to follow the same naming convention, the script can process them automatically.

# Supporting Different PowerShell Return Formats

Some commands in the UniversalPrintManagement module may return objects in different formats depending on the installed module version.

Some versions return an object array directly, while others place the results inside a property named:

```
.Results
```

The `Get-UPResultItems` function checks whether the returned object contains a `Results` property:

```
function Get-UPResultItems {
    param(
        [Parameter(Mandatory)]
        $InputObject
    )

    if ($null -eq $InputObject) {
        return @()
    }

    if ($InputObject.PSObject.Properties.Name -contains 'Results') {
        return @($InputObject.Results)
    }

    return @($InputObject)
}
```

This allows the rest of the script to use a consistent object structure without needing to know which return format the installed module uses.

# Processing Only Connector-Registered Printers

The Universal Print portal may contain both:

- Printers registered through Universal Print Connector
    
- Printers with native Universal Print support
    

This script processes only Connector-registered printers.

The `Test-ConnectorPrinter` function checks the following properties:

```
Connectors
Connector
ConnectorId
```

This provides compatibility with module versions that may expose Connector information under different property names.

If no Connector information is found, the script displays:

```
Skipping non-Connector printer
```

and skips the device.

This prevents the script from modifying native Universal Print printers.

# Skipping Printers That Are Already Shared

Before processing printers, the script retrieves both:

```
Get-UPPrinter -IncludeConnectorDetails
```

and:

```
Get-UPPrinterShare
```

It then checks whether a Printer Share already exists for each Printer ID.

The script also checks whether the printer object contains either of these properties:

```
IsShared
Shares
```

If the printer is already shared, the script displays:

```
Skipping already shared printer
```

This makes the script safe to run repeatedly.

Printers that have already been processed are not shared again. The script continues only with newly registered Connector printers that do not yet have a Printer Share.

# Setting Printer Location Properties

The script sets the printer location properties with:

```powershell
Set-UPPrinterProperty `
    -PrinterId $PrinterId `
    -Organization @($Organization) `
    -Subdivision @($Subdivision) `
    -Site $Site `
    -Confirm:$false
```

An important detail is that, in the module version used in this environment, the following parameters are typed as arrays:

```
-Organization
-Subdivision
```

Their parameter type is:

```
string[]
```

The script therefore uses:

```
@($Organization)
@($Subdivision)
```

to pass each value explicitly as an array.

# Creating the Printer Share

After successfully updating the location properties, the script generates the Share Name automatically:

```
$ShareName = "$PrinterName Cloud connector"
```

For example, this printer:

```
CAL-P01
```

creates the following share:

```
CAL-P01 Cloud connector
```

The share is created with:

```powershell
New-UPPrinterShare `
    -PrinterId $PrinterId `
    -ShareName $ShareName `
    -Confirm:$false
```

Before creating it, the script checks whether another share already uses the same Share Name.

If a duplicate is found, processing for that printer stops and the script records the following error:

```
A printer share named '...' already exists.
```

This prevents duplicate Printer Shares caused by naming conflicts.

# Re-querying the Share ID

During testing, `New-UPPrinterShare` successfully created the share, but the module did not always return a complete share object immediately.

The next command:

```
Grant-UPAccess
```

requires the Share ID.

The script therefore first attempts to read:

```
$NewShare.Id
```

If the ID is empty, it waits for two seconds:

```
Start-Sleep -Seconds $ShareLookupDelaySeconds
```

It then runs:

```
Get-UPPrinterShare
```

again and locates the newly created share by its Share Name.

If the Share ID is still unavailable after the second query, the script throws this error:

```
The share was created, but its ShareId could not be retrieved.
```

This prevents a situation where the Printer Share is created successfully but the permission step silently fails because the Share ID is missing.

# Granting Access to All Users

After retrieving the Share ID, the script uses:

```powershell
Grant-UPAccess `
    -ShareId $ShareId `
    -AllUsersAccess `
    -Confirm:$false
```

to make the printer available to all users in the organization.

The result returned by `New-UPPrinterShare` cannot be passed directly to `Grant-UPAccess` through the pipeline.

In the module version used in this environment, `Grant-UPAccess` does not accept that form of pipeline input. The script must explicitly provide:

```
-ShareId
```

# Dry Run Mode

The script includes a Dry Run option:

```
$DryRun = $false
```

Before the first production run, it can be changed to:

```
$DryRun = $true
```

In Dry Run mode, the script still:

- Retrieves Universal Print printers
    
- Filters Connector-registered printers
    
- Determines which printers are already shared
    
- Calculates the Organization, Subdivision, and Site
    
- Generates the planned Share Name
    

However, it does not execute:

```
Set-UPPrinterProperty
New-UPPrinterShare
Grant-UPAccess
```

The console displays:

```
Dry run: no changes were made.
```

After confirming that the preview is correct, change the value back to:

```
$DryRun = $false
```

# Error Handling

The processing logic for each printer is placed inside its own:

```
try {
}
catch {
}
```

block.

If one printer fails, the error is written to that printer's result object without terminating the entire batch.

For example:

```
CAL-P01 failed: A printer share named 'CAL-P01 Cloud connector' already exists.
```

The script then continues with the next printer.

This is important when processing a large number of printers, because a naming or configuration problem on one device should not interrupt the entire job.

# Execution Results

For every printer that enters the processing workflow, the script records:

```
PrinterName
PrinterId
Organization
Subdivision
Site
ShareName
ShareId
Location
Share
Permission
Status
Error
```

Possible status values include:

```
Success
Failed
Dry run
```

At the end of execution, the script displays a summary table in the PowerShell console together with these counts:

```
Processed
Successful
Failed
Dry run
```

# CSV Log

The script creates a CSV file on the current user's desktop:

```
UniversalPrint-Batch-yyyyMMdd-HHmmss.csv
```

For example:

```
UniversalPrint-Batch-20260727-113015.csv
```

The CSV contains the following information for each processed printer:

- Printer name
- Printer ID
- Organization
- Subdivision
- Site
- Share Name
- Share ID
- Location update status
- Share creation status
- Permission status
- Final status
- Error details

Only printers that actually enter the processing workflow are added to `$Results` and written to the CSV.

The following devices are skipped before that point and therefore do not appear in the CSV:

- Non-Connector printers
- Printers that are already shared
- Printers with an empty DisplayName
- Printers with an empty Printer ID

# Final Result

After the script completes, every eligible Connector-registered printer is automatically configured with:

```
Organization
Subdivision
Site
Printer Share
All Users Access
```

Printers that are already shared are skipped automatically, and native Universal Print printers are not modified.

When adding printers in the future, the remaining process becomes:

```
Register the printer in the Connector
        │
        ▼
Run the script
```

The script completes the remaining configuration automatically.

# Conclusion

Universal Print Connector makes it possible to bring traditional printers into Universal Print, but the configuration work after registration can still involve many repetitive tasks.

Using the UniversalPrintManagement PowerShell module, the following steps can be automated as a single workflow:

- Identify the printer type
    
- Determine the site
    
- Set location properties
    
- Create the Printer Share
    
- Grant access to all users
    
- Record execution results
    

Compared with configuring each printer individually in the portal, this approach is better suited to environments with many printers and ensures that Organization, Subdivision, Site, and Share Name values remain consistent.

The script also includes Dry Run support, duplicate detection, Share ID re-querying, per-printer error isolation, and CSV logging. This makes it suitable not only for an initial bulk deployment, but also as a routine management tool for newly added Connector printers.