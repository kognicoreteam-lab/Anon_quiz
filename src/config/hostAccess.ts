/**
 * Authorized host email allowlist.
 * Must stay synchronized with isVerifiedHost() in firestore.rules.
 */
export const ALLOWED_HOST_EMAILS: readonly string[] = [
  'sharveshragavendra252@gmail.com',
  'senthilkumarp@bitsathy.ac.in',
];

export function isAllowedHostEmail(email: string | null | undefined): boolean {
  if (!email || typeof email !== 'string') return false;
  return ALLOWED_HOST_EMAILS.includes(email.trim().toLowerCase());
}
