# Setting up a phone, tablet or laptop

Once per device, before the first clinic morning. Takes two minutes.

The EMR uses an encrypted (HTTPS) connection made by the hub itself, since there's no internet to get a public certificate from. Each device has to be told once to trust the hub's certificate. Without this step the browser shows a security warning on every page; **never tap through that warning**. If it appears on a device that was already set up, someone may be imitating the hub: tell an admin.

## 1. Join the network

Connect to the clinic's Wi-Fi (the travel router, or the hub laptop's hotspot). Ask the trip lead for its name and password.

## 2. Open the setup page

Scan the QR code in the hub's window, or type the address it shows, followed by `/setup`, for example `https://emr-hub.local/setup` or `https://192.168.8.20/setup`. The browser warns this first time only; this is the one time it's expected. Continue to the page.

Check the **SHA-256 fingerprint** shown on the page matches the one in the hub's window (comparing the first and last few pairs is enough), then tap **Download the certificate**.

## 3. Install it

### iPhone and iPad
1. Tap **Download**, then **Allow**.
2. Settings → **Profile Downloaded** → **Install** (enter the passcode) → **Install**.
3. Settings → General → About → **Certificate Trust Settings** → switch on **HF EMR Local Authority**.

### Android
1. Tap **Download**.
2. Settings → Security (or Security & privacy) → Encryption & credentials → **Install a certificate** → **CA certificate** → Install anyway → pick `hf-emr-root.crt`.
3. Menu names vary by phone; search Settings for "certificate".

Some Android phones insist on a screen lock before installing a certificate. That's fine (and good for a phone holding patient data).

### Windows
Open the downloaded file → **Install Certificate** → Current User → **Place all certificates in the following store** → Browse → **Trusted Root Certification Authorities** → Finish → Yes.

### Mac
Open the downloaded file; it opens Keychain Access. Double-click **HF EMR Local Authority** → Trust → **When using this certificate: Always Trust**.

## 4. Check

Open the EMR address again. There should be no warning and a padlock in the address bar. Tap **Done: go to sign in**.

If `emr-hub.local` doesn't load on an Android phone, use the number address (`https://192.168.…`) instead; some Android versions don't look up `.local` names.

## After the trip

You may remove the certificate: iPhone: Settings → General → VPN & Device Management → the profile → Remove. Android: Settings → Encryption & credentials → User credentials. Windows: `certmgr.msc` → Trusted Root → HF EMR Local Authority → Delete. Mac: Keychain Access → delete it.

The certificate can only vouch for local network names and addresses, never for internet websites, so leaving it installed can't be used to fake your bank or email.
