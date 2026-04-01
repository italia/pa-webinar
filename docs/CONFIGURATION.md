# Configuration

## Branding

### Video watermark

The DTD watermark is displayed in the bottom-left corner of the Jitsi video area. To customise it:

- **Replace the static file**: swap `app/public/images/dtd-watermark.svg` with your own logo (SVG or PNG, ~120×40px recommended, white or light colour).
- **Use an environment variable**: set `NEXT_PUBLIC_WATERMARK_URL` to an absolute URL or public path. When set, this overrides the static file.

### Waiting room music

The waiting room plays ambient music when a participant clicks "Enable music".

- **Default audio**: place an MP3 file at `app/public/audio/waiting-room-default.mp3`. If no file exists, the music button is still shown but playback will silently fail.
- **Per-event override**: in the admin create/edit event form, set the "Waiting room audio URL" field to a direct URL to an MP3 file. This overrides the default for that specific event.

Requirements for audio files:
- Format: MP3, 128 kbps or lower
- Duration: 30–120 seconds (loops automatically)
- Style: calm ambient/lofi suitable for a professional event lobby
- License: must be royalty-free (CC0, CC-BY, or equivalent)

### Jitsi branding

The platform customizes Jitsi's appearance via several mechanisms:

#### Dynamic branding JSON

Edit `app/public/jitsi-branding.json` to set Jitsi's built-in branding:

```json
{
  "backgroundColor": "#002855",
  "backgroundImageUrl": "",
  "logoClickUrl": "",
  "logoImageUrl": "/images/dtd-watermark.svg",
  "inviteDomain": "eventi.dominio.gov.it"
}
```

The `dynamicBrandingUrl` in `lib/jitsi/config.ts` points to this file. In production (same-origin via Ingress), Jitsi can fetch it directly. In local dev with cross-origin Jitsi, the fetch may fail silently — this is expected.

#### Custom CSS injection (production only)

When Jitsi is served from the same domain via Ingress (e.g. `eventi.dominio.gov.it/jitsi/`), you can inject custom CSS to restyle the Jitsi toolbar and UI:

1. Create a CSS file at `app/public/jitsi-custom.css`
2. Add to `jitsiInterfaceConfigOverwrite` in `lib/jitsi/config.ts`:
   ```typescript
   CUSTOM_CSS_URL: '/jitsi-custom.css',
   ```

Example custom CSS for production:

```css
/* Match toolbar to DTD navy theme */
.new-toolbox {
  background: linear-gradient(180deg, transparent, rgba(0, 40, 85, 0.9)) !important;
}

/* Style toolbar buttons */
.toolbox-button {
  color: #fff !important;
}

/* Hide Jitsi logo in toolbar */
.oqPGd, .oqPGd > * {
  display: none !important;
}

/* Match filmstrip background */
.filmstrip {
  background: rgba(0, 20, 40, 0.6) !important;
}
```

> **Note**: Jitsi's internal CSS classes may change between versions. Test after every Jitsi upgrade. This approach only works when the CSS file is same-origin with the Jitsi iframe.

#### Visual flow

The live room follows a deliberate color flow from top to bottom:

| Element | Color | Class/Style |
|---|---|---|
| Top bar | `#0066CC` (Bootstrap Italia primary) | `.live-top-bar` |
| Moderator bar | `#1a1a2e` (dark navy) | `.moderator-bar` |
| Jitsi container | `#002855` → `#001428` gradient | `.jitsi-wrapper` |
| Sidebar header | `#0066CC` (matches top bar) | `.live-sidebar-header` |
| Sidebar body | `#ffffff` with blue left border | `.live-sidebar` |
| Page background | `#f0f4f8` → `#e8eef4` | `.live-page-bg` |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `APP_SECRET` | Yes | Secret for signing JWTs (admin sessions, Jitsi tokens) |
| `ADMIN_API_KEY` | Yes | Key for admin login |
| `NEXT_PUBLIC_APP_URL` | Yes | Public base URL (e.g. `https://eventi.dominio.gov.it`) |
| `NEXT_PUBLIC_JITSI_DOMAIN` | Yes | Jitsi Meet server domain (e.g. `jitsi.dominio.gov.it`) |
| `JITSI_JWT_SECRET` | Yes | Shared secret for Jitsi JWT authentication |
| `JITSI_JWT_APP_ID` | Yes | App ID for Jitsi JWT (`iss` claim) |
| `SMTP_HOST` | Yes | SMTP server host |
| `SMTP_PORT` | Yes | SMTP server port |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | Yes | Sender email address |
| `CRON_API_KEY` | Yes | API key for cron endpoints (reminders, cleanup) |
| `NEXT_PUBLIC_WATERMARK_URL` | No | Custom watermark image URL (overrides static file) |
