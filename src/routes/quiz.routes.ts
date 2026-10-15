import { Router } from 'express';
import { collection, mongoId } from '../data/mongo';
import { awardXp } from '../data/stats';
import { AuthenticatedRequest } from '../middleware/auth';
import { generateQuiz } from '../services/gemini';

const router = Router();

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  const videoId = String(req.query.video_id || '');
  const videoTitle = String(req.query.video_title || '');
  const skillName = String(req.query.skill_name || '');
  if (!videoId || !videoTitle || !skillName) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...(!videoId ? { video_id: ['The video_id field is required.'] } : {}),
        ...(!videoTitle ? { video_title: ['The video_title field is required.'] } : {}),
        ...(!skillName ? { skill_name: ['The skill_name field is required.'] } : {}),
      },
    });
  }

  try {
    let quiz = await collection('quizzes').findOne({ video_id: videoId });
    if (!quiz) {
      const questions = await generateQuiz(videoTitle, skillName);
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(500).json({ message: 'AI failed to generate quiz. Please try again.' });
      }
      const now = new Date();
      const quizData = { video_id: videoId, video_title: videoTitle, skill_name: skillName, questions, created_at: now, updated_at: now };
      const inserted = await collection('quizzes').insertOne(quizData);
      quiz = { ...quizData, _id: inserted.insertedId };
    }
    const questions = (quiz.questions || []).map((question: Record<string, unknown>) => {
      const { correct_answer: _answer, explanation: _explanation, ...safeQuestion } = question;
      return safeQuestion;
    });
    return res.json({ success: true, data: { id: quiz._id.toString(), questions } });
  } catch (error) {
    return next(error);
  }
});

router.post('/submit', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const quizId = String(req.body?.quiz_id || '');
  const progressId = String(req.body?.progress_id || '');
  const nodeId = String(req.body?.node_id ?? '');
  const answers = req.body?.answers;
  if (!quizId || !progressId || !nodeId || !Array.isArray(answers)) {
    return res.status(422).json({ message: 'Validation error', errors: { quiz_id: ['quiz_id, answers, progress_id and node_id are required.'] } });
  }

  try {
    const quiz = await collection('quizzes').findOne({ _id: mongoId(quizId) });
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    let score = 0;
    const results = (quiz.questions || []).map((question: Record<string, any>, index: number) => {
      const userAnswer = typeof answers[index] === 'string' ? answers[index] : '';
      const isCorrect = userAnswer === question.correct_answer;
      if (isCorrect) score += 1;
      return {
        question: question.question,
        user_answer: userAnswer,
        correct_answer: question.correct_answer,
        explanation: question.explanation,
        is_correct: isCorrect,
      };
    });
    const total = results.length;
    const percentage = total > 0 ? (score / total) * 100 : 0;
    const passed = percentage >= 70;
    if (passed) {
      const progress = await collection('progress').findOne({ _id: mongoId(progressId), user_id: req.user.id });
      if (progress) {
        const passedQuizzes: string[] = progress.passed_quizzes || [];
        const firstPass = !passedQuizzes.includes(String(quiz.video_id));
        if (firstPass) {
          passedQuizzes.push(String(quiz.video_id));
          await collection('progress').updateOne(
            { _id: progress._id },
            { $set: { passed_quizzes: passedQuizzes, updated_at: new Date() } },
          );
          await awardXp(req.user.id, 30);
        }
      }
    }

    return res.json({ success: true, data: { score, total, percentage, passed, results } });
  } catch (error) {
    return next(error);
  }
});

export default router;
