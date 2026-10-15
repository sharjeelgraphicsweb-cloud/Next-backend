# Vercel deployment

Import this backend directory as its own Vercel project. The included `vercel.json` builds the TypeScript app and routes `/api/*` requests through the serverless Express handler.

Configure these backend project environment variables in Vercel:

- `MONGODB_URI` (or `DB_URI`) and `DB_DATABASE`
- `FRONTEND_URL=https://next-frontend-iota-smoky.vercel.app`
- `CORS_ORIGIN=https://next-frontend-iota-smoky.vercel.app`
- `BACKEND_PUBLIC_URL=https://next-backend-mu-two.vercel.app`
- Any required provider credentials, such as `GEMINI_API_KEY`

In the frontend Vercel project, set `VITE_API_BASE_URL=https://next-backend-mu-two.vercel.app/api`, then redeploy the frontend. Vite variables are embedded at build time, so changing this value requires a new deployment.

Uploaded files use Vercel's temporary `/tmp` storage and are not durable across function instances. Use persistent object storage for production uploads.
