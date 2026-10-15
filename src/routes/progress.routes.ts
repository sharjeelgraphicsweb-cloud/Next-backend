import { Router } from 'express';
import fs from 'fs/promises';
import { ObjectId } from 'mongodb';
import { awardXp } from '../data/stats';
import { collection, findById, mongoId } from '../data/mongo';
import { AuthenticatedRequest } from '../middleware/auth';
import { practiceFileUpload, publicUploadUrl } from '../middleware/uploads';

const router = Router();

router.post('/start', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const roadmapId = String(req.body?.roadmap_id || '');
  if (!roadmapId) return res.status(422).json({ message: 'Validation error', errors: { roadmap_id: ['The roadmap_id field is required.'] } });

  try {
    const existing = await collection('progress').findOne({ user_id: req.user.id, roadmap_id: roadmapId });
    if (existing) return res.json({ success: true, data: serialize(existing) });

    const roadmap = await findById('roadmaps', roadmapId);
    if (!roadmap || roadmap.user_id !== req.user.id) return res.status(404).json({ message: 'Roadmap not found' });

    const now = new Date();
    const tasks = (roadmap.nodes || []).map((node: Record<string, any>) => {
      const nodeId = String(node.id ?? '');
      const skill = node.skill_name || node.title || 'Skill';
      return {
        task_id: `task-${nodeId}`,
        node_id: nodeId,
        skill_name: skill,
        title: `Build one mini project for ${skill}`,
        deliverable: `Create one small practical task or portfolio-ready example using ${skill}.`,
        revision_step: 'Revise the concept once and explain the solution in your own words.',
        completed: false,
        completed_at: null,
        portfolio_url: null,
        submission_notes: null,
        submission_file_url: null,
        mentor_review_status: 'not_submitted',
        mentor_feedback: null,
      };
    });
    const record = {
      user_id: req.user.id,
      roadmap_id: roadmapId,
      completed_nodes: [],
      videos_watched: [],
      passed_quizzes: [],
      node_activity: [],
      practice_tasks: tasks,
      status: 'in_progress',
      started_at: now,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };
    const inserted = await collection('progress').insertOne(record);
    return res.status(201).json({ success: true, data: serialize({ ...record, _id: inserted.insertedId }) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/complete', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const nodeId = String(req.body?.node_id ?? '');
  if (!nodeId) return res.status(422).json({ message: 'Validation error', errors: { node_id: ['The node_id field is required.'] } });

  try {
    const progress = await collection('progress').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!progress) return res.status(404).json({ message: 'Progress record not found' });

    const completedNodes = (progress.completed_nodes || []).map(String);
    if (!completedNodes.includes(nodeId)) {
      const roadmap = await findById('roadmaps', String(progress.roadmap_id));
      const node = (roadmap?.nodes || []).find((candidate: Record<string, any>) => String(candidate.id) === nodeId);
      completedNodes.push(nodeId);
      const nodeActivity = [
        ...(progress.node_activity || []),
        {
          node_id: nodeId,
          skill_name: node?.skill_name || node?.title || 'Skill',
          title: node?.title || 'Completed skill',
          completed_at: new Date().toISOString(),
        },
      ];
      const finished = Boolean(roadmap && completedNodes.length >= (roadmap.nodes || []).length);
      const update = {
        completed_nodes: completedNodes,
        node_activity: nodeActivity,
        status: finished ? 'completed' : 'in_progress',
        completed_at: finished ? new Date() : null,
        updated_at: new Date(),
      };
      await collection('progress').updateOne({ _id: progress._id }, { $set: update });
      await awardXp(req.user.id, finished ? 200 : 10);
      return res.json({ success: true, data: serialize({ ...progress, ...update }) });
    }

    return res.json({ success: true, data: serialize(progress) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/track-video', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const videoId = req.body?.video_id;
  if (typeof videoId !== 'string' || !videoId) {
    return res.status(422).json({ message: 'Validation error', errors: { video_id: ['The video_id field is required.'] } });
  }

  try {
    const progress = await collection('progress').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!progress) return res.status(404).json({ message: 'Progress record not found' });
    const videos = progress.videos_watched || [];
    if (!videos.includes(videoId)) {
      videos.push(videoId);
      await collection('progress').updateOne({ _id: progress._id }, { $set: { videos_watched: videos, updated_at: new Date() } });
      progress.videos_watched = videos;
    }
    return res.json({ success: true, data: serialize(progress) });
  } catch (error) {
    return next(error);
  }
});

router.get('/roadmap/:roadmapId', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const progress = await collection('progress').findOne({ user_id: req.user.id, roadmap_id: req.params.roadmapId });
    const roadmap = await collection('roadmaps').findOne({ _id: mongoId(req.params.roadmapId), user_id: req.user.id });
    if (!progress || !roadmap) return res.json([]);

    const completed = (progress.completed_nodes || []).map(String);
    const nodeProgress = (roadmap.nodes || []).map((node: Record<string, any>) => ({
      id: progress._id.toString(),
      node_id: Number.parseInt(String(node.id), 10) || 0,
      status: completed.includes(String(node.id)) ? 'completed' : 'in_progress',
      progress_id: progress._id.toString(),
    }));

    const existingTasks = new Map((progress.practice_tasks || []).map((task: Record<string, any>) => [String(task.task_id), task]));
    const practiceTasks = (roadmap.nodes || []).map((node: Record<string, any>) => {
      const nodeId = String(node.id ?? '');
      const skill = node.skill_name || node.title || 'Skill';
      const defaults = {
        task_id: `task-${nodeId}`,
        node_id: nodeId,
        skill_name: skill,
        title: `Build one mini project for ${skill}`,
        deliverable: `Create one small practical task or portfolio-ready example using ${skill}.`,
        revision_step: 'Revise the concept once and explain the solution in your own words.',
        completed: false,
        completed_at: null,
        portfolio_url: null,
        submission_notes: null,
        submission_file_url: null,
        mentor_review_status: 'not_submitted',
        mentor_feedback: null,
      };
      return { ...defaults, ...(existingTasks.get(defaults.task_id) || {}) };
    });
    await collection('progress').updateOne({ _id: progress._id }, { $set: { practice_tasks: practiceTasks } });
    return res.json({ node_progress: nodeProgress, passed_quizzes: progress.passed_quizzes || [], practice_tasks: practiceTasks });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/practice-task', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const taskId = String(req.body?.task_id || '');
  if (!taskId) return res.status(422).json({ message: 'Validation error', errors: { task_id: ['The task_id field is required.'] } });
  if (req.body?.completed !== undefined && ![true, false, 0, 1, '0', '1'].includes(req.body.completed)) {
    return res.status(422).json({ message: 'Validation error', errors: { completed: ['The completed field must be true or false.'] } });
  }
  if (req.body?.portfolio_url !== undefined && req.body.portfolio_url !== null &&
      (typeof req.body.portfolio_url !== 'string' || req.body.portfolio_url.length > 2048 || !isUrl(req.body.portfolio_url))) {
    return res.status(422).json({ message: 'Validation error', errors: { portfolio_url: ['The portfolio_url must be a valid URL.'] } });
  }
  if (req.body?.submission_notes !== undefined && req.body.submission_notes !== null &&
      (typeof req.body.submission_notes !== 'string' || req.body.submission_notes.length > 3000)) {
    return res.status(422).json({ message: 'Validation error', errors: { submission_notes: ['The submission_notes must be a string of at most 3000 characters.'] } });
  }

  try {
    const progress = await collection('progress').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!progress) return res.status(404).json({ message: 'Progress record not found' });
    const tasks = progress.practice_tasks || [];
    const task = tasks.find((item: Record<string, any>) => String(item.task_id) === taskId);
    if (!task) return res.status(404).json({ message: 'Practice task not found' });
    if (req.body?.completed !== undefined && req.body.completed !== null) {
      task.completed = req.body.completed === true || req.body.completed === 1 || req.body.completed === '1';
      task.completed_at = task.completed ? new Date().toISOString() : null;
    }
    if (req.body?.portfolio_url !== undefined) task.portfolio_url = req.body.portfolio_url || null;
    if (req.body?.submission_notes !== undefined) task.submission_notes = req.body.submission_notes || null;
    if (task.portfolio_url || task.submission_file_url || task.submission_notes) {
      task.mentor_review_status = 'submitted';
    } else if (task.mentor_review_status === 'submitted') {
      task.mentor_review_status = 'not_submitted';
    }
    await collection('progress').updateOne({ _id: progress._id }, { $set: { practice_tasks: tasks, updated_at: new Date() } });
    return res.json({ success: true, practice_tasks: tasks });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/practice-submission', practiceFileUpload.single('file'), async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const taskId = String(req.body?.task_id || '');
  if (!taskId || !req.file) {
    if (req.file) await removeUploadedFile(req.file.path);
    return res.status(422).json({ message: 'Validation error', errors: { task_id: ['A task_id and submission file are required.'] } });
  }

  try {
    const progress = await collection('progress').findOne({ _id: mongoId(req.params.id), user_id: req.user.id });
    if (!progress) {
      await removeUploadedFile(req.file.path);
      return res.status(404).json({ message: 'Progress record not found' });
    }
    const tasks = progress.practice_tasks || [];
    const task = tasks.find((item: Record<string, any>) => String(item.task_id) === taskId);
    if (!task) {
      await removeUploadedFile(req.file.path);
      return res.status(404).json({ message: 'Practice task not found' });
    }
    task.submission_file_url = publicUploadUrl(req.file.filename);
    task.mentor_review_status = 'submitted';
    await collection('progress').updateOne({ _id: progress._id }, { $set: { practice_tasks: tasks, updated_at: new Date() } });
    return res.json({ success: true, practice_tasks: tasks });
  } catch (error) {
    if (req.file) await removeUploadedFile(req.file.path);
    return next(error);
  }
});

router.get('/weekly-insights', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const [progressRecords, roadmaps] = await Promise.all([
      collection('progress').find({ user_id: req.user.id }).toArray(),
      collection('roadmaps').find({ user_id: req.user.id }).toArray(),
    ]);
    const roadmapMap = new Map(roadmaps.map((roadmap) => [roadmap._id.toString(), roadmap]));
    const now = new Date();
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 999);
    let completedThisWeek = 0;
    let activeRoadmaps = 0;
    let videosWatched = 0;
    const weakPoints: Record<string, unknown>[] = [];
    const assignments: Record<string, unknown>[] = [];

    for (const progress of progressRecords) {
      const roadmap = roadmapMap.get(String(progress.roadmap_id));
      if (!roadmap) continue;
      if (progress.status !== 'completed') activeRoadmaps += 1;
      videosWatched += (progress.videos_watched || []).length;
      for (const activity of progress.node_activity || []) {
        const completedAt = new Date(activity.completed_at);
        if (!Number.isNaN(completedAt.getTime()) && completedAt >= weekStart && completedAt <= weekEnd) completedThisWeek += 1;
      }
      const completed = (progress.completed_nodes || []).map(String);
      for (const node of roadmap.nodes || []) {
        if (completed.includes(String(node.id))) continue;
        weakPoints.push({
          roadmap_id: roadmap._id.toString(),
          target_role: roadmap.target_role,
          skill_name: node.skill_name || node.title || 'Skill',
          title: node.title || 'Learning milestone',
          level: node.level || 'Beginner',
          estimated_time: node.estimated_time || '1 week',
          reason: 'This skill is still incomplete and is slowing overall roadmap progress.',
          recommendation: 'Repeat this topic, rewatch one focused lesson, and complete a short revision session before moving ahead.',
        });
      }
      for (const task of progress.practice_tasks || []) {
        if (task.completed) continue;
        assignments.push({
          task_id: task.task_id || '',
          roadmap_id: roadmap._id.toString(),
          target_role: roadmap.target_role,
          skill_name: task.skill_name || 'Practice task',
          title: task.title || 'Practice assignment',
          deliverable: task.deliverable || '',
          revision_step: task.revision_step || '',
          mentor_review_status: task.mentor_review_status || 'not_submitted',
        });
      }
    }

    const topWeakPoints = weakPoints.slice(0, 4);
    const weeklyAssignments = assignments.slice(0, 4);
    const summary = completedThisWeek === 0
      ? { headline: 'Your weekly progress is low.', message: 'Repeat one weak topic this week and finish at least one blocked skill to rebuild momentum.' }
      : completedThisWeek < 3
        ? { headline: 'Momentum is building, but some weak points need revision.', message: 'Repeat the highlighted skills before they turn into bigger gaps across your roadmap.' }
        : { headline: 'Good weekly momentum.', message: topWeakPoints.length > 0 ? 'You are progressing well. Repeat the highlighted weak points once so they do not slow next week.' : 'You are progressing well and have no urgent weak points highlighted right now.' };

    return res.json({
      week_range: { start: weekStart.toISOString().slice(0, 10), end: weekEnd.toISOString().slice(0, 10) },
      summary,
      stats: {
        completed_this_week: completedThisWeek,
        active_roadmaps: activeRoadmaps,
        videos_watched_total: videosWatched,
        weak_points_count: topWeakPoints.length,
        assignments_count: weeklyAssignments.length,
      },
      weak_points: topWeakPoints,
      weekly_assignments: weeklyAssignments,
    });
  } catch (error) {
    return next(error);
  }
});

function serialize(document: Record<string, any>): Record<string, any> {
  const id = document._id instanceof ObjectId ? document._id.toString() : String(document._id);
  return { ...document, _id: id, id };
}

function isUrl(value: unknown): boolean {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function removeUploadedFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export default router;
