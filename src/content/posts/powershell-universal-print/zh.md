---
title: 使用 PowerShell 批量配置 Universal Print Connector 打印机
published: 2026-07-13
description: 利用 UniversalPrintManagement PowerShell 模块，自动完成 Universal Print Connector 打印机的位置配置、共享创建以及权限授权，实现批量部署自动化。
tags:
  - PowerShell
  - Azure
  - Universal-Print
category: Microsoft 365
draft: false
lang: zh
---
# 前言

在部署 Microsoft Universal Print Connector 时，将打印机注册到 Universal Print 只是第一步。

打印机注册完成后，还需要继续完成以下配置：

- 设置 Organization
- 设置 Subdivision
- 设置 Site
- 创建 Printer Share
- 配置共享访问权限

如果环境中只有几台打印机，通过 Universal Print Portal 手动配置并不困难。

但当打印机数量达到几十甚至上百台时，这些重复操作会消耗大量时间，也容易出现命名不一致、位置填写错误或忘记授权等问题。

由于我们的打印机名称已经包含站点前缀，因此可以直接从打印机名称中识别 Site，再通过 PowerShell 自动完成后续配置。

本文记录一份已经在实际环境中执行成功的完整脚本。

# 环境

本次环境如下：

- Microsoft Universal Print
- Universal Print Connector
- Windows Print Server
- Windows PowerShell 5.1
- UniversalPrintManagement PowerShell Module

# PowerShell 脚本



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


# 执行脚本

将脚本保存为：

```
Publish-UniversalPrinters.ps1
```

打开 PowerShell，进入脚本所在目录。

如有需要，可以只为当前 PowerShell 会话临时允许脚本执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

先使用 Dry Run：

```
$DryRun = $true
```

确认输出没有问题后，改为：

```
$DryRun = $false
```

然后运行：

```powershell
.\Publish-UniversalPrinters.ps1
```

执行过程中需要登录具有 Universal Print 管理权限的 Microsoft 账户。

# 运行结果
![](Pasted%20image%2020260727124800.png)

# 脚本执行流程

这份脚本的完整处理流程如下：

```
连接 Universal Print
        │
        ▼
读取所有打印机
        │
        ▼
读取所有 Printer Share
        │
        ▼
筛选 Connector 打印机
        │
        ▼
跳过已经共享的打印机
        │
        ▼
从打印机名称提取 Site
        │
        ▼
判断 Canada 或 USA
        │
        ▼
设置位置属性
        │
        ▼
创建 Printer Share
        │
        ▼
获取 Share ID
        │
        ▼
授权 All Users
        │
        ▼
记录执行结果
        │
        ▼
导出 CSV 日志
```

# 命名规则

脚本依赖统一的打印机命名规则。

例如：

```
CAL-P01
MTL-P15
TOR-P22
ELK-P08
STL-P12
MIA-P03
```

第一个连字符 `-` 前面的内容会被识别为站点名称。

例如：

```
CAL-P01
│
└── Site = CAL
```

脚本使用下面的正则表达式提取前缀：

```
'^([^-]+)-'
```

如果打印机名称中不存在连字符，脚本无法判断 Site，并会将该打印机标记为失败，而不是继续使用错误的位置值。

# Canada 和 USA 的判断逻辑

脚本中定义了美国站点列表：

```powershell
$USASites = @(
    'ELK',
    'STL',
    'MIA'
)
```

如果打印机前缀位于这个列表中，则设置为：

```
Organization : US Organization
Subdivision  : USA
```

例如：

```
ELK-P08
STL-P12
MIA-P03
```

其他站点则统一设置为：

```
Organization : Canada Organization
Subdivision  : Canada
```

例如：

```
CAL-P01
MTL-P15
TOR-P22
```

这种方式不需要为每一台打印机单独维护映射关系。

只要新增打印机继续遵循相同命名规范，脚本就能够自动处理。

# 兼容不同的 PowerShell 返回格式

UniversalPrintManagement 模块中的部分命令，在不同版本中可能返回不同形式的对象。

有些版本直接返回对象数组，有些版本则会将结果放在：

```
.Results
```

属性中。

脚本中的 `Get-UPResultItems` 函数会判断返回对象是否包含 `Results` 属性：

```powershell
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

这样后面的脚本逻辑不需要关心模块返回的是哪一种格式。

# 只处理 Connector 打印机

Universal Print Portal 中可能同时存在：

- 通过 Universal Print Connector 注册的打印机
- 原生支持 Universal Print 的打印机

本文脚本只处理 Connector 打印机。

`Test-ConnectorPrinter` 函数会依次检查以下属性：

```
Connectors
Connector
ConnectorId
```

这是为了兼容不同模块版本可能使用的属性名称。

如果检测不到 Connector 信息，脚本会显示：

```
Skipping non-Connector printer
```

并跳过该设备。

这样可以避免修改原生 Universal Print 打印机。

# 跳过已经共享的打印机

脚本在开始处理前，会同时读取：

```powershell
Get-UPPrinter -IncludeConnectorDetails
```

以及：

```powershell
Get-UPPrinterShare
```

然后通过 Printer ID 判断打印机是否已经存在 Share。

除此之外，脚本还会检查打印机对象本身是否包含：

```
IsShared
Shares
```

如果打印机已经共享，会直接显示：

```
Skipping already shared printer
```

这意味着脚本可以重复运行。

已经处理完成的打印机不会再次创建 Share，脚本只会继续处理新注册但尚未共享的打印机。

# 设置打印机位置属性

脚本通过下面的命令设置打印机位置：

```powershell
Set-UPPrinterProperty `
    -PrinterId $PrinterId `
    -Organization @($Organization) `
    -Subdivision @($Subdivision) `
    -Site $Site `
    -Confirm:$false
```

这里需要注意，当前模块版本中的：

```
-Organization
-Subdivision
```

参数类型为：

```
string[]
```

因此脚本使用：

```
@($Organization)
@($Subdivision)
```

将字符串明确传递为数组。

# 创建 Printer Share

位置更新成功后，脚本会自动生成 Share Name：

```
$ShareName = "$PrinterName Cloud connector"
```

例如：

```
CAL-P01
```

会创建：

```
CAL-P01 Cloud connector
```

创建 Share 使用：

```powershell
New-UPPrinterShare `
    -PrinterId $PrinterId `
    -ShareName $ShareName `
    -Confirm:$false
```

在创建之前，脚本还会检查是否已经存在相同的 Share Name。

如果发现同名 Share，会停止处理当前打印机，并记录错误：

```
A printer share named '...' already exists.
```

这样可以避免因为命名冲突创建重复 Share。

# 重新查询 Share ID

在实际测试中，`New-UPPrinterShare` 虽然能够成功创建 Share，但模块不一定每次都立即返回完整的 Share 对象。

特别是后续执行：

```
Grant-UPAccess
```

时，需要使用 Share ID。

因此脚本会先尝试读取：

```
$NewShare.Id
```

如果 ID 为空，则等待两秒：

```
Start-Sleep -Seconds $ShareLookupDelaySeconds
```

然后重新执行：

```
Get-UPPrinterShare
```

并根据 Share Name 找到刚刚创建的 Share。

如果重新查询后仍然无法获得 Share ID，脚本会抛出错误：

```
The share was created, but its ShareId could not be retrieved.
```

这种处理可以避免出现 Share 已创建，但授权步骤因为缺少 Share ID 而静默失败的情况。

# 授权所有用户

获得 Share ID 后，脚本使用：

```powershell
Grant-UPAccess `
    -ShareId $ShareId `
    -AllUsersAccess `
    -Confirm:$false
```

将打印机共享给组织中的所有用户。

这里不能直接通过管道将 `New-UPPrinterShare` 的结果传给 `Grant-UPAccess`。

当前模块版本的 `Grant-UPAccess` 不接受这种管道输入，必须显式指定：

```
-ShareId
```

# Dry Run 模式

脚本提供了 Dry Run 功能：

```
$DryRun = $false
```

正式执行前，可以先修改为：

```
$DryRun = $true
```

在 Dry Run 模式下，脚本仍然会：

- 读取 Universal Print 打印机
- 筛选 Connector 打印机
- 判断哪些打印机已经共享
- 解析 Organization、Subdivision 和 Site
- 生成计划使用的 Share Name

但不会实际执行：

```
Set-UPPrinterProperty
New-UPPrinterShare
Grant-UPAccess
```

终端中会显示：

```
Dry run: no changes were made.
```

确认预览结果正确后，再将其改回：

```
$DryRun = $false
```

# 错误处理

脚本将每台打印机的处理过程放在独立的：

```
try {
}
catch {
}
```

结构中。

如果其中一台打印机失败，错误会被写入该打印机的结果对象，但不会终止整个批处理。

例如：

```
CAL-P01 failed: A printer share named 'CAL-P01 Cloud connector' already exists.
```

脚本随后会继续处理下一台打印机。

这对于批量处理大量打印机非常重要，因为单台设备的命名或配置问题不应该影响整个任务。

# 执行结果

每台被处理的打印机都会记录以下信息：

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

状态可能包括：

```
Success
Failed
Dry run
```

脚本执行结束后，会在 PowerShell 窗口中显示汇总表格，以及：

```
Processed
Successful
Failed
Dry run
```

数量统计。

# CSV 日志

脚本会在当前用户的桌面创建一份 CSV 文件：

```
UniversalPrint-Batch-yyyyMMdd-HHmmss.csv
```

例如：

```
UniversalPrint-Batch-20260727-113015.csv
```

CSV 中会包含每台被处理打印机的：

- 打印机名称
- Printer ID
- Organization
- Subdivision
- Site
- Share Name
- Share ID
- Location 更新状态
- Share 创建状态
- 权限状态
- 最终状态
- 错误信息

需要注意的是，脚本只会把**实际进入处理流程的打印机**写入 `$Results`。

下面这些被直接跳过的设备不会出现在 CSV 中：

- 非 Connector 打印机
- 已经共享的打印机
- DisplayName 为空的打印机
- Printer ID 为空的打印机

# 最终效果

脚本执行完成后，所有符合条件的 Connector 打印机会自动完成：

```
Organization
Subdivision
Site
Printer Share
All Users Access
```

已经共享的打印机会自动跳过，原生 Universal Print 打印机也不会被修改。

以后新增打印机时，只需要：

```
在 Connector 中注册打印机
        │
        ▼
运行脚本
```

即可完成后续配置。

# 总结

Universal Print Connector 能够解决传统打印机接入 Universal Print 的问题，但注册完成后的配置仍然包含大量重复工作。

通过 UniversalPrintManagement PowerShell 模块，可以把以下步骤统一自动化：

- 判断打印机类型
- 识别站点
- 设置位置属性
- 创建 Printer Share
- 授权所有用户
- 记录执行结果

相比在 Portal 中逐台配置，这种方式更适合管理大量打印机，也能够确保 Organization、Subdivision、Site 和 Share Name 始终遵循统一规范。

脚本还加入了 Dry Run、重复检查、Share ID 回查、错误隔离和 CSV 日志等机制，因此不仅可以完成一次性部署，也适合作为以后新增 Connector 打印机时的日常管理工具。