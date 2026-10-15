# Deployment plan

## Local

1. Run `npm install` from `backend2`.
2. Configure the ignored `backend2/.env` with a development MongoDB URI/database, frontend origin, and optional AI/OAuth credentials.
3. Set the Google OAuth callback URL to `http://localhost:4000/api/auth/google/callback` in both Google configuration and `GOOGLE_REDIRECT_URL`.
4. Run `npm run dev`; check `/api/health` and `/api/ready`.

The included local `.env` was populated from the user-provided `.env1`. It contains credentials and must remain local, unshared and uncommitted. Verify that its MongoDB account is restricted to the intended database before running the service. Starting backend2 connects to MongoDB; endpoint calls can read and write application data.

## Production

- Deploy this folder as an independent Node.js service; point frontend API configuration only after integration tests.
- Configure environment variables in the platform's secret store rather than shipping `.env`.
- Use an application-scoped, least-privileged MongoDB user and a reviewed backup/restore plan.
- Provide HTTPS, a frontend-only CORS origin, and the registered Google callback URL.
- Configure writable persistent storage/object storage for uploads. Current upload support writes to `storage/uploads`; ephemeral serverless storage is not durable.
- Use `/api/ready` as the readiness probe and `/api/health` as the liveness probe.
- Set `NODE_ENV=production`, `PORT`, `DB_URI`, `DB_DATABASE`, `CORS_ORIGIN`, and required integration keys.

Backend2 does not run schema migration, collection deletion, index creation or data transformation at startup.
