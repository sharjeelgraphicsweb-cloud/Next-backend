import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { collection } from '../data/mongo';
import { ensureUserStats } from '../data/stats';
import { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

router.get('/leaderboard', async (req: AuthenticatedRequest, res, next) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
  try {
    const stats = await collection('user_stats').find({}).sort({ xp: -1 }).limit(limit).toArray();
    const users = await collection('users').find(
      { _id: { $in: stats.map((stat) => toMongoId(String(stat.user_id || ''))) } },
      { projection: { name: 1, avatar: 1 } },
    ).toArray();
    const userMap = new Map(users.map((user) => [user._id.toString(), user]));
    return res.json(stats.map((stat, index) => {
      const user = userMap.get(String(stat.user_id));
      return {
        rank: index + 1,
        name: user?.name || 'Unknown',
        avatar: user?.avatar || null,
        xp: stat.xp || 0,
        level: stat.level || 1,
        streak: stat.streak || 0,
      };
    }));
  } catch (error) {
    return next(error);
  }
});

router.get('/badges', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const stats = await ensureUserStats(req.user.id);
    const badges = (stats.badges || []).map((badge: string) => ({
      name: badge,
      icon: '🏆',
      earned_at: new Date().toISOString().slice(0, 10),
    }));
    return res.json(badges);
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const stats = await ensureUserStats(req.user.id);
    const xp = Number(stats.xp || 0);
    const level = Number(stats.level || 1);
    const badges = stats.badges || [];
    return res.json({
      xp,
      level,
      streak: stats.streak || 0,
      badges_count: badges.length,
      badges,
      xp_to_next: level * 100 - xp,
      last_active: stats.last_active,
    });
  } catch (error) {
    return next(error);
  }
});

function toMongoId(id: string) {
  if (!id) return id;
  return ObjectId.isValid(id) ? new ObjectId(id) : id;
}

export default router;
