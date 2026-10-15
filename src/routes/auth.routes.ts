import { Request, Router } from 'express';
import { env } from '../config/env';
import {
  findUserByEmail,
  hashPassword,
  issueSanctumToken,
  revokeSanctumToken,
  revokeUserTokens,
  userPayload,
  verifyLaravelPassword,
} from '../data/auth';
import { collection } from '../data/mongo';
import { ObjectId } from 'mongodb';
import { requireAuth } from '../middleware/auth';
import { AuthUser } from '../types';

type AuthenticatedRequest = Request & { user?: AuthUser };

const router = Router();

router.post('/register', async (req, res, next) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : req.body?.name;
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : req.body?.email;
  const { password } = req.body ?? {};

  if (typeof name !== 'string' || !name || name.length > 255 ||
      typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255 ||
      typeof password !== 'string' || password.length < 8) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...(!(typeof name === 'string' && name.length > 0 && name.length <= 255) ? { name: ['The name field is required and may not exceed 255 characters.'] } : {}),
        ...(!(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255) ? { email: ['A valid email address is required.'] } : {}),
        ...(!(typeof password === 'string' && password.length >= 8) ? { password: ['The password must be at least 8 characters.'] } : {}),
      },
    });
  }

  try {
    if (await findUserByEmail(email)) {
      return res.status(422).json({ message: 'Validation error', errors: { email: ['The email has already been taken.'] } });
    }

    const now = new Date();
    const newUser = {
      _id: new ObjectId(),
      name,
      email,
      password: await hashPassword(password),
      role: 'user' as const,
      avatar: null,
      domain: null,
      skills: [],
      location: null,
      created_at: now,
      updated_at: now,
    };

    await collection('users').insertOne(newUser);
    await collection('user_stats').updateOne(
      { user_id: newUser._id.toString() },
      { $setOnInsert: { user_id: newUser._id.toString(), xp: 0, level: 1, streak: 0, badges: [], last_active: now } },
      { upsert: true },
    );
    const token = await issueSanctumToken(newUser);

    return res.status(201).json({
      message: 'User registered successfully',
      user: userPayload(newUser),
      access_token: token,
      refresh_token: token,
      token_type: 'Bearer',
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : req.body?.email;
  const { password } = req.body ?? {};

  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || !password) {
    return res.status(422).json({
      message: 'Validation error',
      errors: {
        ...(!(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ? { email: ['A valid email address is required.'] } : {}),
        ...(!(typeof password === 'string' && password.length > 0) ? { password: ['The password field is required.'] } : {}),
      },
    });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user || !(await verifyLaravelPassword(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const id = user._id.toString();
    await revokeUserTokens(id);
    const token = await issueSanctumToken(user);

    return res.json({
      message: 'Login successful',
      user: userPayload(user),
      access_token: token,
      refresh_token: token,
      token_type: 'Bearer',
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthenticated' });
  }

  return res.json(req.user);
});

router.post('/logout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthenticated' });
  }

  try {
    const tokenId = (req as AuthenticatedRequest & { accessTokenId?: string }).accessTokenId;
    if (tokenId) await revokeSanctumToken(tokenId);
  } catch (error) {
    return next(error);
  }

  return res.json({ message: 'Logged out successfully' });
});

router.post('/refresh', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthenticated' });
  }

  try {
    await revokeUserTokens(req.user.id);
    const user = await collection('users').findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(401).json({ message: 'Unauthenticated' });
    const token = await issueSanctumToken(user as Parameters<typeof issueSanctumToken>[0]);
    return res.json({ access_token: token, refresh_token: token, token_type: 'Bearer' });
  } catch (error) {
    return next(error);
  }
});

router.get('/google', (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URL) {
    return res.status(503).json({ message: 'Google authentication is not configured' });
  }

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URL,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
  });
  return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  const code = String(req.query.code || '');
  if (!code || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URL) {
    return res.redirect(`${env.FRONTEND_URL}/login?error=google_failed`);
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URL,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) throw new Error(`Google token exchange failed with status ${tokenResponse.status}.`);
    const tokenData = await tokenResponse.json() as { access_token?: string };
    if (!tokenData.access_token) throw new Error('Google returned no access token.');

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileResponse.ok) throw new Error(`Google profile request failed with status ${profileResponse.status}.`);
    const profile = await profileResponse.json() as { id?: string; name?: string; email?: string; picture?: string };
    if (!profile.email || !profile.id) throw new Error('Google profile did not contain an email and subject.');

    let user = await findUserByEmail(profile.email);
    const now = new Date();
    if (!user) {
      const newUser = {
        _id: new ObjectId(),
        name: profile.name || profile.email,
        email: profile.email,
        password: await hashPassword(randomGooglePassword()),
        role: 'user' as const,
        avatar: profile.picture || null,
        google_id: profile.id,
        created_at: now,
        updated_at: now,
      };
      await collection('users').insertOne(newUser);
      user = newUser;
      await collection('user_stats').updateOne(
        { user_id: newUser._id.toString() },
        { $setOnInsert: { user_id: newUser._id.toString(), xp: 0, level: 1, streak: 0, badges: [], last_active: now } },
        { upsert: true },
      );
    }

    if (!user) throw new Error('Google account could not be resolved.');
    const token = await issueSanctumToken(user);
    return res.redirect(`${env.FRONTEND_URL}/auth/google/callback?token=${encodeURIComponent(token)}&refresh_token=${encodeURIComponent(token)}`);
  } catch {
    console.error('Google OAuth callback failed.');
    return res.redirect(`${env.FRONTEND_URL}/login?error=google_failed`);
  }
});

export default router;

function randomGooglePassword(): string {
  return `${new ObjectId().toHexString()}_${new ObjectId().toHexString()}`;
}
