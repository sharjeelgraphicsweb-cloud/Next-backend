# Vercel deployment

Import the `backend2` directory as its own Vercel project, or set the Vercel project's Root Directory to `backend2`. The included `vercel.json` builds the TypeScript app and rewrites `/api/*` requests to the shared serverless Express handler.

The backend root URL (`/`) and `/api/health` return a health response. The shared handler restores nested API paths from the rewrite parameter, including `OPTIONS` preflight requests.

Configure these backend project environment variables in Vercel (Settings → Environment Variables, for the **Production**, **Preview** and **Development** environments you actually deploy):

- `MONGODB_URI` (or `DB_URI`) and `DB_DATABASE`
- `FRONTEND_URL=https://next-frontend-iota-smoky.vercel.app`
- `CORS_ORIGIN=https://next-frontend-iota-smoky.vercel.app`
- `BACKEND_PUBLIC_URL=https://next-backend-mu-two.vercel.app`
- `NODE_ENV=production`
- Any required provider credentials, such as `GEMINI_API_KEY`

> `.env` is gitignored and is **not** uploaded to Vercel. If a deployed request returns
> `503` with `{ "error": "MONGODB_URI_NOT_CONFIGURED" }`, the Vercel environment
> variables are missing or were added to a different environment (e.g. Preview
> instead of Production). If it returns `MONGODB_CONNECTION_FAILED`, the URI is
> configured but unreachable — check the password and MongoDB Atlas network access.

## Database security after a URI leak

If a MongoDB connection string has ever been visible in logs, chat, or a shared
file, assume the database is compromised and rotate it:

1. In MongoDB Atlas, add a new database user and revoke the leaked one (https://cloud.mongodb.com → Database Access). Do not reuse the old password.
2. Update the connection string in **both** `backend2/.env` and the Vercel Environment Variables (replace `MONGODB_URI`/`DB_URI`), then redeploy.
3. Verify Atlas Network Access. Vercel serverless functions use many changing egress IPs, so an IP allowlist that only contains your home IP will block the deployed function while local development keeps working. The practical options are:
   - Enable **"Allow access from anywhere"** (`0.0.0.0/0`) and rely on database authentication, or
   - Use the MongoDB Atlas → Vercel integration to sync network access, or
   - For an allowlist, add the Vercel deployment region CIDR ranges (Google Cloud/AWS) instead of a single IP.
4. Remove the old password/URI from browser password managers, `.env1`, and any exported chat logs.

## Troubleshooting 503 "Backend service is not ready."

`/api/health` intentionally bypasses the database, so it can return 200 even when
MongoDB is unreachable. Use `/api/ready` for the real signal:

- `200` `{ "status": "ready", "database": "mongodb" }` — connected.
- `503` — check the `error` field:
  - `MONGODB_URI_NOT_CONFIGURED` — add `MONGODB_URI`/`DB_URI` and `DB_DATABASE` to the Vercel project environment.
  - `MONGODB_AUTH_FAILED` — the URI is set but Mongo rejects the credentials. Update the Vercel `MONGODB_URI`/`DB_URI` with the same database user/password used in local `.env` (URL-encode special characters in the password). This usually means the Atlas password was rotated or the Atlas user was deleted and Vercel still holds the old value.
  - `MONGODB_DNS_FAILED` — the hostname in the Vercel URI does not resolve; copy the exact URI from local `.env` / the Atlas connection dialog.
  - `MONGODB_NETWORK_UNREACHABLE` — DNS works and credentials were accepted/rejected at TCP level; the cluster is unreachable from Vercel. Verify Atlas Network Access: Vercel uses many changing egress IPs, so an allowlist containing only your home IP blocks the deployed function. Allow `0.0.0.0/0` (rely on auth) or add the deployment region CIDR ranges. Note failures are often slow (server-selection timeout), while auth/DNS failures return fast.
  - `MONGODB_CONNECTION_FAILED` — an unclassified Mongo error; inspect the Vercel function logs for the underlying `console.error` output.

In the frontend Vercel project, set `BACKEND_API_BASE_URL=https://next-backend-mu-two.vercel.app/api`, then redeploy the frontend. The frontend reads this exact variable name, and Vite embeds it at build time.

Uploaded files use Vercel's temporary `/tmp` storage and are not durable across function instances. Use persistent object storage for production uploads.
