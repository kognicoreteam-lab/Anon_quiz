import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { isAllowedHostEmail } from '../../src/config/hostAccess.ts';
import type { HostUser } from '../../src/types/quiz.ts';
import type { DataStore } from '../db/store.ts';

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getAuthSecret(): string {
  return process.env.SESSION_SECRET || 'anonquiz-dev-session-secret-change-in-prod';
}

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

interface TokenPayload {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  exp: number;
}

export function signHostToken(user: HostUser): string {
  const payload: TokenPayload = {
    uid: user.uid,
    email: user.email.trim().toLowerCase(),
    displayName: user.displayName,
    ...(user.photoURL ? { photoURL: user.photoURL } : {}),
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyHostToken(token: string): HostUser | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getAuthSecret())
    .update(encodedPayload)
    .digest('base64url');

  const sigBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as TokenPayload;
    if (!parsed.uid || !parsed.email || typeof parsed.exp !== 'number') return null;
    if (Date.now() > parsed.exp) return null;
    if (!isAllowedHostEmail(parsed.email)) return null;
    return {
      uid: parsed.uid,
      email: parsed.email,
      displayName: parsed.displayName || parsed.email.split('@')[0] || 'Host',
      ...(parsed.photoURL ? { photoURL: parsed.photoURL } : {}),
    };
  } catch {
    return null;
  }
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }
  return null;
}

export interface AuthenticatedRequest extends Request {
  hostUser?: HostUser;
}

export function createRequireHostAuth(dataStore: DataStore) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = extractTokenFromRequest(req);
    if (!token) {
      res.status(401).json({ error: 'Host authentication required. Please sign in.' });
      return;
    }

    const decoded = verifyHostToken(token);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid or expired host session. Please sign in again.' });
      return;
    }

    if (!isAllowedHostEmail(decoded.email)) {
      res.status(403).json({
        error: 'Access denied. Only authorized host email accounts are permitted to access Host Mode.',
      });
      return;
    }

    const stored = dataStore.getHostByUid(decoded.uid);
    if (!stored) {
      res.status(401).json({ error: 'Host account not found. Please sign in again.' });
      return;
    }

    req.hostUser = {
      uid: stored.uid,
      email: stored.email,
      displayName: stored.displayName,
      ...(stored.photoURL ? { photoURL: stored.photoURL } : {}),
    };
    next();
  };
}
