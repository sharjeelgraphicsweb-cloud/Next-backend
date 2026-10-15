# Laravel-to-backend2 API mapping

All paths below are mounted below `/api`. Authenticated routes require the Laravel Sanctum-compatible `Authorization: Bearer <token>` header. Admin routes additionally require `role: admin`.

| Method | Path | Access | Request / response notes |
| --- | --- | --- | --- |
| GET | `/health` | Public | Laravel-compatible health JSON |
| GET | `/ready` | Public | MongoDB readiness; 503 while disconnected |
| POST | `/auth/register` | Public | `name`, `email`, `password`; 201 user + access/refresh token |
| POST | `/auth/login` | Public | `email`, `password`; user + access/refresh token |
| GET | `/auth/google` | Public | Redirects to Google OAuth |
| GET | `/auth/google/callback` | Public | Exchanges Google code; redirects to frontend with token |
| GET | `/certificates/verify/{id}` | Public | Verify certificate code |
| GET | `/courses` | Public | Published courses; `{success,data,count}` |
| GET | `/courses/{id}` | Public | Course and lessons; `{success,data}` |
| GET | `/auth/me` | Auth | Current user payload |
| POST | `/auth/logout` | Auth | Revokes current access token |
| POST | `/auth/refresh` | Auth | Revokes the user's tokens and returns a replacement |
| POST | `/skill-gap/analyze` | Auth | `target_role`, `description` or `job_description`, optional PDF `resume`, `language`; AI analysis JSON |
| PUT | `/profile` | Auth | Optional `name`, `email`; updates profile |
| POST | `/profile/avatar` | Auth | Required multipart image field `image`, maximum 2 MB; returns `avatar_url` and user |
| DELETE | `/profile/avatar` | Auth | Removes avatar reference |
| POST | `/profile/location` | Auth | Numeric `lat`, `lng`; returns saved location |
| GET | `/roadmaps` | Auth | Current user's roadmaps, newest first |
| POST | `/roadmaps/generate` | Auth | Role, skills/gaps, description and language; AI-generated roadmap (201) |
| GET | `/roadmaps/{id}` | Auth | User-owned roadmap |
| DELETE | `/roadmaps/{id}` | Auth | Deletes user-owned roadmap |
| GET | `/roadmaps/{id}/videos` | Auth | `skill` and `language` query; YouTube/Gemini resources |
| GET | `/resumes` | Auth | Current user's resumes |
| POST | `/resumes/generate` | Auth | Resume prompt and optional role/profile context; generated resume (201) |
| POST | `/resumes/improve-existing` | Auth | Multipart PDF `resume`, required `target_role`; improved resume and gap analysis (201) |
| GET | `/resumes/{id}` | Auth | User-owned resume |
| GET | `/resumes/{id}/download` | Auth | PDF by default; `?format=docx` returns DOCX |
| PUT | `/resumes/{id}` | Auth | Update resume fields (`title`, role, metadata and resume data) |
| POST | `/resumes/{id}/photo` | Auth | Multipart JPEG/PNG image `image`, maximum 4 MB; updates resume photo |
| POST | `/progress/start` | Auth | `roadmap_id`; creates or returns existing progress |
| POST | `/progress/{id}/complete` | Auth | Required `node_id`; marks a node complete and awards XP |
| POST | `/progress/{id}/track-video` | Auth | Required `video_id`; idempotently tracks a watched video |
| POST | `/progress/{id}/practice-task` | Auth | `task_id`; optional completion, portfolio URL and notes |
| POST | `/progress/{id}/practice-submission` | Auth | Multipart `task_id` and `file`; submits a practice task |
| GET | `/progress/roadmap/{roadmapId}` | Auth | Per-node progress (integer `node_id`), passed quizzes and roadmap-synchronized practice tasks |
| GET | `/progress/weekly-insights` | Auth | Weekly summary, statistics, weak points and assignments |
| GET | `/certificates` | Auth | User certificates with roadmap details |
| POST | `/certificates/generate/{roadmapId}` | Auth | Requires completed roadmap; creates/returns certificate |
| GET | `/certificates/{id}/download` | Auth | PDF by default; `?format=docx` returns DOCX |
| GET | `/gamification/leaderboard` | Auth | Optional `limit` (default 10) |
| GET | `/gamification/badges` | Auth | Current user's badges |
| GET | `/gamification/stats` | Auth | XP, level, streak, badges and XP to next level |
| GET | `/admin/users` | Admin | Optional `search`, `page`, `per_page`; paginated users |
| DELETE | `/admin/users/{id}` | Admin | Cannot delete an admin account |
| PATCH | `/admin/users/{id}/role` | Admin | `role` must be `user` or `admin` |
| GET | `/admin/stats` | Admin | User, roadmap, certificate, activity and assignment counts |
| GET | `/admin/practice-reviews` | Admin | Submitted and reviewed practice assignments |
| POST | `/admin/practice-reviews/{progressId}` | Admin | `task_id`, `status` (`approved` or `needs_revision`), optional feedback |
| DELETE | `/admin/certificates/{id}` | Admin | Deletes certificate |
| POST | `/admin/courses` | Admin | Validated course creation (201) |
| PUT | `/admin/courses/{id}` | Admin | Updates course fields |
| DELETE | `/admin/courses/{id}` | Admin | Deletes course |
| POST | `/admin/courses/{courseId}/lessons` | Admin | Validated lesson creation (201) |
| PUT | `/admin/lessons/{id}` | Admin | Updates lesson fields |
| DELETE | `/admin/lessons/{id}` | Admin | Deletes lesson |
| GET | `/quiz` | Auth | Required `video_id`, `video_title`, `skill_name`; returns questions without answers |
| POST | `/quiz/submit` | Auth | `quiz_id`, array `answers`, `progress_id`, `node_id`; score/results and pass state |

## Compatibility boundaries

- MongoDB document ids are emitted as both `_id` and `id`, like the Eloquent MongoDB models.
- Application-owned documents retain the Laravel collection names and string relationship fields.
- OAuth, Gemini, YouTube, PDF parsing, and file uploads require the corresponding configured service or local storage.
- Laravel uses framework-specific validation and exception details. Backend2 mirrors the documented contracts but has not been integration-tested against a dedicated MongoDB database or every external provider. Do not treat parity as production-verified until those flows are compared end to end.
