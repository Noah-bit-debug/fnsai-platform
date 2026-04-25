# SentrixAI Time Tracker — Browser Extension

Privacy-safe, real-time work time tracking for the SentrixAI platform.
Works in **Chrome** and **Microsoft Edge** from the same codebase.

---

## 1. Load in Chrome (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` folder (the folder containing `manifest.json`)
5. The SentrixAI icon will appear in your browser toolbar

To update after code changes: click the **↺ refresh** icon on the extension card.

---

## 2. Load in Microsoft Edge (Developer Mode)

Edge uses the same Chromium engine and supports Chrome extensions natively.
**You load from the same `extension/` folder** — no separate build needed.

1. Open Edge and navigate to `edge://extensions`
2. Enable **Developer mode** (toggle in the bottom-left sidebar)
3. Click **Load unpacked**
4. Select the `extension/` folder

> If you want Edge to show a different name in its extension manager,
> rename `manifest-edge.json` to `manifest.json` before loading.
> The code is identical — only the `"name"` field differs.

---

## 3. Sign in with Microsoft

The extension authenticates against the same Azure Entra ID tenant that the
SentrixAI web app uses. Tokens are obtained via the OAuth 2.0 Authorization
Code + PKCE flow run inside `chrome.identity.launchWebAuthFlow` — the same
shape as the SPA's MSAL flow, just with the extension's chromiumapp.org URL
as the redirect.

### One-time Azure App Registration step

Before users can sign in, an admin must add the extension's redirect URI
to the App Registration in the Azure portal:

1. Load the extension in Chrome/Edge (steps 1–2 above) so it has an ID.
2. Open the extension's Settings page. Under **Authentication** you'll see
   the **Redirect URI** displayed — it looks like
   `https://abcdefghijklmnopqrstuvwxyz123456.chromiumapp.org/`.
3. In the Azure portal: **Microsoft Entra ID → App registrations →** your
   SPA app **→ Authentication → Add a platform → Single-page application**.
4. Paste the redirect URI from step 2 and **Save**. Repeat for each browser
   profile / installation that needs to sign in (extension IDs differ per
   install of an unpacked extension).

### Per-user sign-in

In the extension's **Settings → Authentication** section:

| Field | Description |
|---|---|
| API Base URL | Leave blank to use the default Railway backend. |
| Azure Tenant ID | Your tenant's directory ID (GUID). |
| Azure Client ID | The SPA App Registration's Application (client) ID. |

Click **Sign in with Microsoft**. A Microsoft login window opens; after
selecting an account you'll see your email next to the button.

The extension stores `id_token` + `refresh_token` in `chrome.storage.local`
and automatically refreshes the id_token before expiry. Click **Sign out**
to clear stored tokens.

Click **Test Connection** to verify the API URL + your current sign-in.

---

## 4. Configure Tracking Settings

After installing, the Settings page opens automatically on first install.
You can reopen it at any time by clicking **⚙ Settings** in the popup.

### Tracking Mode
- **Browser Profile** — counts time whenever you have an active browser session. Best for flexible/remote work.
- **Scheduled Hours** — only counts time within the start/end window you set. Best for shift workers.

### Idle Settings
- **Idle Threshold** — how long (1–30 min) the mouse/keyboard must be inactive before the extension marks you as idle.
- **Auto-deduct idle time** — when enabled, idle periods are automatically subtracted from active time.
- **Notify when idle** — shows a desktop notification asking "Were you working?" when idle is detected.

### Domain Rules
- **Approved Work Domains** — time spent on these sites counts as active work. Supports `*.example.com` wildcards.
- **Excluded Domains** — time on these sites is never counted, even if they match an approved pattern.

### Privacy
- **Allow page title tracking** — off by default. Enable to include page titles (e.g. "Q4 Report — Google Sheets") in reports.
- **Show domain in reports** — include the visited hostname in your time entries.

---

## 5. Using the Popup

Click the SentrixAI icon in your toolbar to open the popup.

| Button | Action |
|---|---|
| **▶ Start Session** | Begin a tracked work session |
| **⏹ End Session** | Stop tracking and sync final data |
| **☕ Break** | Pause tracking for a break |
| **▶ Resume** | End the break and resume tracking |
| **Yes, I was working** | Dismiss idle warning and credit time as active |
| **No, deduct it** | Confirm idle time should be subtracted |
| **⚙ Settings** | Open the full settings page |
| **📊 View Reports** | Open the SentrixAI time tracking dashboard |

The large timer shows your **active work seconds** for the current session.
Progress bars beneath it show the split between active, idle, and break time.

---

## 6. Privacy Notes

The extension is designed to be the least invasive tracker possible:

- **Never reads** page content, form values, input text, passwords, or clipboard data
- **Never reads** your browsing history beyond the currently active tab's hostname
- **Strips query strings and URL hashes** before reporting — only `origin + pathname` is sent
- Page titles are **off by default** and only sent if you explicitly enable the setting
- All data is sent only to the SentrixAI backend you configure (default: your Railway instance)
- The offline queue stores failed requests locally in `chrome.storage.local` and retries on reconnect — no third-party analytics or telemetry

---

## 7. Offline Support

If your internet connection drops, the extension:
1. Queues all failed API calls in local storage
2. Continues counting time locally using `chrome.alarms`
3. Automatically replays the queue every 60 seconds once connectivity is restored

You will not lose tracked time due to temporary network outages.

---

## 8. File Structure

```
extension/
├── manifest.json              # Chrome manifest (MV3)
├── manifest-edge.json         # Edge manifest (identical, different name)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── shared/
│   ├── constants.js           # Shared constants & defaults
│   └── api-client.js          # API wrapper + offline queue
├── background/
│   └── service-worker.js      # MV3 service worker (all tracking logic)
├── content/
│   └── content.js             # Lightweight content script (domain/title reporting)
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── options/
    ├── options.html
    ├── options.css
    └── options.js
```

---

## 9. Icons

The `icons/` folder requires three PNG files:

| File | Size | Usage |
|---|---|---|
| `icon16.png` | 16×16 px | Browser toolbar (small) |
| `icon48.png` | 48×48 px | Extension management page |
| `icon128.png` | 128×128 px | Chrome Web Store listing |

Generate them from the SentrixAI logo using any image editor or a tool like
[Squoosh](https://squoosh.app) / [favicon.io](https://favicon.io).

---

## 10. Development Tips

- After editing any file, go to `chrome://extensions` and click the **↺** refresh button on the SentrixAI card
- To inspect the **service worker**, click the "service worker" link on the extension card in `chrome://extensions`
- To inspect the **popup**, right-click the toolbar icon → Inspect
- Use `chrome.storage.local` (DevTools → Application → Storage → Extension Storage) to inspect live state
- The background service worker logs to its own DevTools console — open it from the extension card
