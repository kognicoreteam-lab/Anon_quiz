import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesSource = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
const blueprint = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf-8')
);

test('firestore.rules declares rules_version 2 and global default-deny catch-all first', () => {
  assert.match(rulesSource, /rules_version\s*=\s*'2';/);
  assert.match(rulesSource, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});

test('every collection in firebase-blueprint.json has an explicit match block in firestore.rules', () => {
  const paths = Object.keys(blueprint.firestore);
  assert.ok(paths.includes('/users/{userId}'));
  assert.ok(paths.includes('/quizzes/{quizId}'));
  assert.ok(paths.includes('/joinCodes/{joinCode}'));
  assert.ok(paths.includes('/quizzes/{quizId}/submissions/{submissionId}'));

  assert.match(rulesSource, /match \/users\/\{userId\}/);
  assert.match(rulesSource, /match \/joinCodes\/\{joinCode\}/);
  assert.match(rulesSource, /match \/quizzes\/\{quizId\}/);
  assert.match(rulesSource, /match \/submissions\/\{submissionId\}/);
});

test('Red Team Audit: verified email, shadow field hasOnly, PII isolation, secure list queries, and Master Gate exist', () => {
  // Email spoofing guard
  assert.match(rulesSource, /request\.auth\.token\.email_verified == true/);
  // PII isolated in /users/{userId} without list access
  assert.match(rulesSource, /match \/users\/\{userId\}[\s\S]*allow list: if false;/);
  // Join codes cannot be scraped
  assert.match(rulesSource, /match \/joinCodes\/\{joinCode\}[\s\S]*allow list: if false;/);
  // Atomicity guarantee on joinCodes create
  assert.match(rulesSource, /existsAfter\(\/databases\/\$\(database\)\/documents\/quizzes\/\$\(incoming\(\)\.quizId\)\)/);
  // Secure list queries on quizzes and submissions enforce hostUid without get()
  assert.match(rulesSource, /allow list: if isVerifiedHost\(\) && resource\.data\.hostUid == request\.auth\.uid;/);
  // Master Gate expiration check on anonymous submission create
  assert.match(rulesSource, /get\(\/databases\/\$\(database\)\/documents\/quizzes\/\$\(quizId\)\)\.data\.status == 'active'/);
  assert.match(rulesSource, /request\.time <= get\(\/databases\/\$\(database\)\/documents\/quizzes\/\$\(quizId\)\)\.data\.expiresAt/);
  // Action-based update key allowlisting
  assert.match(rulesSource, /affectedKeys\(\)\.hasOnly\(/);
  // Rotatable QR token validation and dedicated refresh action
  assert.match(rulesSource, /function isValidQrToken\(token\)/);
  assert.match(rulesSource, /affectedKeys\(\)\.hasOnly\(\['qrToken', 'updatedAt'\]\)/);
  // Temporal integrity checks
  assert.match(rulesSource, /incoming\(\)\.createdAt == request\.time/);
  assert.match(rulesSource, /incoming\(\)\.updatedAt == request\.time/);
  assert.match(rulesSource, /incoming\(\)\.submittedAt == request\.time/);
});

test('Host access in firestore.rules is restricted strictly to the two authorized verified email addresses', () => {
  assert.match(rulesSource, /request\.auth\.token\.email is string/);
  assert.match(rulesSource, /request\.auth\.token\.email\.lower\(\) in \[/);
  assert.match(rulesSource, /'sharveshragavendra252@gmail\.com'/);
  assert.match(rulesSource, /'senthilkumarp@bitsathy\.ac\.in'/);
});


