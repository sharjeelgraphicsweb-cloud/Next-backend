import { Router } from 'express';
import { Document } from 'mongodb';
import { collection, findById } from '../data/mongo';

const router = Router();

router.get('/', async (_req, res, next) => {
  try {
    const courses = await collection('courses').find({ is_published: true }).toArray();
    return res.json({
      success: true,
      data: courses.map(serialize),
      count: courses.length,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const course = await findById('courses', req.params.id);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
    const lessons = await collection('lessons').find({ course_id: req.params.id }).sort({ order: 1 }).toArray();
    return res.json({ success: true, data: { ...serialize(course), lessons: lessons.map(serialize) } });
  } catch (error) {
    return next(error);
  }
});

function serialize(document: Document): Record<string, unknown> {
  const { _id, ...rest } = document;
  return { ...rest, _id: _id?.toString(), id: _id?.toString() };
}

export default router;
