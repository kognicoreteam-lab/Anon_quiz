import { Router } from 'express';
import { isAllowedHostEmail } from '../../src/config/hostAccess.ts';
import type { HostUser } from '../../src/types/quiz.ts';
import { generateId } from '../../src/utils/qrUtils.ts';
import type { DataStore, StoredHostAccount } from '../db/store.ts';
import {
  createRequireHostAuth,
  hashPassword,
  signHostToken,
  verifyPassword,
  type AuthenticatedRequest,
} from '../middleware/auth.ts';
import {
  verifyGoogleFirebaseIdToken,
  type GoogleTokenVerifier,
} from '../middleware/firebaseAuth.ts';

const UNAUTHORIZED_HOST_MSG =
  'Access denied. Only authorized host email accounts are permitted to access Host Mode.';

function toHostUser(account: StoredHostAccount): HostUser {
  return {
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    ...(account.photoURL ? { photoURL: account.photoURL } : {}),
  };
}

export interface AuthRoutesOptions {
  verifyGoogleToken?: GoogleTokenVerifier;
}

export function createAuthRoutes(
  dataStore: DataStore,
  options: AuthRoutesOptions = {}
): Router {
  const router = Router();
  const requireHostAuth = createRequireHostAuth(dataStore);
  const verifyGoogleToken = options.verifyGoogleToken ?? verifyGoogleFirebaseIdToken;

  // Sign in with Google via Firebase ID Token (verified server-side in Node.js)
  router.post('/google', async (req, res) => {
    const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
    if (!idToken) {
      res.status(400).json({ error: 'Missing Google sign-in token.' });
      return;
    }

    try {
      const identity = await verifyGoogleToken(idToken);
      if (!identity.emailVerified) {
        res.status(403).json({
          error: 'Your Google account email must be verified to access Host Mode.',
        });
        return;
      }

      if (!isAllowedHostEmail(identity.email)) {
        res.status(403).json({ error: UNAUTHORIZED_HOST_MSG });
        return;
      }

      const now = Date.now();
      const existing = dataStore.getHostByEmail(identity.email);
      const saved = existing
        ? dataStore.saveHost({
            ...existing,
            displayName: identity.displayName || existing.displayName,
            photoURL: identity.photoURL || existing.photoURL,
            updatedAt: now,
          })
        : dataStore.saveHost({
            uid: generateId('host'),
            email: identity.email,
            displayName: identity.displayName,
            photoURL: identity.photoURL,
            passwordSalt: '',
            passwordHash: '',
            createdAt: now,
            updatedAt: now,
          });

      const user = toHostUser(saved);
      const token = signHostToken(user);
      res.json({ user, token });
    } catch (err) {
      console.error('Google token verification failed:', err);
      res.status(401).json({
        error: 'Unable to verify Google sign-in token. Please try signing in again.',
      });
    }
  });

  // Check whether an authorized host email has already set up a password
  router.post('/check-email', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email || !isAllowedHostEmail(email)) {
      res.status(403).json({ error: UNAUTHORIZED_HOST_MSG });
      return;
    }
    const existing = dataStore.getHostByEmail(email);
    res.json({
      authorized: true,
      registered: Boolean(existing?.passwordHash),
    });
  });

  // First-time password registration for authorized host emails only
  router.post('/register', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const rawName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';

    if (!email || !isAllowedHostEmail(email)) {
      res.status(403).json({ error: UNAUTHORIZED_HOST_MSG });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      return;
    }

    const existing = dataStore.getHostByEmail(email);
    if (existing && existing.passwordHash) {
      res.status(409).json({
        error: 'This authorized host account already has a password. Please switch to Host Sign In.',
      });
      return;
    }

    const { salt, hash } = hashPassword(password);
    const now = Date.now();
    const displayName = (rawName || existing?.displayName || email.split('@')[0] || 'Host').slice(
      0,
      120
    );
    const saved = existing
      ? dataStore.saveHost({
          ...existing,
          displayName,
          passwordSalt: salt,
          passwordHash: hash,
          updatedAt: now,
        })
      : dataStore.saveHost({
          uid: generateId('host'),
          email,
          displayName,
          passwordSalt: salt,
          passwordHash: hash,
          createdAt: now,
          updatedAt: now,
        });

    const user = toHostUser(saved);
    const token = signHostToken(user);

    res.status(201).json({ user, token });
  });

  // Sign in for authorized host emails
  router.post('/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !isAllowedHostEmail(email)) {
      res.status(403).json({ error: UNAUTHORIZED_HOST_MSG });
      return;
    }

    if (!password) {
      res.status(400).json({ error: 'Enter your host password.' });
      return;
    }

    const account = dataStore.getHostByEmail(email);
    if (!account || !account.passwordHash) {
      res.status(404).json({
        code: 'HOST_NOT_REGISTERED',
        error: account
          ? 'This host account uses Google Sign-In. Click "Continue with Google" or switch to "First-Time Setup" to also add a password.'
          : 'This authorized host email has not set a password yet. Switch to "First-Time Setup" to create your host password.',
      });
      return;
    }

    if (!verifyPassword(password, account.passwordSalt, account.passwordHash)) {
      res.status(401).json({ error: 'Incorrect password. Please try again.' });
      return;
    }

    const user = toHostUser(account);
    const token = signHostToken(user);

    res.json({ user, token });
  });

  // Validate current session token
  router.get('/me', requireHostAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.hostUser });
  });

  router.post('/logout', (_req, res) => {
    res.json({ ok: true });
  });

  return router;
}
