import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export interface VerifiedGoogleIdentity {
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  photoURL?: string;
}

export type GoogleTokenVerifier = (idToken: string) => Promise<VerifiedGoogleIdentity>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFirebaseProjectId(): string {
  const configPath = path.resolve(__dirname, '../../firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as { projectId?: string };
  if (!parsed.projectId || parsed.projectId === 'remixed-project-id') {
    throw new Error('Firebase projectId is not configured in firebase-applet-config.json.');
  }
  return parsed.projectId;
}

function getFirebaseAdminAuth() {
  const projectId = loadFirebaseProjectId();
  const app = getApps().length ? getApp() : initializeApp({ projectId });
  return getAuth(app);
}

/**
 * Verifies a client-side Firebase Google ID token using only the projectId (no IAM required).
 */
export async function verifyGoogleFirebaseIdToken(
  idToken: string
): Promise<VerifiedGoogleIdentity> {
  const decoded = await getFirebaseAdminAuth().verifyIdToken(idToken);
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  const displayName =
    typeof decoded.name === 'string' && decoded.name.trim()
      ? decoded.name.trim().slice(0, 120)
      : email.split('@')[0] || 'Host';
  const photoURL =
    typeof decoded.picture === 'string' && decoded.picture.trim()
      ? decoded.picture.trim().slice(0, 500)
      : undefined;

  return {
    firebaseUid: decoded.uid,
    email,
    emailVerified: Boolean(decoded.email_verified),
    displayName,
    photoURL,
  };
}
