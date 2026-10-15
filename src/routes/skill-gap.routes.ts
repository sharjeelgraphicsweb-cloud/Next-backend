import { Router } from 'express';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import { analyzeSkillGap } from '../services/gemini';
import { resumePdfUpload } from '../middleware/uploads';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.post('/analyze', resumePdfUpload.single('resume'), async (req: AuthenticatedRequest, res, next) => {
  const targetRole = typeof req.body?.target_role === 'string' ? req.body.target_role : '';
  const descriptionValue = req.body?.job_description || req.body?.description;
  const description = typeof descriptionValue === 'string' ? descriptionValue : '';
  const language = typeof req.body?.language === 'string' ? req.body.language : 'English';

  if (!targetRole.trim() || targetRole.length > 255) {
    if (req.file) await fs.unlink(req.file.path).catch(() => undefined);
    return res.status(422).json({ message: 'Validation failed', errors: { target_role: ['A target role is required.'] } });
  }
  if (!description) {
    if (req.file) await fs.unlink(req.file.path).catch(() => undefined);
    return res.status(400).json({ message: 'Job description or goal is required' });
  }
  try {
    let resumeText = '';
    if (req.file) {
      try {
        const parsed = await pdfParse(await fs.readFile(req.file.path));
        resumeText = parsed.text.trim();
      } finally {
        await fs.unlink(req.file.path);
      }
    }

    const analysis = await analyzeSkillGap(
      resumeText || `No resume provided. Analyze based on goal: ${description}`,
      targetRole,
      description,
      language,
    );
    if (!analysis || !Array.isArray(analysis.skill_gaps)) throw new Error('AI returned an invalid skill-gap response.');

    return res.json({
      success: true,
      target_role: targetRole,
      language,
      current_skills: analysis.current_skills || [],
      required_skills: analysis.required_skills || [],
      skill_gaps: analysis.skill_gaps,
      gap_count: analysis.skill_gaps.length,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
