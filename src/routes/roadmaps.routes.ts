import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { awardXp } from '../data/stats';
import { collection, findById, mongoId } from '../data/mongo';
import { AuthenticatedRequest } from '../middleware/auth';
import { generateRoadmap, getYoutubeResources } from '../services/gemini';

const router = Router();

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const roadmaps = await collection('roadmaps').find({ user_id: req.user.id }).sort({ created_at: -1 }).toArray();
    return res.json(roadmaps.map(serialize));
  } catch (error) {
    return next(error);
  }
});

router.post('/generate', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const targetRole = req.body?.target_role;
  if (typeof targetRole !== 'string' || !targetRole.trim() || targetRole.length > 255) {
    return res.status(422).json({ message: 'Validation error', errors: { target_role: ['A target role of at most 255 characters is required.'] } });
  }

  for (const field of ['description', 'job_description'] as const) {
    if (req.body?.[field] !== undefined && req.body[field] !== null && typeof req.body[field] !== 'string') {
      return res.status(422).json({ message: 'Validation error', errors: { [field]: [`The ${field} field must be a string.`] } });
    }
  }
  for (const field of ['current_skills', 'skill_gaps'] as const) {
    if (req.body?.[field] !== undefined && req.body[field] !== null && !Array.isArray(req.body[field])) {
      return res.status(422).json({ message: 'Validation error', errors: { [field]: [`The ${field} field must be an array.`] } });
    }
  }
  if (req.body?.language !== undefined && req.body.language !== null &&
      (typeof req.body.language !== 'string' || req.body.language.length > 80)) {
    return res.status(422).json({ message: 'Validation error', errors: { language: ['The language must be a string of at most 80 characters.'] } });
  }

  const skillGaps = req.body?.skill_gaps || [];
  const currentSkills = req.body?.current_skills || [];
  const description = req.body?.job_description ?? req.body?.description ?? `I want to become a ${targetRole}`;
  const language = req.body?.language ?? 'English';

  try {
    const generatedNodes = await generateRoadmap(targetRole, skillGaps, description, language);
    if (!Array.isArray(generatedNodes) || generatedNodes.length === 0) {
      return res.status(500).json({ message: 'Roadmap generation failed', error: 'AI did not generate roadmap nodes.' });
    }

    const nodes = generatedNodes.map((node, index) => ({
      id: index + 1,
      skill_name: String(node.skill_name || 'General'),
      title: String(node.title || 'New Lesson'),
      description: String(node.description || 'No description available.'),
      estimated_time: String(node.estimated_time || '1 week'),
      level: String(node.level || 'Beginner'),
      resources: [],
      completed: false,
      order: index + 1,
    }));
    const now = new Date();
    const record = {
      user_id: req.user.id,
      target_role: targetRole,
      description,
      current_skills: currentSkills,
      skill_gaps: skillGaps,
      language,
      nodes,
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    const inserted = await collection('roadmaps').insertOne(record);
    await awardXp(req.user.id, 50);
    return res.status(201).json(serialize({ ...record, _id: inserted.insertedId }));
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/videos', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const roadmap = await findById('roadmaps', req.params.id);
    if (!roadmap || roadmap.user_id !== req.user.id) return res.status(404).json({ message: 'Roadmap not found' });
    const skill = String(req.query.skill || roadmap.target_role || 'learning');
    const language = String(req.query.language || roadmap.language || 'English');
    const videos = await getYoutubeResources(skill, language);
    return res.json({ videos, language });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const roadmap = await findById('roadmaps', req.params.id);
    if (!roadmap || roadmap.user_id !== req.user.id) return res.status(404).json({ message: 'Roadmap not found' });
    return res.json(serialize(roadmap));
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const result = await collection('roadmaps').deleteOne({
      _id: mongoId(req.params.id),
      user_id: req.user.id,
    });
    if (result.deletedCount === 0) return res.status(404).json({ message: 'Roadmap not found' });
    return res.json({ message: 'Roadmap deleted successfully' });
  } catch (error) {
    return next(error);
  }
});

function serialize(document: Record<string, any>): Record<string, any> {
  const id = document._id instanceof ObjectId ? document._id.toString() : String(document._id);
  return { ...document, _id: id, id };
}

export default router;
