---
title: Windows Hello for Business (Key Trust) Troubleshooting in a Hybrid AD Environment
published: 2026-07-16
description: From "That option is temporarily unavailable" to a fully functional Windows Hello for Business deployment.
tags:
  - Windows
  - Windows-Hello
  - Active-Directory
  - Entra-ID
  - Intune
  - PKI
  - Kerberos
category: Infrastructure
draft: false
lang: en
---
Recently, while deploying Windows Hello for Business, I ran into a much larger problem than expected. The troubleshooting process lasted two days. In the end, the issue was not caused by a single misconfiguration, but by several historical problems that had accumulated over time and broken the entire authentication chain.

This article documents the full troubleshooting process so that I will not have to repeat the same investigation the next time I encounter a similar issue.

---

# Environment


- On-premises Active Directory

- Microsoft Entra ID Hybrid Join

- Microsoft Intune

- Windows Hello for Business

- Key Trust deployment

- Enterprise CA (AD CS)

  
The Windows 11 device had already completed Hybrid Join and had been automatically enrolled in Intune.
  
In theory, deploying a Windows Hello policy should have been enough to allow users to sign in with a PIN. In practice, it was not that simple.
# Symptoms

The investigation began with a routine user report.

The user had successfully configured a Windows Hello PIN and expected to use it for future Windows sign-ins.

However, after locking the device and selecting PIN sign-in, Windows displayed the following message:


> **That option is temporarily unavailable.**

> **For now, please use a different sign-in method.**


![](Pasted%20image%2020260717110121.png)

  

In other words, the PIN appeared to have been configured successfully, but the actual sign-in attempt was rejected.

At the same time, the Windows Hello settings page showed no obvious problem and did not report that PIN creation had failed.

My first assumption was that the PIN had not actually been provisioned correctly.

The first step was therefore to check the Windows Hello state:


```pwsh

dsregcmd /status

```

The result showed:

```text

NgcSet : NO

```

Further down, under the Windows Hello prerequisite check, I found:

```text

PreReqResult : WillNotProvision

```

  
This meant the problem had not even reached the authentication stage.

Windows Hello had not completed provisioning.

The first phase of the investigation therefore became:

> **Why was Windows Hello refusing to begin provisioning?**

---

# Phase 1: Getting Windows Hello to Provision

After seeing `WillNotProvision`, I stopped and reviewed how Windows Hello for Business actually works.

Many people, including me at the beginning of this investigation, think of Windows Hello as simply “setting a PIN.”

That is not what it is.

With Windows Hello for Business, the PIN only unlocks a locally stored key. It is not the user's actual password.

The process can be divided into two main stages:

- Provisioning

- Authentication
  
## Stage 1: Provisioning


When Windows Hello is enabled for the first time, Windows performs several initialization tasks, including:

- Checking whether the device meets the deployment requirements;

- Checking whether policy allows Windows Hello to be enabled;

- Generating a new public/private key pair in the TPM or software key storage;

- Registering the public key with the identity system, such as Active Directory or Microsoft Entra ID;

- Completing Windows Hello initialization.

Only after all of these steps are complete can the user successfully create a PIN.

If provisioning fails, the sign-in process never begins.

The value I had found:

```text

PreReqResult : WillNotProvision

```

confirmed that the process was stopping at this stage.

## Stage 2: Authentication

After provisioning is complete, Windows Hello enters its normal day-to-day use phase.

Each time the user enters the PIN, Windows uses the previously generated key to authenticate the user.

If this stage fails, the symptoms are different:

- The PIN can be created;

- Windows Hello appears to be enabled;

- The user still cannot sign in with the PIN.

This became the second problem later in the investigation.

For now, the immediate goal was to get Windows Hello to complete provisioning.

---

### Reviewing the Intune Configuration

Windows Hello for Business has two Intune configuration locations that are easy to confuse.

The first is:

> **Devices → Windows → Enrollment → Windows Hello for Business**

![](Pasted%20image%2020260717112051.png)

This is the **Enrollment** configuration.

It controls whether Windows Hello is enabled for devices and includes several basic settings.
The second location is:

> **Devices → Windows → Configuration → Policies**

![](Pasted%20image%2020260717112035.png)
This is a **Configuration Profile**

It applies more detailed settings to the device, such as PIN complexity, biometric settings, TPM requirements, other Windows settings, and the deployment model to use, such as Cloud Trust, Key Trust, or Certificate Trust. It can be thought of as the broader Windows Hello policy.

Although both locations affect Windows Hello, they serve different purposes.

In simple terms:

- **Enrollment** determines **whether Windows Hello can start working**;

- **Configuration Policy** determines **how Windows Hello should work**.

---

The investigation showed that Cloud Trust had been enabled in the configuration profile, but the on-premises hybrid domain was not ready for it.

Because Cloud Trust and Key Trust had both been tested previously, the environment had switched between the two deployment models several times, and the configuration profile had been modified repeatedly.

Continuing to troubleshoot Cloud Trust was not the best choice.

The environment still contained Windows Server 2012 domain controllers. Although Cloud Trust was not necessarily impossible to deploy, properly validating and rolling it out should have been treated as a separate project rather than something to redesign in the middle of an incident.

The immediate objective was simple:

> **Restore working PIN sign-in for the user.**

I therefore disabled Cloud Trust temporarily and returned to the Key Trust deployment model, which was easier to validate in the existing environment.

![](Pasted%20image%2020260717112153.png)

After the policy change, I checked the device state again:

```pwsh

dsregcmd /status

```

The important section was:

```text

+----------------------------------------------------------------------+

| Ngc Prerequisite Check                                               |

+----------------------------------------------------------------------+

  

            IsDeviceJoined : YES

             IsUserAzureAD : YES

             PolicyEnabled : YES

          PostLogonEnabled : YES

            DeviceEligible : YES

        SessionIsNotRemote : YES

            CertEnrollment : enrollment authority

          AdfsRefreshToken : YES

             AdfsRaIsReady : YES

    LogonCertTemplateReady : YES ( StateReady )

              PreReqResult : WillProvision

+----------------------------------------------------------------------+

```


This time, the user was finally able to create the PIN successfully.

Windows Hello provisioning had completed.
# Phase 2: The PIN Was Created, So Why Did Sign-In Still Fail?

After Cloud Trust was disabled, Windows Hello completed provisioning and the user was able to configure a PIN.

However, when the user tried to sign in from the lock screen, Windows still displayed:

> **That option is temporarily unavailable.**

> **For now, please use a different sign-in method.**

This was now a different problem.

Earlier, Windows Hello had been unable to begin provisioning. Now the PIN had been created, which meant the initialization process had at least progressed much further.

The next question was:

> **Had Windows Hello reached the authentication stage, and where was authentication failing?**

---

## Confirming the Authentication Failure in the Windows Hello Logs

I did not use the Event Viewer GUI. Instead, I read the Windows Hello Operational log directly with PowerShell:

  
```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-HelloForBusiness/Operational" `

    -MaxEvents 50 |

    Select-Object TimeCreated, Id, LevelDisplayName, Message |

    Format-List

```

The output included:

```text

TimeCreated Id LevelDisplayName Message

----------- -- ---------------- -------

2026-07-17 10:17:39 AM 7001 Error A user failed to sign into the device with the following information:...

2026-07-17 10:17:39 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0...

2026-07-17 10:17:38 AM 5002 Information A user is signing into the device with the following gesture informatio...

2026-07-17 10:15:34 AM 5205 Information Windows Hello for Business on-premise authentication configurations: ...

2026-07-17 10:12:26 AM 8045 Success Windows Hello processing completed successfully....

2026-07-17 10:12:26 AM 8510 Success Windows Hello key registration completed successfully.

2026-07-17 10:12:25 AM 3510 Information Windows Hello key registration started.

2026-07-17 10:12:25 AM 8225 Success Windows Hello key creation completed successfully....

2026-07-17 10:12:25 AM 8067 Success Windows Hello set a certificate property on a Windows Hello key....

2026-07-17 10:12:24 AM 5225 Information Creating a hardware Windows Hello key with result 0x0.

2026-07-17 10:12:24 AM 8632 Success Windows Hello for Business successfully added a user entry to the Usern...

2026-07-17 10:12:24 AM 5205 Information Windows Hello for Business on-premise authentication configurations: ...

2026-07-17 10:12:24 AM 5205 Information Windows Hello for Business on-premise authentication configurations: ...

2026-07-17 10:12:24 AM 3225 Information Windows Hello key creation started.

2026-07-17 10:12:24 AM 8055 Success Windows Hello container provisioning completed successfully....

2026-07-17 10:12:24 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0...

2026-07-17 10:12:24 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0...

2026-07-17 10:12:24 AM 5225 Information Creating a software Windows Hello key with result 0x0.

2026-07-17 10:12:24 AM 5225 Information Creating a software Windows Hello key with result 0x0.

2026-07-17 10:12:24 AM 5555 Information Windows Hello is validating that the device can satisfy all applicable ...

2026-07-17 10:12:24 AM 5702 Information Windows Hello wrote following protector properties to disk: HResult = 0...

2026-07-17 10:12:17 AM 5004 Information Windows Hello for Business Enabled Policy successfully enforced for the...

2026-07-17 10:12:17 AM 3055 Information Windows Hello container provisioning started.

2026-07-17 10:12:17 AM 6611 Warning Windows Hello could not delete the container as no container currently ...

```


The log showed that Windows Hello had successfully completed the earlier stages, including key creation and key registration.

I then queried Events 7001 and 5205 directly:

```pwsh

Get-WinEvent -FilterHashtable @{

    LogName = "Microsoft-Windows-HelloForBusiness/Operational"

    Id      = 7001

} -MaxEvents 3 |

Format-List TimeCreated, Id, LevelDisplayName, Message

```

```pwsh

Get-WinEvent -FilterHashtable @{

    LogName = "Microsoft-Windows-HelloForBusiness/Operational"

    Id      = 5205

} -MaxEvents 5 |

Format-List TimeCreated, Id, Message

```

Event 7001 showed:

```text

TimeCreated : 2026-07-17 10:17:47 AM

Id : 7001

LevelDisplayName : Error

Message : A user failed to sign into the device with the following information:

Username: SYSTEM

User SID: S-1-5-18

Credential Type: Software Key

Deployment Type: Key Trust

Software Lockout Counter: 0

Authentication Error Status: 0xC000006D

Authentication Error Substatus: 0xC0000380

```

The error codes did not identify the exact configuration problem, but they confirmed two important facts:

- The active deployment type was **Key Trust**;

- The failure occurred during **authentication**, not provisioning.

The next step was to inspect the Key Trust authentication chain itself.

---

## Confirming That the Windows Hello Public Key Was Written to Active Directory

The basic Key Trust workflow is:

1. The client generates a public/private key pair;

2. The private key remains on the client and is unlocked by the PIN;

3. The public key is written to the user's Active Directory object;

4. During sign-in, the domain controller uses that public key to verify the client's signature.

I therefore checked the user's `msDS-KeyCredentialLink` attribute:

```pwsh

Get-ADUser test.user `

    -Properties msDS-KeyCredentialLink |

    Select-Object -ExpandProperty msDS-KeyCredentialLink

```

The output contained multiple Key Credential entries.

The complete values were very long and followed a structure similar to:

```text

B:828:00020000200001...

B:828:00020000200001...

```

This was an important result.

It proved that:

- The Windows Hello key had been generated successfully;

- The public key had been written to Active Directory;

- Key registration had completed;

- Entra Connect and the AD user object were not the current blocking point.

At this stage, the client had completed almost everything expected of it.

The investigation began to point toward the domain controllers.

---

## Why Does Key Trust Depend on a Domain Controller Certificate?

Key Trust does not require each user to receive a sign-in certificate, but that does not mean the environment can operate without PKI.

In a hybrid Key Trust deployment, the KDC on the domain controller still requires a suitable Kerberos certificate to complete the initial public-key-based authentication.

In other words:

> The user does not need a certificate, but the KDC does.

I then examined the KDC Operational log on the domain controllers:

```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `

    -MaxEvents 50 |

    Select-Object TimeCreated, Id, LevelDisplayName, Message |

    Format-List

```

The log contained Event 200 with the following key message:

```text

The Key Distribution Center (KDC) cannot find a suitable certificate

to use for smart card logons, or the KDC certificate could not be verified.

```


This was the first piece of evidence that pointed directly toward the root cause.

The client had a key, and Active Directory contained the public key, but the KDC did not have a suitable certificate and therefore could not complete the Kerberos public-key authentication required by Key Trust.

---
## Checking the Domain Controller Certificates


I checked the Local Computer certificate store on both domain controllers:


```pwsh

certutil -store My

```

The results were not good.

One domain controller had no certificate that the KDC could use.

The other had only an old self-signed certificate. It was not a valid `Kerberos Authentication` certificate issued by a currently trusted Enterprise CA.

I also could not find a valid certificate with:

```text

Template: Kerberos Authentication

```

At this point, the failure chain was becoming clear:

```text

Windows Hello provisioning

        ↓ Successful

  

Public key written to msDS-KeyCredentialLink

        ↓ Successful

  

Client attempts Key Trust PIN sign-in

        ↓

  

The KDC on the domain controller has no suitable Kerberos certificate

        ↓

  

Authentication fails

```

---

## Discovering a Retired Enterprise CA


Further PKI investigation showed that Active Directory still contained objects for old Enterprise CAs.  

For example:

```text

CONTOSO-DC02-CA

contoso.local

```

However, the corresponding CA servers had already been retired.

Active Directory still contained the published PKI information, but there was no functioning Enterprise CA capable of:

- Issuing new domain controller certificates;

- Processing certificate auto-enrollment;

- Renewing or replacing the certificates required by the KDC  

This explained why the domain controllers had never received a valid `Kerberos Authentication` certificate.

The issue was no longer just one expired certificate. The Enterprise PKI itself was effectively no longer operational.

---

## Redeploying the Enterprise CA


Because the old CA no longer existed and there was no server available to recover, I deployed a new Enterprise Root CA.

```pwsh

Install-WindowsFeature ADCS-Cert-Authority -IncludeManagementTools

```

The new CA was configured with:

```pwsh

Install-AdcsCertificationAuthority `

    -CAType EnterpriseRootCA `

    -CACommonName "CONTOSO-ROOT-CA" `

    -CryptoProviderName "RSA#Microsoft Software Key Storage Provider" `

    -KeyLength 4096 `

    -HashAlgorithmName SHA256 `

    -ValidityPeriod Years `

    -ValidityPeriodUnits 10 `

    -Force

```

After AD CS was installed, I verified that the CA could be discovered from the domain:


```pwsh

certutil -config - -ping

```


The command returned:


```text

DC01.contoso.local\CONTOSO-ROOT-CA

```


This confirmed that the new Enterprise CA was available.


---

## Triggering Domain Controller Certificate Enrollment


After the Enterprise CA was operational, I refreshed Group Policy and triggered certificate auto-enrollment:


```pwsh

gpupdate /force

certutil -pulse

```

I then checked the Local Computer certificate store on both domain controllers again:


```pwsh

certutil -store My

```

This time, both domain controllers had successfully obtained new certificates, including:


```text

Kerberos Authentication

Domain Controller Authentication

Directory Email Replication

```

The issuer was:

```text

CONTOSO-ROOT-CA

```


I also confirmed that the new CA certificate had been published to the Enterprise NTAuth store:


```pwsh

certutil -enterprise -verifystore NTAuth

```


The output contained:


```text

CONTOSO-ROOT-CA

```


This step matters because a domain controller authentication certificate must chain to a CA that is trusted through NTAuth before it can be used for domain authentication.

---

## Confirming That the KDC Loaded the New Certificate

After certificate enrollment completed, I checked the KDC Operational log again:

```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `

    -MaxEvents 50 |

    Where-Object Id -in 200, 302 |

    Select-Object TimeCreated, Id, Message |

    Format-List

```

Previously, Event 200 had reported:


```text

No suitable certificate

```

Now Event 302 appeared and showed that the KDC had selected the new certificate:


```text

Issuer    : CONTOSO-ROOT-CA

Template  : Kerberos Authentication

Thumbprint: <REDACTED>

```

This confirmed that the PKI and KDC portions of the authentication chain had been repaired.

At this point, all major Key Trust requirements were satisfied:

- Windows Hello provisioning had completed;

- The public key had been written to Active Directory;

- The client was using Key Trust;

- The domain controllers had received Kerberos Authentication certificates;

- The KDC had loaded and was using the certificate.


---

## Root Cause


The incident was caused by several overlapping problems:

1. Cloud Trust had been enabled in Intune even though the environment was not ready for it, preventing Windows Hello from provisioning initially;

2. After Cloud Trust was disabled, Windows Hello successfully created and registered Key Trust credentials;

3. The old Enterprise CA had been retired, but related AD objects still remained;

4. The domain controllers did not have valid `Kerberos Authentication` certificates;

5. The KDC therefore could not complete Key Trust authentication;

6. After the Enterprise CA was rebuilt and new domain controller certificates were issued, the KDC began functioning normally again;

7. The client still retained authentication state from before the repair, and a reboot was required before the corrected state was fully loaded

# Troubleshooting Toolbox

The following commands were used during this Windows Hello for Business Key Trust investigation.

The names in the examples have been anonymized:

```text

Domain: contoso.local

User: test.user

Client: CLIENT-01

Domain controllers: DC01 / DC02

Enterprise CA: CONTOSO-ROOT-CA

```

---

## 1. Check Device Join and Windows Hello Status


```pwsh

dsregcmd /status

```

  

Review these fields:

  

```text

AzureAdJoined

DomainJoined

DeviceAuthStatus

NgcSet

AzureAdPrt

CloudTgt

OnPremTgt

```

  

Windows Hello provisioning status appears under:

  

```text

+----------------------------------------------------------------------+

| Ngc Prerequisite Check                                               |

+----------------------------------------------------------------------+

  

            IsDeviceJoined

             IsUserAzureAD

             PolicyEnabled

          PostLogonEnabled

            DeviceEligible

        SessionIsNotRemote

            CertEnrollment

          AdfsRefreshToken

             AdfsRaIsReady

    LogonCertTemplateReady

              PreReqResult

```

  

Common results:

  

```text

NgcSet       : NO

PreReqResult : WillNotProvision

```

  

This indicates that Windows Hello provisioning has not completed.

  

```text

NgcSet       : YES

PreReqResult : WillProvision

```

  

This indicates that the device meets the provisioning requirements or that Windows Hello has already been initialized.

  

For more detailed device registration information:

  

```pwsh

dsregcmd /status /debug

```

  

---

  

## 2. Check Windows Hello Policy Registry Values

  

Check whether Windows Hello is configured to use Cloud Trust:

  

```pwsh

Get-ItemProperty `

    -Path "HKLM:\SOFTWARE\Policies\Microsoft\PassportForWork" `

    -ErrorAction SilentlyContinue

```

  

Review:

  

```text

Enabled

UseCertificateForOnPremAuth

UseCloudTrustForOnPremAuth

```

  

The values can also be queried individually:

  

```pwsh

Get-ItemPropertyValue `

    -Path "HKLM:\SOFTWARE\Policies\Microsoft\PassportForWork" `

    -Name "UseCloudTrustForOnPremAuth" `

    -ErrorAction SilentlyContinue

```

  

```pwsh

Get-ItemPropertyValue `

    -Path "HKLM:\SOFTWARE\Policies\Microsoft\PassportForWork" `

    -Name "UseCertificateForOnPremAuth" `

    -ErrorAction SilentlyContinue

```

  

The final state in this case was:

  

```text

UseCloudTrustForOnPremAuth   : 0

UseCertificateForOnPremAuth : 0

```

  

This means:

  

- Cloud Trust is not being used;

- Certificate Trust is not being used;

- The intended deployment model is Key Trust.

  

After changing the Intune policy, force a policy refresh:

  

```pwsh

gpupdate /force

```

  

---

  

## 3. Query the Windows Hello Operational Log

  

List recent Windows Hello events:

  

```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-HelloForBusiness/Operational" `

    -MaxEvents 100 |

    Select-Object TimeCreated, Id, LevelDisplayName, Message |

    Format-List

```

  

Show only warning and error events:

  

```pwsh

Get-WinEvent `

    -FilterHashtable @{

        LogName = "Microsoft-Windows-HelloForBusiness/Operational"

        Level   = 2, 3

    } `

    -ErrorAction SilentlyContinue |

    Select-Object TimeCreated, Id, LevelDisplayName, Message |

    Format-List

```

  

Query authentication failures:

  

```pwsh

Get-WinEvent `

    -FilterHashtable @{

        LogName = "Microsoft-Windows-HelloForBusiness/Operational"

        Id      = 7001

    } `

    -ErrorAction SilentlyContinue |

    Select-Object TimeCreated, Id, Message |

    Format-List

```

  

Important values observed during the incident included:

  

```text

Deployment Type          : Key Trust

Authentication Error     : 0xC000006D

Authentication SubStatus : 0xC00002F9

```

  

A later test also produced:

  

```text

Authentication Error : 0xC0000380

```

  

Query the event that confirms the deployment configuration:

  

```pwsh

Get-WinEvent `

    -FilterHashtable @{

        LogName = "Microsoft-Windows-HelloForBusiness/Operational"

        Id      = 5205

    } `

    -ErrorAction SilentlyContinue |

    Select-Object TimeCreated, Id, Message |

    Format-List

```

  

Important values:

  

```text

Certificate Required : False

Use Cloud Trust      : False

Deployment Type      : Key Trust

```

  

Filter by relevant keywords:

  

```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-HelloForBusiness/Operational" `

    -MaxEvents 200 |

    Where-Object {

        $_.Message -match "Authentication|Key Trust|Cloud Trust|Provision"

    } |

    Select-Object TimeCreated, Id, Message |

    Format-List

```

  

---

  

## 4. Check Whether the Windows Hello Key Was Written to Active Directory

  

Import the Active Directory module:

  

```pwsh

Import-Module ActiveDirectory

```

  

Inspect the user's `msDS-KeyCredentialLink` attribute:

  

```pwsh

Get-ADUser test.user `

    -Properties msDS-KeyCredentialLink |

    Select-Object SamAccountName, msDS-KeyCredentialLink

```

  

Show only the Key Credential values:

  

```pwsh

Get-ADUser test.user `

    -Properties msDS-KeyCredentialLink |

    Select-Object -ExpandProperty msDS-KeyCredentialLink

```

  

Count the number of Key Credential entries:

  

```pwsh

(

    Get-ADUser test.user `

        -Properties msDS-KeyCredentialLink

).msDS-KeyCredentialLink.Count

```

  

The output usually resembles:

  

```text

B:828:00020000200001...

```

  

The values are long and normally do not need to be parsed manually.

  

If the attribute is not empty, the Windows Hello public key has been written to the user's AD object.

  

---

  

## 5. Check Domain and Forest Functional Levels

  

Check the forest functional level:

  

```pwsh

Get-ADForest |

    Select-Object Name, ForestMode

```

  

Check the domain functional level:

  

```pwsh

Get-ADDomain |

    Select-Object DNSRoot, DomainMode

```

  

The environment in this case reported:

  

```text

Forest Functional Level : Windows2008R2Forest

Domain Functional Level : Windows2012R2Domain

```

  

---

  

## 6. Check Local Certificates on the Domain Controllers

  

View the Local Computer personal certificate store:

  

```pwsh

certutil -store My

```

  

Filter for Kerberos-related information:

  

```pwsh

certutil -store My |

    Select-String `

        -Pattern "Kerberos Authentication|Domain Controller Authentication|Issuer|Subject|Template"

```

  

Inspect certificates with PowerShell:

  

```pwsh

Get-ChildItem Cert:\LocalMachine\My |

    Select-Object Subject, Issuer, Thumbprint, NotBefore, NotAfter,

        EnhancedKeyUsageList

```

  

Find certificates with the Kerberos Authentication EKU:

  

```pwsh

Get-ChildItem Cert:\LocalMachine\My |

    Where-Object {

        $_.EnhancedKeyUsageList.FriendlyName -contains "Kerberos Authentication"

    } |

    Select-Object Subject, Issuer, Thumbprint, NotBefore, NotAfter,

        EnhancedKeyUsageList

```

  

Find certificates that expire within 60 days:

  

```pwsh

Get-ChildItem Cert:\LocalMachine\My |

    Where-Object {

        $_.NotAfter -lt (Get-Date).AddDays(60)

    } |

    Select-Object Subject, Issuer, Thumbprint, NotAfter

```

  

---

  

## 7. Query the KDC Operational Log

  

List recent KDC events:

  

```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `

    -MaxEvents 100 |

    Select-Object TimeCreated, Id, LevelDisplayName, Message |

    Format-List

```

  

Show only Events 200 and 302:

  

```pwsh

Get-WinEvent `

    -FilterHashtable @{

        LogName = "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational"

        Id      = 200, 302

    } `

    -ErrorAction SilentlyContinue |

    Select-Object TimeCreated, Id, LevelDisplayName, Message |

    Format-List

```

  

Event 200 indicates that the KDC cannot find a suitable certificate. A typical message is:

  

```text

The Key Distribution Center cannot find a suitable certificate

to use for smart card logons, or the KDC certificate could not

be verified.

```

  

Event 302 indicates that the KDC has successfully loaded a certificate. Important fields include:

  

```text

Issuer

Template

Thumbprint

```

  

Filter certificate-related KDC events:

  

```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-Kerberos-Key-Distribution-Center/Operational" `

    -MaxEvents 200 |

    Where-Object {

        $_.Message -match "certificate|Kerberos Authentication|KDC"

    } |

    Select-Object TimeCreated, Id, Message |

    Format-List

```

  

---

  

## 8. Check Whether the Enterprise CA Is Available

  

List Enterprise CAs available in the domain:

  

```pwsh

certutil -config - -ping

```

  

A working result should resemble:

  

```text

DC01.contoso.local\CONTOSO-ROOT-CA

```

  

View Enterprise CA configuration:

  

```pwsh

certutil -config - -

```

  

Check the CA service:

  

```pwsh

Get-Service CertSvc

```

  

Start the CA service:

  

```pwsh

Start-Service CertSvc

```

  

Restart the CA service:

  

```pwsh

Restart-Service CertSvc

```

  

Check the AD CS role:

  

```pwsh

Get-WindowsFeature AD-Certificate

```

  

List installed AD CS role services:

  

```pwsh

Get-WindowsFeature |

    Where-Object {

        $_.Name -like "ADCS*"

    }

```

  

---

  

## 9. Check the Enterprise NTAuth Store

  

Verify the Enterprise NTAuth store:

  

```pwsh

certutil -enterprise -verifystore NTAuth

```

  

Confirm that the new CA appears in the output:

  

```text

CONTOSO-ROOT-CA

```

  

View all certificates published to NTAuth:

  

```pwsh

certutil -enterprise -viewstore NTAuth

```

  

The NTAuthCertificates object can also be read directly from Active Directory:

  

```pwsh

$configurationNamingContext = (

    Get-ADRootDSE

).configurationNamingContext

  

Get-ADObject `

    -Identity "CN=NTAuthCertificates,CN=Public Key Services,CN=Services,$configurationNamingContext" `

    -Properties cACertificate

```

  

---

  

## 10. Check for Old CA Objects Published in Active Directory

  

Get the Configuration Naming Context:

  

```pwsh

$configurationNamingContext = (

    Get-ADRootDSE

).configurationNamingContext

```

  

List Enterprise CAs registered under Enrollment Services:

  

```pwsh

Get-ADObject `

    -SearchBase "CN=Enrollment Services,CN=Public Key Services,CN=Services,$configurationNamingContext" `

    -LDAPFilter "(objectClass=pKIEnrollmentService)" `

    -Properties * |

    Select-Object Name, dNSHostName, DistinguishedName

```

  

Inspect the Certification Authorities container:

  

```pwsh

Get-ADObject `

    -SearchBase "CN=Certification Authorities,CN=Public Key Services,CN=Services,$configurationNamingContext" `

    -LDAPFilter "(objectClass=certificationAuthority)" `

    -Properties * |

    Select-Object Name, DistinguishedName

```

  

Inspect the AIA container:

  

```pwsh

Get-ADObject `

    -SearchBase "CN=AIA,CN=Public Key Services,CN=Services,$configurationNamingContext" `

    -LDAPFilter "(objectClass=certificationAuthority)" `

    -Properties * |

    Select-Object Name, DistinguishedName

```

  

Inspect the CDP container:

  

```pwsh

Get-ADObject `

    -SearchBase "CN=CDP,CN=Public Key Services,CN=Services,$configurationNamingContext" `

    -Filter * |

    Select-Object Name, ObjectClass, DistinguishedName

```

  

These commands help identify objects for retired CAs that may still remain in Active Directory.

  

Do not delete these objects without a backup and an impact assessment.

  

---

  

## 11. Trigger Certificate Auto-Enrollment

  

Refresh computer Group Policy:

  

```pwsh

gpupdate /force

```

  

Trigger certificate auto-enrollment:

  

```pwsh

certutil -pulse

```

  

Check certificate auto-enrollment events:

  

```pwsh

Get-WinEvent `

    -LogName "Microsoft-Windows-CertificateServicesClient-AutoEnrollment/Operational" `

    -MaxEvents 100 |

    Select-Object TimeCreated, Id, LevelDisplayName, Message |

    Format-List

```

  

Show only warning and error events:

  

```pwsh

Get-WinEvent `

    -FilterHashtable @{

        LogName = "Microsoft-Windows-CertificateServicesClient-AutoEnrollment/Operational"

        Level   = 2, 3

    } `

    -ErrorAction SilentlyContinue |

    Select-Object TimeCreated, Id, Message |

    Format-List

```

  

After auto-enrollment completes, check the certificate store again:

  

```pwsh

certutil -store My

```

  

The domain controller should now have certificates such as:

  

```text

Kerberos Authentication

Domain Controller Authentication

Directory Email Replication

```

  

---

  

## Quick Diagnostic Order

  

For similar incidents, use the following sequence:

  

```text

1. Run dsregcmd /status

2. Check NgcSet and PreReqResult

3. Review the Intune Windows Hello policies

4. Query the HelloForBusiness Operational log

5. Check msDS-KeyCredentialLink

6. Query the KDC Operational log

7. Check the domain controller's Kerberos Authentication certificate

8. Check the Enterprise CA and NTAuth

9. Trigger domain controller certificate auto-enrollment

10. Confirm KDC Event 302

11. Reboot the client and test PIN sign-in again

```

  

The purpose of this sequence is not to run every command blindly. The first objective is to determine whether the failure occurs during:

  

```text

Provisioning

        or

Authentication

```

  

Once the failed stage is identified, the investigation can be narrowed accordingly.
