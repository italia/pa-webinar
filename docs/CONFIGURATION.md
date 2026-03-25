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
