# MongoDB compatibility schema

## Connection and safety

The Laravel application configures the `mongodb` connection from `DB_URI` and uses `DB_DATABASE` (default `nextstep_db`). Backend2 connects through Mongoose's MongoDB connection and accesses collections by their explicit names. Documents are kept schema-flexible to avoid coercing or renaming existing Laravel data. Backend2 does not run migrations, drop collections, or create indexes automatically.

The local `backend2/.env` is ignored by Git. Do not copy it into logs, source control, issue comments, or shared artifacts. A production cutover should use a least-privileged database account and should be preceded by a backup and read-only compatibility review.

## Collections observed in Laravel models

| Collection | Fields used by Laravel | Relationship notes |
| --- | --- | --- |
| `users` | `name`, `email`, bcrypt `password`, `role`, `google_id`, `avatar`, `domain`, `skills`, `location`, verification/remember fields | `_id` is user identity; passwords and remember tokens are never returned |
| `personal_access_tokens` | `name`, SHA-256 `token`, `abilities`, `tokenable_id`, `tokenable_type`, usage/expiry dates | Sanctum-compatible token record; new tokens use `{ObjectId}|{secret}` format |
| `user_stats` | `user_id`, `xp`, `level`, `streak`, `last_active`, `badges` | `user_id` stored as the user ID string |
| `roadmaps` | `user_id`, `target_role`, `description`, `current_skills`, `skill_gaps`, `language`, `nodes`, `status` | Each node includes an id, title, skill, progress and resources |
| `progress` | `user_id`, `roadmap_id`, `completed_nodes`, `videos_watched`, `passed_quizzes`, `node_activity`, `practice_tasks`, `status`, timestamps | References roadmap and user by string IDs |
| `resumes` | `user_id`, `title`, `target_role`, `industry`, `experience_level`, prompts/input, photo, `meta_data`, `resume_data` | Resume JSON is intentionally retained without normalization |
| `certificates` | `user_id`, `roadmap_id`, `certificate_code`, `issued_at` | Verification uses the certificate code |
| `courses` | title, description, instructor, category, level, duration, price, image, publication status | Course IDs referenced by lessons/enrollments |
| `lessons` | `course_id`, title, description/content, video URL, duration, order, publication status | `course_id` stored as string |
| `enrollments` | Defined by the Laravel Enrollment model | Course/user references follow the existing document values |
| `quizzes` | `video_id`, `video_title`, `skill_name`, `questions` | Questions include private answer/explanation fields; GET omits those fields |

Laravel BSON `ObjectId` values are accepted in `_id` lookups. Relationship IDs remain strings because that is how the application controllers write and query them. No automatic index creation or data migration is performed.

## Local demo data

With `backend2/.env` configured for a local development database, run `npm run seed` from `backend2` to add sample learner, course, lesson, roadmap, progress, stats, and quiz documents. The seeder only inserts missing demo records and does not delete or overwrite existing documents.

Demo login: `demo.learner@nextstep.local` / `DemoPass123!`
