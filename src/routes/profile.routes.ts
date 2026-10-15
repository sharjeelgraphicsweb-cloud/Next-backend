import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { collection, idFilter } from '../data/mongo';
import { AuthenticatedRequest } from '../middleware/auth';
import { imageUpload, publicUploadUrl, uploadDirectory } from '../middleware/uploads';

const router = Router();

router.put('/', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });

  const updates: Record<string, string | Date> = { updated_at: new Date() };
  if (req.body?.name !== undefined) {
    if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 255) {
      return res.status(422).json({ errors: { name: ['The name must be a string of at most 255 characters.'] } });
    }
    updates.name = req.body.name.trim();
  }
  try {
    if (req.body?.email !== undefined) {
      const email = typeof req.body.email === 'string' ? req.body.email.trim() : req.body.email;
      if (typeof email !== 'string' || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(422).json({ errors: { email: ['A valid email address is required.'] } });
      }
      const duplicate = await collection('users').findOne({ email });
      if (duplicate && duplicate._id.toString() !== req.user.id) return res.status(422).json({ errors: { email: ['The email has already been taken.'] } });
      updates.email = email;
    }

    await collection('users').updateOne(idFilter(req.user.id), { $set: updates });
    const user = await collection('users').findOne(idFilter(req.user.id), { projection: { password: 0, remember_token: 0 } });
    return res.json({ message: 'Profile updated successfully', user: user ? serialize(user) : null });
  } catch (error) {
    return next(error);
  }
});

router.post('/avatar', imageUpload.single('image'), async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  if (!req.file) {
    return res.status(422).json({ message: 'Validation error', errors: { image: ['An image file is required.'] } });
  }
  const imageUrl = publicUploadUrl(req.file.filename);
  let saved = false;
  try {
    const oldUser = await collection('users').findOne(idFilter(req.user.id), { projection: { avatar: 1 } });
    await collection('users').updateOne(idFilter(req.user.id), { $set: { avatar: imageUrl, updated_at: new Date() } });
    saved = true;
    const user = await collection('users').findOne(idFilter(req.user.id), { projection: { password: 0, remember_token: 0 } });
    if (req.file) await removeLocalUpload(oldUser?.avatar);
    return res.json({ message: 'Avatar uploaded successfully', avatar_url: imageUrl, user: user ? serialize(user) : null });
  } catch (error) {
    if (req.file && !saved) await removeLocalUpload(publicUploadUrl(req.file.filename));
    return next(error);
  }
});

router.delete('/avatar', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  try {
    const oldUser = await collection('users').findOne(idFilter(req.user.id), { projection: { avatar: 1 } });
    await collection('users').updateOne(idFilter(req.user.id), { $set: { avatar: null, updated_at: new Date() } });
    const user = await collection('users').findOne(idFilter(req.user.id), { projection: { password: 0, remember_token: 0 } });
    await removeLocalUpload(oldUser?.avatar);
    return res.json({ message: 'Avatar deleted successfully', user: user ? serialize(user) : null });
  } catch (error) {
    return next(error);
  }
});

router.post('/location', async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Unauthenticated' });
  const rawLat = req.body?.lat;
  const rawLng = req.body?.lng;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (rawLat === '' || rawLat === null || rawLat === undefined || rawLng === '' || rawLng === null || rawLng === undefined) {
    return res.status(422).json({ message: 'Valid latitude and longitude are required' });
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return res.status(422).json({ message: 'Valid latitude and longitude are required' });
  }
  const location = { lat, lng };
  try {
    await collection('users').updateOne(idFilter(req.user.id), { $set: { location, updated_at: new Date() } });
    return res.json({ message: 'Location saved', location });
  } catch (error) {
    return next(error);
  }
});

function serialize(document: Record<string, unknown>): Record<string, unknown> {
  const { _id, password: _password, remember_token: _rememberToken, ...rest } = document;
  return { ...rest, _id: String(_id), id: String(_id) };
}

async function removeLocalUpload(value: unknown): Promise<void> {
  if (typeof value !== 'string' || !value.startsWith('/uploads/')) return;
  const name = path.basename(decodeURIComponent(value.slice('/uploads/'.length)));
  try {
    await fs.unlink(path.join(uploadDirectory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export default router;
