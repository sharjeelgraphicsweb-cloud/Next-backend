import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { collection, findById, mongoId } from '../data/mongo';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.get('/users', async (req: AuthenticatedRequest, res, next) => {
  const page = positiveInteger(req.query.page, 1);
  const perPage = Math.min(100, positiveInteger(req.query.per_page, 20));
  const search = String(req.query.search || '').trim();
  const query = search
    ? { $or: [{ name: { $regex: escapeRegex(search), $options: 'i' } }, { email: { $regex: escapeRegex(search), $options: 'i' } }] }
    : {};
  try {
    const users = await collection('users').find(query, { projection: { password: 0, remember_token: 0 } })
      .sort({ created_at: -1 }).skip((page - 1) * perPage).limit(perPage).toArray();
    const total = await collection('users').countDocuments(query);
    return res.json({
      data: users.map(serialize),
      total,
      page,
      pages: Math.ceil(total / perPage),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/users/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const target = await findById('users', req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (target.role === 'admin') return res.status(403).json({ message: 'Cannot delete admin user' });
    if (!target._id) return res.status(404).json({ message: 'User not found' });
    await collection('users').deleteOne({ _id: target._id });
    await collection('personal_access_tokens').deleteMany({
      $or: [{ tokenable_id: target._id.toString() }, { tokenable_id: target._id }],
    });
    return res.json({ message: 'User deleted successfully' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id/role', async (req: AuthenticatedRequest, res, next) => {
  const role = req.body?.role;
  if (role !== 'user' && role !== 'admin') {
    return res.status(422).json({ message: 'Validation error', errors: { role: ['The role must be user or admin.'] } });
  }
  try {
    const target = await findById('users', req.params.id);
    if (!target) return res.status(404).json({ message: 'User not found' });
    await collection('users').updateOne({ _id: target._id }, { $set: { role, updated_at: new Date() } });
    const updated = await collection('users').findOne({ _id: target._id }, { projection: { password: 0, remember_token: 0 } });
    return res.json({ message: 'User role updated', user: updated ? serialize(updated) : null });
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [totalUsers, totalRoadmaps, totalCertificates, activeToday, submissions] = await Promise.all([
      collection('users').countDocuments(),
      collection('roadmaps').countDocuments(),
      collection('certificates').countDocuments(),
      collection('users').countDocuments({ updated_at: { $gte: startOfDay } }),
      collection('progress').countDocuments({ 'practice_tasks.mentor_review_status': 'submitted' }),
    ]);
    return res.json({
      total_users: totalUsers,
      total_roadmaps: totalRoadmaps,
      total_certificates: totalCertificates,
      active_today: activeToday,
      submitted_assignments: submissions,
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/certificates/:id', async (req, res, next) => {
  try {
    const result = await collection('certificates').deleteOne({ _id: mongoId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ message: 'Certificate not found' });
    return res.json({ message: 'Certificate deleted' });
  } catch (error) {
    return next(error);
  }
});

router.get('/practice-reviews', async (_req, res, next) => {
  try {
    const [progressRecords, users, roadmaps] = await Promise.all([
      collection('progress').find({}).toArray(),
      collection('users').find({}, { projection: { password: 0 } }).toArray(),
      collection('roadmaps').find({}).toArray(),
    ]);
    const userMap = new Map(users.map((user) => [user._id.toString(), user]));
    const roadmapMap = new Map(roadmaps.map((roadmap) => [roadmap._id.toString(), roadmap]));
    const reviews: Record<string, unknown>[] = [];
    for (const progress of progressRecords) {
      for (const task of progress.practice_tasks || []) {
        const status = task.mentor_review_status || 'not_submitted';
        if (!['submitted', 'approved', 'needs_revision'].includes(status)) continue;
        const user = userMap.get(String(progress.user_id));
        const roadmap = roadmapMap.get(String(progress.roadmap_id));
        reviews.push({
          progress_id: progress._id.toString(),
          task_id: task.task_id || '',
          user_name: user?.name || 'Unknown',
          user_email: user?.email || '',
          target_role: roadmap?.target_role || 'Unknown',
          title: task.title || 'Practice assignment',
          portfolio_url: task.portfolio_url || null,
          submission_notes: task.submission_notes || null,
          submission_file_url: task.submission_file_url || null,
          mentor_review_status: status,
          mentor_feedback: task.mentor_feedback || null,
        });
      }
    }
    return res.json({ reviews });
  } catch (error) {
    return next(error);
  }
});

router.post('/practice-reviews/:progressId', async (req, res, next) => {
  const taskId = String(req.body?.task_id || '');
  const status = req.body?.status;
  const feedback = req.body?.mentor_feedback;
  if (!taskId || !['approved', 'needs_revision'].includes(status)) {
    return res.status(422).json({ message: 'Validation error', errors: { status: ['task_id and a supported status are required.'] } });
  }
  if (feedback !== undefined && (typeof feedback !== 'string' || feedback.length > 3000)) {
    return res.status(422).json({ message: 'Validation error', errors: { mentor_feedback: ['Feedback must be a string of at most 3000 characters.'] } });
  }
  try {
    const progress = await findById('progress', req.params.progressId);
    if (!progress) return res.status(404).json({ message: 'Progress not found' });
    const tasks = progress.practice_tasks || [];
    const task = tasks.find((item: Record<string, any>) => String(item.task_id) === taskId);
    if (!task) return res.status(404).json({ message: 'Task not found' });
    task.mentor_review_status = status;
    task.mentor_feedback = feedback || null;
    await collection('progress').updateOne({ _id: progress._id }, { $set: { practice_tasks: tasks, updated_at: new Date() } });
    return res.json({ message: 'Practice task reviewed successfully' });
  } catch (error) {
    return next(error);
  }
});

router.post('/courses', async (req, res, next) => {
  const body = req.body || {};
  const required = ['title', 'description', 'instructor_id', 'category', 'level'];
  const errors: Record<string, string[]> = {};
  for (const key of required) {
    if (typeof body[key] !== 'string' || !body[key].trim()) errors[key] = [`The ${key} field is required.`];
  }
  if (!['beginner', 'intermediate', 'advanced'].includes(body.level)) errors.level = ['The level must be beginner, intermediate, or advanced.'];
  if (!Number.isInteger(Number(body.duration_hours)) || Number(body.duration_hours) < 0) errors.duration_hours = ['The duration_hours must be a non-negative integer.'];
  if (!Number.isFinite(Number(body.price)) || Number(body.price) < 0) errors.price = ['The price must be a non-negative number.'];
  if (Object.keys(errors).length) return res.status(422).json({ message: 'Validation error', errors });
  try {
    const now = new Date();
    const course = {
      title: body.title,
      description: body.description,
      instructor_id: body.instructor_id,
      category: body.category,
      level: body.level,
      duration_hours: Number(body.duration_hours),
      price: Number(body.price),
      image_url: body.image_url || null,
      is_published: body.is_published ?? false,
      created_at: now,
      updated_at: now,
    };
    const result = await collection('courses').insertOne(course);
    return res.status(201).json({ success: true, message: 'Course created successfully', data: serialize({ ...course, _id: result.insertedId }) });
  } catch (error) {
    return next(error);
  }
});

router.put('/courses/:id', async (req, res, next) => {
  const allowed = ['title', 'description', 'instructor_id', 'category', 'level', 'duration_hours', 'price', 'image_url', 'is_published'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  if (Object.keys(updates).length === 0) return res.status(422).json({ message: 'No valid course fields were provided.' });
  try {
    const result = await collection('courses').updateOne({ _id: mongoId(req.params.id) }, { $set: { ...updates, updated_at: new Date() } });
    if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Course not found' });
    const course = await collection('courses').findOne({ _id: mongoId(req.params.id) });
    return res.json({ success: true, message: 'Course updated successfully', data: course ? serialize(course) : null });
  } catch (error) {
    return next(error);
  }
});

router.delete('/courses/:id', async (req, res, next) => {
  try {
    const result = await collection('courses').deleteOne({ _id: mongoId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: 'Course not found' });
    return res.json({ success: true, message: 'Course deleted successfully' });
  } catch (error) {
    return next(error);
  }
});

router.post('/courses/:courseId/lessons', async (req, res, next) => {
  const body = req.body || {};
  const required = ['title', 'description', 'video_url'];
  const errors: Record<string, string[]> = {};
  for (const key of required) if (typeof body[key] !== 'string' || !body[key].trim()) errors[key] = [`The ${key} field is required.`];
  if (!isHttpUrl(body.video_url)) errors.video_url = ['The video_url must be a valid URL.'];
  if (!Number.isInteger(Number(body.duration_minutes))) errors.duration_minutes = ['The duration_minutes must be an integer.'];
  if (!Number.isInteger(Number(body.order))) errors.order = ['The order must be an integer.'];
  if (Object.keys(errors).length) return res.status(422).json({ message: 'Validation error', errors });

  try {
    const course = await findById('courses', req.params.courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });
    const now = new Date();
    const lesson = {
      course_id: req.params.courseId,
      title: body.title,
      description: body.description,
      video_url: body.video_url,
      duration_minutes: Number(body.duration_minutes),
      order: Number(body.order),
      is_published: true,
      created_at: now,
      updated_at: now,
    };
    const result = await collection('lessons').insertOne(lesson);
    return res.status(201).json({ success: true, message: 'Lesson created successfully', data: serialize({ ...lesson, _id: result.insertedId }) });
  } catch (error) {
    return next(error);
  }
});

router.put('/lessons/:id', async (req, res, next) => {
  const allowed = ['title', 'description', 'video_url', 'duration_minutes', 'order'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) updates[key] = req.body[key];
  if (Object.keys(updates).length === 0) return res.status(422).json({ message: 'No valid lesson fields were provided.' });
  try {
    const result = await collection('lessons').updateOne({ _id: mongoId(req.params.id) }, { $set: { ...updates, updated_at: new Date() } });
    if (!result.matchedCount) return res.status(404).json({ message: 'Lesson not found' });
    const lesson = await collection('lessons').findOne({ _id: mongoId(req.params.id) });
    return res.json({ success: true, message: 'Lesson updated successfully', data: lesson ? serialize(lesson) : null });
  } catch (error) {
    return next(error);
  }
});

router.delete('/lessons/:id', async (req, res, next) => {
  try {
    const result = await collection('lessons').deleteOne({ _id: mongoId(req.params.id) });
    if (!result.deletedCount) return res.status(404).json({ message: 'Lesson not found' });
    return res.json({ success: true, message: 'Lesson deleted successfully' });
  } catch (error) {
    return next(error);
  }
});

function serialize(document: Record<string, any>): Record<string, any> {
  return { ...document, _id: document._id.toString(), id: document._id.toString(), password: undefined, remember_token: undefined };
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHttpUrl(value: unknown): boolean {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default router;
