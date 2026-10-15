# Authentication and permissions

## Sanctum token interoperability

The Laravel API uses Sanctum and a MongoDB-backed `PersonalAccessToken` model. Backend2 issues Sanctum-compatible opaque bearer tokens (not JWTs): `<personal_access_tokens ObjectId>|<random secret>`. Only the SHA-256 hash of the secret is stored in `personal_access_tokens`; the raw token is returned once to the client. Existing Laravel token records using either the `id|secret` or legacy hashed-token lookup are accepted.

Login, refresh and logout follow the source API's behavior:

- Registration hashes passwords using bcrypt and initializes a `user_stats` record.
- Login checks Laravel bcrypt hashes, revokes existing user tokens, then issues a new token.
- Protected requests validate the token record and resolve its user; invalid/expired tokens return 401.
- Logout revokes the current token; refresh revokes the user's prior tokens and issues a replacement.
- `access_token`, `refresh_token`, `token_type`, and the user response fields are preserved.

Google OAuth requires the client id, secret and callback URL configured in `backend2/.env`. The callback exchanges the authorization code, creates or resolves the MongoDB user, initializes stats for new users, and redirects to the configured frontend callback.

## Authorization

Authenticated APIs require a valid bearer token. `role === 'admin'` is required for all `/api/admin/*` endpoints. Users can only access their own roadmaps, progress records, resumes and certificates. Public access is limited to health/readiness, course reads, Google OAuth start/callback and certificate verification.

Passwords, remember tokens, token hashes and OAuth secrets are never included in API responses or logs.
