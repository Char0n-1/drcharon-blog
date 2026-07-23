---
title: "Intune Android COPE Staging in Practice: Fixing Enrollment Rollback After Powering Off at Microsoft Sign-In"
published: 2026-07-23
description: "An Intune Android COPE staging case study: why the process worked on Sonim devices but failed on Samsung, and how Via Staging solved the deployment issue."
tags:
  - Intune
  - Android-Enterprise
  - COPE
  - Astro
category: Microsoft 365
draft: false
lang: en
---

While preparing a batch of company-owned Android phones, I wanted IT to complete the initial device setup before handing each phone to the final user to sign in with their Microsoft account.

The devices are managed through Microsoft Intune using Android Enterprise COPE:

> **Corporate-owned devices with work profile**

Our original process had always worked on Sonim XP Pro devices, so I assumed it was a valid deployment method.

That changed when we started preparing Samsung S26 devices.

---

# Environment

The environment used in this case included:

- Microsoft Intune
- Android Enterprise COPE
- QR code enrollment
- Sonim XP Pro
- Samsung S26
- Managed Google Play

---

# The Original Device Handoff Process

Our original process was:

```text
Factory Reset
        ↓
Scan the Intune enrollment QR code
        ↓
Complete the initial Android setup
        ↓
Reach the Microsoft sign-in page
        ↓
Power off the device
        ↓
Hand the device to the user
        ↓
The user powers it on and signs in
```

This process worked on the Sonim XP Pro.

We could power off the device while it was waiting at the Microsoft sign-in page. After restarting, it returned to the same page, allowing the user to continue the enrollment process.

Because of this, I assumed Samsung devices would behave the same way.

---

# The Problem on Samsung

On the Samsung S26, I used the same enrollment profile and followed the same steps.

After reaching the Microsoft sign-in page, I powered off the device. When it was turned on again, it displayed:

```
Something went wrong.

Contact your IT administrator.
```

The previous enrollment state was then rolled back, and the device could no longer continue from the Microsoft sign-in page.

The process worked on Sonim but failed on Samsung.

Microsoft states that restarting an Android Enterprise fully managed or corporate-owned work profile device before enrollment is complete can prevent it from enrolling correctly in Intune. In some cases, the device might appear to be enrolled even though it is not protected by Intune policies.

The fact that Sonim restored the enrollment screen was only a device-specific Setup Wizard behavior. It was not a reliable or supported handoff process. Samsung returning to the pre-enrollment state was the result of interrupting enrollment before it had finished.

[Microsoft Learn](https://learn.microsoft.com/en-us/intune/device-enrollment/android/ref-corporate-methods?utm_source=chatgpt.com)

---

# The Microsoft Sign-In Page Is Not a Safe Handoff Point

With a standard COPE enrollment token, the Microsoft sign-in page is still part of the active enrollment process.

At this point:

- Enrollment has not completed.
- The device has not been associated with the final user.
- The Intune enrollment workflow is still in progress.
- The Android Setup Wizard has not formally finished.

The Sonim device was able to continue because it preserved the intermediate enrollment state.

The Samsung device detected that enrollment had been interrupted, rolled back the process, and required enrollment to start again.

The actual problem was not that Samsung behaved incorrectly.

The problem was that our handoff process depended on an unfinished enrollment state.

---

# The Correct Solution: Via Staging

Intune provides a dedicated enrollment method for scenarios where IT prepares the device first and the final user signs in later:

> **Corporate-owned with work profile, via staging**

A standard COPE token follows a process similar to this:

```
IT scans the QR code
        ↓
The device reaches Microsoft sign-in
        ↓
The user continues and completes enrollment
```

Via Staging changes the process:

```
IT scans the staging QR code
        ↓
Complete the Android Setup Wizard
        ↓
Reach the Android home screen
        ↓
Required apps begin installing
        ↓
Power off and hand the device to the user
        ↓
The user opens Microsoft Intune
        ↓
The user signs in with their Microsoft account
```

The key difference is:

> **Via Staging allows IT to complete the device setup and reach the Android home screen without using the final user's account.**

Once the device reaches the home screen, the staging portion of enrollment is complete. The device can then be powered off and handed to the user without stopping at the Microsoft sign-in page.

## Creating a Staging Token

In the Intune admin center, go to:

**Devices → Enrollment → Android → Android Enterprise → Enrollment profiles → Corporate-owned devices with work profile**

Then:

1. Select **Create profile**.
2. Under **Token type**, select:

    **Corporate-owned with work profile, via staging**
    Do not select the standard option
    
3. Configure the token expiration date.
4. Create the profile.
5. Open the new profile, go to **Token**, and use the newly generated QR code.

[Microsoft Learn](https://learn.microsoft.com/en-us/intune/device-enrollment/android/setup-corporate-work-profile?utm_source=chatgpt.com)

---

# The New Via Staging Process

I created a new COPE enrollment profile and set the token type to:

```
Corporate-owned with work profile, via staging
```

I then tested the Samsung S26 again.

The new process was:

```
1. Factory reset the device
2. Scan the Via Staging QR code
3. Connect to Wi-Fi
4. Complete the Android Setup Wizard
5. Reach the Android home screen
6. Wait for Intune and Managed Google Play to synchronize
7. Confirm that required apps are installed
8. Power off the device
9. Hand it to the user
```

When the user receives the device, they only need to:

```
1. Power on the device
2. Open the Microsoft Intune app
3. Sign in with their Microsoft work account
4. Complete user association
```

The device no longer needs to be powered off while enrollment is still waiting at the Microsoft sign-in page.

---

# Required Apps Can Be Installed Before User Sign-In

After a Via Staging device reaches the Android home screen, it is still userless, but it is already managed by Intune.

We assigned common Android applications as:

```
Required
→ All devices
```

After the device reached the home screen, the required Managed Google Play apps began installing automatically.

Examples included:

- Google Chrome
- Microsoft Outlook
- Microsoft Teams
- Microsoft OneDrive
- Microsoft Authenticator

This allows IT to confirm that the essential applications are installed before handing over the device.

Using `All devices` does not cause Windows devices to install Android applications.

The application object is a Managed Google Play Store app and applies only to Android. Windows devices cannot install that Android application.

---

# Via Staging and Static Security Groups

Via Staging does not support Enrollment Time Grouping.

This means that during enrollment, the device cannot automatically be added to a static device group in the same way as a device enrolled with a standard COPE token.

At first, I was concerned that this would affect our existing app assignments.

The final design was:

## Common Android Applications

Assign them as:

```
Required
→ All devices
```

These applications begin installing during the staging phase after the device reaches the home screen.

With **COPE Via Staging**, the device is still userless after IT completes the Setup Wizard, but it is already managed by Intune.

Required Managed Google Play applications that meet the Stage 2 targeting requirements can therefore begin installing before the final user signs in.

Microsoft also explains that applications and policies can be targeted during Stage 2, although the supported targeting methods are limited.

[Microsoft Learn](https://learn.microsoft.com/en-us/intune/device-enrollment/android/device-staging?utm_source=chatgpt.com)

## User- or Department-Specific Applications

These applications remain assigned to the existing user security groups.

After the user signs in through Microsoft Intune, Intune evaluates the user's group membership and deploys the appropriate applications.

The final assignment model is:

```
Common applications
→ All devices
→ Installed during staging

User-specific applications
→ User security groups
→ Installed after user sign-in
```

If an Android application should only apply to devices enrolled through a particular enrollment profile, an Assignment Filter can also be used to narrow the scope.

---

# Final Device Handoff Process

The updated standard process is:

```
IT factory resets the device
        ↓
Scan the Via Staging QR code
        ↓
Complete the Android Setup Wizard
        ↓
Reach the home screen
        ↓
Wait for required apps to install
        ↓
Verify the device
        ↓
Power it off and hand it to the user
        ↓
The user opens Microsoft Intune
        ↓
The user signs in with their Microsoft account
        ↓
Enrollment is completed
```

This process works for both Samsung and Sonim devices and no longer depends on how each manufacturer handles an interrupted enrollment state.

---

# Knowledge Base

## Default Token

The standard token process looks like this:

```
IT
│
├─ Scans the QR code
├─ Connects to Wi-Fi
├─ Completes the Google setup
├─ Reaches Microsoft sign-in
└──────────────► The user continues
```

The user must continue through the remaining Setup Wizard steps.

If the device is powered off before enrollment is complete, many manufacturers may restart or roll back the process.

Sonim happened to preserve the intermediate state, but that was manufacturer-specific behavior and not something guaranteed by Intune.

---

## Via Staging

Microsoft divides Via Staging into three stages:

```
Stage 1
IT
│
├─ Creates the staging token
└───────────────┐

Stage 2
IT or Vendor
│
├─ Scans the QR code
├─ Completes Android setup
├─ Reaches the home screen
├─ Allows apps to begin installing
└─ Powers off the device

↓

Stage 3
User
│
├─ Powers on the device
├─ Opens Microsoft Intune
├─ Signs in with Microsoft
└─ Completes user association
```

There is no final user account during Stage 1 or Stage 2.

The device remains in a **userless** state.

It becomes associated with the user only after:

```
Microsoft Intune app
        ↓
User signs in
        ↓
Device becomes user-affiliated
```