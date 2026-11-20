import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApiApp } from '../app.ts';
import { DataStore } from '../db/store.ts';
import { RealtimeEventBus } from '../realtime/eventBus.ts';

async function createTestServer() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anonquiz-test-'));
  const dbPath = path.join(tmpDir, 'db.json');
  const dataStore = new DataStore(dbPath);
  const bus = new RealtimeEventBus();
  const app = createApiApp({ dataStore, bus });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const close = async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { baseUrl, close };
}

test('Node.js API enforces strict 2-email host allowlist on register and login', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const deniedRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'random.person@gmail.com',
        password: 'password123',
      }),
    });
    assert.equal(deniedRes.status, 403);

    const allowedRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'SENTHILKUMARP@bitsathy.ac.in',
        password: 'hostpassword123',
        displayName: 'Prof. Senthil',
      }),
    });
    assert.equal(allowedRes.status, 201);
    const body = (await allowedRes.json()) as { token: string; user: { email: string } };
    assert.ok(body.token);
    assert.equal(body.user.email, 'senthilkumarp@bitsathy.ac.in');

    // Verify /api/auth/me succeeds with Bearer token
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    assert.equal(meRes.status, 200);
  } finally {
    await close();
  }
});

test('Full end-to-end quiz lifecycle: create, launch QR, rotate QR, anonymous submit, and host grading', async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // 1. Register authorized host
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sharveshragavendra252@gmail.com',
        password: 'securePassword!',
      }),
    });
    assert.equal(regRes.status, 201);
    const { token } = (await regRes.json()) as { token: string };
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 2. Create sample quiz (MCQ + short_answer + paragraph)
    const createRes = await fetch(`${baseUrl}/api/host/quizzes/sample`, {
      method: 'POST',
      headers: authHeaders,
    });
    assert.equal(createRes.status, 201);
    const { quiz } = (await createRes.json()) as {
      quiz: {
        id: string;
        joinCode: string;
        questions: Array<{ id: string; type: string; points: number }>;
      };
    };
    assert.equal(quiz.questions.length, 3);

    // 3. Launch quiz and capture fresh QR token
    const launchRes = await fetch(`${baseUrl}/api/host/quizzes/${quiz.id}/launch`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ durationMinutes: 15 }),
    });
    assert.equal(launchRes.status, 200);
    const launched = (await launchRes.json()) as { qrToken: string };
    assert.ok(launched.qrToken.startsWith('qr_'));

    // 4. Rotate QR token and ensure old QR is rejected while new QR passes
    const rotRes = await fetch(`${baseUrl}/api/host/quizzes/${quiz.id}/regenerate-qr`, {
      method: 'POST',
      headers: authHeaders,
    });
    assert.equal(rotRes.status, 200);
    const rotated = (await rotRes.json()) as { qrToken: string };
    assert.notEqual(rotated.qrToken, launched.qrToken);

    const oldQrCheck = await fetch(`${baseUrl}/api/public/verify-qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId: quiz.id, qrToken: launched.qrToken }),
    });
    assert.equal(((await oldQrCheck.json()) as { status: string }).status, 'superseded');

    const newQrCheck = await fetch(`${baseUrl}/api/public/verify-qr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId: quiz.id, qrToken: rotated.qrToken }),
    });
    assert.equal(((await newQrCheck.json()) as { status: string }).status, 'valid');

    // 5. Public lookup strips correctAnswer
    const joinRes = await fetch(`${baseUrl}/api/public/join/${quiz.joinCode}`);
    assert.equal(joinRes.status, 200);
    const { quiz: publicQuiz } = (await joinRes.json()) as {
      quiz: { questions: Array<Record<string, unknown>> };
    };
    assert.equal('correctAnswer' in publicQuiz.questions[0], false);

    // 6. Anonymous participant submits answers (MCQ + short_answer + paragraph)
    const [qMcq, qShort, qPara] = quiz.questions;
    const submitRes = await fetch(`${baseUrl}/api/public/quizzes/${quiz.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionToken: 'anon_tok_e2e_1',
        anonId: 'Anon-4242',
        answers: {
          [qMcq.id]: [1],
          [qShort.id]: 'Spreads out retries to avoid thundering herd.',
          [qPara.id]: 'Strong consistency suits banking; eventual consistency suits social feeds.',
        },
      }),
    });
    assert.equal(submitRes.status, 201);
    const submitted = (await submitRes.json()) as {
      result: { submission: { totalScore: number; reviewStatus: string } };
    };
    assert.equal(submitted.result.submission.totalScore, 2);
    assert.equal(submitted.result.submission.reviewStatus, 'pending');

    // 7. Host publishes manual marks for short_answer and paragraph
    const gradeRes = await fetch(
      `${baseUrl}/api/host/quizzes/${quiz.id}/submissions/anon_tok_e2e_1/grade`,
      {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          grading: {
            [qMcq.id]: { outcome: 'correct', pointsAwarded: 2, feedback: '' },
            [qShort.id]: { outcome: 'correct', pointsAwarded: 3, feedback: 'Spot on.' },
            [qPara.id]: { outcome: 'partial', pointsAwarded: 4, feedback: 'Great examples!' },
          },
        }),
      }
    );
    assert.equal(gradeRes.status, 200);

    // 8. Participant views updated marks awarded by host
    const marksRes = await fetch(
      `${baseUrl}/api/public/quizzes/${quiz.id}/submissions/anon_tok_e2e_1`
    );
    assert.equal(marksRes.status, 200);
    const marksBody = (await marksRes.json()) as {
      found: boolean;
      result: { submission: { totalScore: number; maxScore: number; reviewStatus: string } };
    };
    assert.equal(marksBody.found, true);
    assert.equal(marksBody.result.submission.totalScore, 9);
    assert.equal(marksBody.result.submission.maxScore, 10);
    assert.equal(marksBody.result.submission.reviewStatus, 'reviewed');
  } finally {
    await close();
  }
});

test('POST /api/auth/google verifies ID token, enforces 2-email allowlist, and links with password account', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anonquiz-google-test-'));
  const dbPath = path.join(tmpDir, 'db.json');
  const dataStore = new DataStore(dbPath);
  const bus = new RealtimeEventBus();

  const app = createApiApp({
    dataStore,
    bus,
    verifyGoogleToken: async (idToken: string) => {
      if (idToken === 'valid-allowed-token') {
        return {
          firebaseUid: 'fb_1',
          email: 'sharveshragavendra252@gmail.com',
          emailVerified: true,
          displayName: 'Sharvesh',
          photoURL: 'https://example.com/avatar.png',
        };
      }
      if (idToken === 'unverified-token') {
        return {
          firebaseUid: 'fb_2',
          email: 'sharveshragavendra252@gmail.com',
          emailVerified: false,
          displayName: 'Sharvesh',
        };
      }
      return {
        firebaseUid: 'fb_3',
        email: 'outsider@gmail.com',
        emailVerified: true,
        displayName: 'Outsider',
      };
    },
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // 1. Unauthorized Google email rejected with 403
    const denied = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'outsider-token' }),
    });
    assert.equal(denied.status, 403);

    // 2. Unverified Google email rejected with 403
    const unverified = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'unverified-token' }),
    });
    assert.equal(unverified.status, 403);

    // 3. Authorized Google email succeeds and returns Node.js Bearer token
    const okRes = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'valid-allowed-token' }),
    });
    assert.equal(okRes.status, 200);
    const googleSession = (await okRes.json()) as {
      token: string;
      user: { uid: string; email: string; photoURL?: string };
    };
    assert.equal(googleSession.user.email, 'sharveshragavendra252@gmail.com');
    assert.equal(googleSession.user.photoURL, 'https://example.com/avatar.png');

    // 4. Same host can also add a password via /api/auth/register and keeps the exact same uid
    const addPwRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'sharveshragavendra252@gmail.com',
        password: 'myBackupPassword123',
      }),
    });
    assert.equal(addPwRes.status, 201);
    const pwSession = (await addPwRes.json()) as { user: { uid: string } };
    assert.equal(pwSession.user.uid, googleSession.user.uid);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

