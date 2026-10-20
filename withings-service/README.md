# FORM Withings service

Small Cloudflare Worker backend for FORM's personal Withings connection. It stores Withings OAuth tokens in Cloudflare D1; it does not store workout logs.

## Required setup

1. Create a Withings developer application at https://developer.withings.com/ and set its callback URL to `https://YOUR-WORKER.workers.dev/callback`.
2. Create a Cloudflare D1 database named `form-withings`; run `schema.sql` against it.
3. Replace the placeholder `database_id` in `wrangler.toml`.
4. Set Worker secrets: `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET`, and a long random `FORM_ACCESS_PIN`. Set `WITHINGS_REDIRECT_URI` to the exact callback URL and `APP_ORIGIN` to `https://driftwoodye.github.io`.
5. Deploy with Wrangler. The client ID is not a secret, but keep the client secret and FORM access PIN out of Git.
6. The FORM UI must send `Authorization: Bearer <FORM_ACCESS_PIN>` to `/connect` and `/api/*`. Do not hardcode the PIN into `index.html`; ask for it and keep it on the device.

## Routes

- `GET /health`: service health check.
- `GET /connect`: requires the FORM access PIN; starts Withings OAuth.
- `GET /callback`: validates one-time OAuth state and stores access/refresh tokens in D1.
- `GET /api/status`: authenticated connection status.
- `GET /api/measures`: authenticated retrieval of body measurements from the last year, refreshing the access token when necessary.
- `POST /api/disconnect`: removes stored Withings tokens.

This backend is a starter implementation. Before public multi-user use, add per-user identity and rate limiting. It is designed for a single personal FORM installation. Do not deploy until secrets, the D1 database, and the exact Withings callback URL are configured.
