---
title: " Automating Dynamics 365 Warehouse Management App Configuration with Microsoft Intune"
published: 2026-07-27
description: Learn how to use Microsoft Intune App Configuration Policies to automatically deploy and configure the Dynamics 365 Warehouse Management Mobile App on Android Enterprise devices, eliminating manual connection profile setup.
image: ""
tags:
  - COPE
  - Android-Enterprise
  - Intune
  - Dynamic-365
  - Warehouse-Management
category: Microsoft 365
draft: false
lang: en
---
# Introduction

Recently, we prepared to deploy a new batch of Android corporate devices.

Since these devices are managed using **Android Enterprise COPE (Corporate-Owned, Personally Enabled)**, users only need to sign in with their Microsoft account after receiving a new phone. Microsoft Intune then automatically enrolls the device and installs all required work applications.

Most of the deployment process has already been automated, with one exception.

That exception is the **Dynamics 365 Warehouse Management Mobile App (WMS)**.

Although the application can be installed automatically through Intune, users still need to manually create a connection profile the first time they launch the app by entering:

- Connection Name
- Environment URL
- Company
- Authentication Method
- Cloud

When deploying dozens or even hundreds of devices, this quickly becomes a repetitive task for the IT department.

This article demonstrates how to use **Microsoft Intune App Configuration Policies** to automatically provision the WMS connection profile, enabling a true zero-touch deployment experience.

---

# Environment

The environment used in this article is:

- Microsoft Intune
- Android Enterprise COPE
- Managed Google Play
- Microsoft Entra ID
- Dynamics 365 Warehouse Management Mobile App 4.1.4.0

---

# Deployment Goal

After the configuration is complete, the deployment process should achieve the following:

1. Intune automatically installs the Warehouse Management app.
2. Intune automatically creates the connection profile.
3. Users do not need to manually configure the connection profile.
4. Users simply sign in with their Microsoft account and can immediately start using WMS.

---

# Add the Warehouse Management App

First, make sure the Warehouse Management application has been added to Intune as a **Managed Google Play** app.

Navigate to:

```
Microsoft Intune Admin Center
→ Apps
→ Android
→ Add
→ Managed Google Play app
```

Search for:

```
Warehouse Management
```

Add the application to Intune.

---

# Create an App Configuration Policy

Navigate to:

```
Apps
→ App configuration policies
→ Create
```

Configure the policy as follows:

**Device enrollment type**

`Managed devices`

**Platform**

`Android Enterprise`

**Profile type**

`All Profile Types`

**Targeted app**

`Warehouse Management`

Create a new App Configuration Policy.

---

# Configure the App Using Configuration Designer

Open the **Settings** page.

Under **Configuration settings format**, select:

```
Use configuration designer
```

Click:

```
+ Add
```

Add the following configuration key:

```
ConnectionsJSON
```

Set the **Value type** to:

```
String
```

---

# Configure ConnectionsJSON

`ConnectionsJSON` stores the connection profile that the Warehouse Management app will automatically import during the first launch.

Example:

```JSON
{
  "ConnectionList": [
    {
      "ConnectionName": "WMS-PROD",
      "ActiveDirectoryResource": "https://your-environment.operations.dynamics.com",
      "Company": "ABC",
      "ConnectionType": "UsernamePassword",
      "AuthCloud": "AzureGlobal",
      "UseBroker": true,
      "IsEditable": false,
      "IsDefaultConnection": true
    }
  ]
}
```

> **Note**
> 
> To protect company information, the Environment URL, Company, and other sensitive values shown in this article have been anonymized. Replace them with the values that match your own environment.

Field descriptions:

|Field|Description|
|---|---|
|ConnectionName|The connection name displayed on the WMS home screen.|
|ActiveDirectoryResource|The Dynamics 365 Environment URL.|
|Company|The default legal entity (company) used during sign-in.|
|ConnectionType|Recommended value: `UsernamePassword`.|
|AuthCloud|Azure cloud environment, typically `AzureGlobal`.|
|UseBroker|Uses Microsoft Authenticator or Company Portal for broker-based authentication.|
|IsEditable|Determines whether users are allowed to modify the connection profile.|
|IsDefaultConnection|Specifies whether this connection should be the default profile.|

---

# Why Choose UsernamePassword + Broker

Warehouse Management supports multiple authentication methods, including:

- Username and Password
- Device Code

While **Device Code** authentication works well for shared devices, **UsernamePassword with Broker authentication** is generally the better choice for organizations already using Microsoft Intune and Microsoft Entra ID.

Benefits include:

- Authentication is handled through Microsoft Authenticator or Company Portal.
- A smoother and more familiar sign-in experience.
- Better integration with the Microsoft identity platform.
- No need to visit the Device Login page and enter a one-time verification code during sign-in.

---

# Assign the Policy

Avoid deploying the policy directly to all production devices.

Instead, create a small test group containing a single device and verify that:

- The WMS connection profile is created automatically.
- Microsoft authentication completes successfully.
- Users can successfully access Warehouse Management.
- No manual connection configuration is required.

After successful validation, assign the policy to your production device groups.

---

# Result

Once the App Configuration Policy has been deployed and the device completes Intune enrollment:

1. The Warehouse Management app is installed automatically.
2. The connection profile is created automatically.
3. Users do not need to enter the Environment URL.
4. Users do not need to configure the company or authentication settings.
5. Users simply sign in with their Microsoft account and can immediately begin using WMS.

The entire deployment process becomes fully automated, eliminating the need for IT to manually configure each device.

---

# Summary

Microsoft Intune is capable of much more than simply deploying applications. By combining **App Configuration Policies** with managed Android devices, it can also automate the initial configuration of enterprise applications.

For the Dynamics 365 Warehouse Management Mobile App, this allows the connection profile to be provisioned automatically instead of requiring manual configuration by IT.

When deploying dozens or even hundreds of Android Enterprise devices, this approach not only saves a significant amount of time but also improves deployment consistency and eliminates configuration errors caused by manual input.