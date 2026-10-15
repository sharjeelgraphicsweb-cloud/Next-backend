# Laravel backend audit and backend2 status

## Audited source surfaces

- `routes/api.php`: full public and `auth:sanctum` route table. See [api-mapping.md](./api-mapping.md) for every HTTP method and URI.
- Controllers: auth, profile, courses/lessons, skill-gap, roadmaps, progress/practice, resumes, certificates, gamification, quiz and admin.
- Models: users, personal access tokens, user stats, roadmaps, progress, resumes, certificates, courses, lessons, enrollments and quizzes.
- Services: Gemini AI and practice-task generation/submission.
- Database config and model declarations confirm MongoDB and explicit collection names.

## Existing behavior confirmed

- Authentication is Laravel Sanctum, backed by `personal_access_tokens`; password fields are bcrypt hashes.
- User ownership is enforced for a user's roadmaps, progress, resumes and certificates. Admin routes require `role === admin`.
- Gemini generates skill gap reports, learning roadmaps, quizzes and resume data. YouTube API is used for video results when configured; Gemini/fallback resources are used otherwise.
- Uploads include profile avatars, resume photos, PDF resumes and practice submissions. Resume and certificate downloads support PDF and DOCX.
- Progress node completion, quiz passes, roadmap creation and certificate issuance award XP; certificate issuance awards a role badge.
- Laravel collections include `users`, `personal_access_tokens`, `user_stats`, `roadmaps`, `progress`, `resumes`, `certificates`, `courses`, `lessons`, `enrollments` and `quizzes`.

## Backend2 implementation

All API route groups in `routes/api.php` have a corresponding Express router mounted in `src/app.ts`. Backend2 uses explicit Mongoose models with `strict: false`, `autoIndex: false` and the original collection names, and accesses the existing BSON documents without schema rewrites. It supports Sanctum token hashes and Laravel bcrypt hashes, MongoDB-backed user/roadmap/progress/resume/certificate/course/lesson/quiz data, role checks, AI calls, uploads and document exports.

## Boundaries and rollout

- Backend2 does not alter Laravel files, migrate documents, create indexes, drop collections or connect to the configured database during build/test.
- The `backend2/.env` was created locally from only relevant keys in the existing `.env1` and is ignored by Git. The MongoDB host/account/database were not accessed as part of this work.
- This is a separate API implementation, not a claim that production cutover has been tested. Run integration tests against a dedicated development database, compare actual frontend requests/responses, validate Google callback registration and configure durable upload storage before switching traffic.
