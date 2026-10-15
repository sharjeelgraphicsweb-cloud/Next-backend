import { Document } from 'mongodb';
import { collection } from './mongo';

export async function ensureUserStats(userId: string): Promise<Document> {
  const stats = collection('user_stats');
  const now = new Date();
  await stats.updateOne(
    { user_id: userId },
    { $setOnInsert: { user_id: userId, xp: 0, level: 1, streak: 0, last_active: now, badges: [] } },
    { upsert: true },
  );
  const record = await stats.findOne({ user_id: userId });
  if (!record) throw new Error(`User stats could not be initialized for user ${userId}.`);
  return record;
}

export async function awardXp(userId: string, amount: number): Promise<void> {
  const stats = collection('user_stats');
  await stats.updateOne(
    { user_id: userId },
    {
      $setOnInsert: { user_id: userId, level: 1, streak: 0, badges: [] },
      $inc: { xp: amount },
      $set: { last_active: new Date() },
    },
    { upsert: true },
  );
  const record = await stats.findOne({ user_id: userId });
  if (record) {
    const xp = Number(record.xp || 0);
    await stats.updateOne({ _id: record._id }, { $set: { level: Math.floor(xp / 100) + 1 } });
  }
}
