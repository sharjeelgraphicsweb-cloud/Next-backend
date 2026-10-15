# Vercel deployment

Import the `backend2` directory as its own Vercel project, or set the Vercel project's Root Directory to `backend2`. The included `vercel.json` builds the TypeScript app and rewrites `/api/*` requests to the shared serverless Express handler.

The backend root URL (`/`) and `/api/health` return a health response. The shared handler restores nested API paths from the rewrite parameter, including `OPTIONS` preflight requests.

Configure these backend project environment variables in Vercel:

- `MONGODB_URI` (or `DB_URI`) and `DB_DATABASE`
- `FRONTEND_URL=https://next-frontend-iota-smoky.vercel.app`
- `CORS_ORIGIN=https://next-frontend-iota-smoky.vercel.app`
- `BACKEND_PUBLIC_URL=https://next-backend-mu-two.vercel.app`
- Any required provider credentials, such as `GEMINI_API_KEY`

In the frontend Vercel project, set `BACKEND_API_BASE_URL=https://next-backend-mu-two.vercel.app/api`, then redeploy the frontend. The frontend reads this exact variable name, and Vite embeds it at build time.

Uploaded files use Vercel's temporary `/tmp` storage and are not durable across function instances. Use persistent object storage for production uploads.
