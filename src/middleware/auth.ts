import { NextFunction, Request, Response } from 'express';
import { resolveSanctumToken } from '../data/auth';
import { AuthUser } from '../types';

export type AuthenticatedRequest = Request & { user?: AuthUser; accessTokenId?: string };

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Unauthenticated' });
    return;
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    res.status(401).json({ message: 'Unauthenticated' });
    return;
  }

  try {
    const resolved = await resolveSanctumToken(token);
    if (!resolved) {
      res.status(401).json({ message: 'Unauthenticated' });
      return;
    }

    req.user = {
      id: resolved.user._id.toString(),
      name: resolved.user.name,
      email: resolved.user.email,
      role: resolved.user.role || 'user',
      avatar: resolved.user.avatar ?? null,
    };
    req.accessTokenId = resolved.tokenId;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ message: 'Forbidden. Admin access required.' });
    return;
  }

  next();
}
