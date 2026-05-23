# Android tablet kiosk mode (BERT pilot)

BERT pilot tablets can run in **app-level kiosk mode** inside the Capacitor Android shell. This improves the tablet UX but is **not** a substitute for Android Enterprise / MDM device lockdown.

## What app-level kiosk does

- Immersive full-screen (hides status and navigation bars where the OS allows).
- Keeps the screen on while BERT is in the foreground.
- Consumes the hardware **Back** button so it navigates inside the WebView instead of closing the app.
- **Log out** still clears the session and returns to the BERT sign-in screen (does not send users to the Android launcher).
- Stores enable/disable on the device in `localStorage` (`bert-tablet-kiosk-enabled`). Default on native Android: **enabled**.
- Best-effort **`startLockTask()`** when the device or policy allows Lock Task Mode.

## What app-level kiosk cannot do

Without **Screen Pinning**, **Device Owner**, or **MDM kiosk policy**, users can still leave BERT via:

- Home
- Recents / app switcher
- Quick Settings
- Power menu
- Notifications (depending on device)

Do not claim the APK alone fully locks the tablet OS.

## Master / Godmode controls

1. Sign in as **Master**.
2. **Setup → Open Initial Setup** (Godmode).
3. Use the **Kiosk mode (Android tablet)** section:
   - **Enable tablet kiosk mode**
   - **Disable tablet kiosk mode** (confirmation required; Master session only — page is already Master-only)
   - **Show exit instructions**

## Screen Pinning (quick pilot)

On many Android tablets:

1. Open BERT and bring it to the foreground.
2. Open **Recents**.
3. Tap the BERT app icon → **Pin** (wording varies).
4. To unpin: usually **Back + Recents** together (see device help).

Screen Pinning is operator-managed per device; it is not configured from the APK.

## Android Enterprise / MDM (recommended for production pilots)

For reliable kiosk behaviour:

1. Enroll tablets in **Android Enterprise** (work profile or fully managed).
2. Apply a **kiosk / dedicated device** policy from your MDM (Intune, VMware, etc.).
3. Allowlist package **`co.usebert.app`** for Lock Task Mode.
4. Optionally set BERT as the **default launcher** policy on dedicated devices.

The app manifest sets `android:lockTaskMode="if_whitelisted"` on `MainActivity` so Lock Task can start when the device policy allowlists BERT.

## ADB / Device Owner (lab only)

Device Owner provisioning is required before `dpm set-lock-task-packages` is meaningful. Example flow (varies by Android version; test on a spare device):

```bash
# After Device Owner provisioning for your DPC / test harness:
adb shell dpm set-lock-task-packages <device-owner-component> co.usebert.app
```

Not intended for everyday operators.

## Building a pilot APK with kiosk

Use the standard pilot debug script (production API, no demo flags):

```bash
npm run android:apk:pilot:debug
```

See `docs/deployment-runbook.md` § Pilot APK / kiosk.
