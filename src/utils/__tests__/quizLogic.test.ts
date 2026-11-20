import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHostEmail } from '../../config/hostAccess.ts';
import {
  buildHostQuizQrValue,
  generateJoinCode,
  generateQrToken,
  normalizeJoinCode,
  parseAndValidateHostQrPayload,
} from '../qrUtils.ts';
import { computeEffectiveQuizStatus, formatCountdown } from '../timeUtils.ts';
import {
  autoGradeSubmission,
  calculateScorePercent,
  countWords,
  finalizeManualGrading,
  formatQuestionTypeLabel,
  recalculateSubmissionAfterKeyChange,
  summarizeMarksBreakdown,
  validateQuizDraft,
} from '../gradingUtils.ts';
import type { QuizQuestion, QuizSubmission } from '../../types/quiz.ts';

const sampleQuestions: QuizQuestion[] = [
  {
    id: 'q1',
    type: 'mcq',
    text: 'Which protocol powers real-time server push over HTTP?',
    options: ['FTP', 'Server-Sent Events', 'SMTP', 'SNMP'],
    correctAnswer: [1],
    points: 2,
  },
  {
    id: 'q2',
    type: 'mcq',
    text: 'Select all HTTP idempotent methods.',
    options: ['GET', 'POST', 'PUT', 'DELETE'],
    correctAnswer: [0, 2, 3],
    points: 3,
  },
  {
    id: 'q3',
    type: 'short_answer',
    text: 'Explain why idempotency matters in distributed systems.',
    options: [],
    correctAnswer: 'Safe retries without duplicate side effects.',
    points: 5,
  },
  {
    id: 'q4',
    type: 'paragraph',
    text: 'Compare eventual consistency and strong consistency with a real-world trade-off.',
    options: [],
    correctAnswer: 'Discusses CAP trade-offs, latency vs staleness, and gives a concrete system example.',
    points: 10,
  },
];

test('generateJoinCode creates a 6-character unambiguous alphanumeric code', () => {
  const code = generateJoinCode();
  assert.equal(code.length, 6);
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(normalizeJoinCode(' q7x-4m9 '), 'Q7X4M9');
});

test('computeEffectiveQuizStatus transitions active quiz to expired once expiresAt passes', () => {
  const now = 1_700_000_000_000;
  assert.equal(computeEffectiveQuizStatus({ status: 'draft', expiresAt: null }, now), 'draft');
  assert.equal(computeEffectiveQuizStatus({ status: 'active', expiresAt: now + 60_000 }, now), 'active');
  assert.equal(computeEffectiveQuizStatus({ status: 'active', expiresAt: now - 1 }, now), 'expired');
  assert.equal(computeEffectiveQuizStatus({ status: 'expired', expiresAt: now + 60_000 }, now), 'expired');
});

test('formatCountdown formats minutes, hours, and clamps at 00:00', () => {
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-5000), '00:00');
  assert.equal(formatCountdown(90_000), '01:30');
  assert.equal(formatCountdown(3_665_000), '01:01:05');
});

test('autoGradeSubmission grades single/multi MCQ accurately and marks short_answer and paragraph as pending', () => {
  const result = autoGradeSubmission(sampleQuestions, {
    q1: [1],
    q2: [0, 3, 2],
    q3: 'Allows clients to retry failed requests safely.',
    q4: 'Strong consistency guarantees every read sees the most recent write.\n\nEventual consistency prioritizes availability and lower latency during partitions.',
  });

  assert.equal(result.totalScore, 5);
  assert.equal(result.maxScore, 20);
  assert.equal(result.reviewStatus, 'pending');
  assert.equal(result.grading.q1.outcome, 'correct');
  assert.equal(result.grading.q2.outcome, 'correct');
  assert.equal(result.grading.q3.outcome, 'pending');
  assert.equal(result.grading.q4.outcome, 'pending');

  const breakdown = summarizeMarksBreakdown(sampleQuestions, result.grading);
  assert.equal(breakdown.mcqEarned, 5);
  assert.equal(breakdown.mcqMax, 5);
  assert.equal(breakdown.manualEarned, 0);
  assert.equal(breakdown.manualMax, 15);
  assert.equal(breakdown.pendingManualCount, 2);
  assert.equal(breakdown.reviewedManualCount, 0);
});

test('autoGradeSubmission marks auto_graded when quiz has only MCQs', () => {
  const mcqOnly = sampleQuestions.slice(0, 2);
  const result = autoGradeSubmission(mcqOnly, {
    q1: [0],
    q2: [0, 2, 3],
  });
  assert.equal(result.totalScore, 3);
  assert.equal(result.maxScore, 5);
  assert.equal(result.reviewStatus, 'auto_graded');
  assert.equal(calculateScorePercent(result.totalScore, result.maxScore), 60);
});

test('finalizeManualGrading clamps partial credit across short_answer and paragraph and updates marks breakdown', () => {
  const manual = finalizeManualGrading(sampleQuestions, {
    q1: { outcome: 'correct', pointsAwarded: 2, feedback: 'Spot on.' },
    q2: { outcome: 'partial', pointsAwarded: 1.5, feedback: 'Missed DELETE.' },
    q3: { outcome: 'correct', pointsAwarded: 99, feedback: 'Excellent clarity!' },
    q4: { outcome: 'partial', pointsAwarded: 8.5, feedback: 'Strong CAP trade-off explanation.' },
  });

  assert.equal(manual.totalScore, 17);
  assert.equal(manual.maxScore, 20);
  assert.equal(manual.reviewStatus, 'reviewed');
  assert.equal(manual.grading.q3.pointsAwarded, 5);
  assert.equal(manual.grading.q4.pointsAwarded, 8.5);
  assert.equal(manual.grading.q4.outcome, 'partial');

  const breakdown = summarizeMarksBreakdown(sampleQuestions, manual.grading);
  assert.equal(breakdown.mcqEarned, 3.5);
  assert.equal(breakdown.manualEarned, 13.5);
  assert.equal(breakdown.pendingManualCount, 0);
  assert.equal(breakdown.reviewedManualCount, 2);
});

test('recalculateSubmissionAfterKeyChange updates MCQ scores while preserving manual short-answer and paragraph grades', () => {
  const submission: QuizSubmission = {
    id: 'sub_1',
    quizId: 'quiz_1',
    hostUid: 'host_1',
    sessionToken: 'tok_1',
    anonId: 'Anon-4821',
    submittedAt: Date.now(),
    answers: {
      q1: [0],
      q2: [0, 2, 3],
      q3: 'Safe retries.',
      q4: 'Multi-paragraph architecture comparison...',
    },
    grading: {
      q1: { outcome: 'incorrect', isCorrect: false, pointsAwarded: 0, feedback: '' },
      q2: { outcome: 'correct', isCorrect: true, pointsAwarded: 3, feedback: '' },
      q3: { outcome: 'partial', isCorrect: false, pointsAwarded: 4, feedback: 'Good start', manuallyGraded: true },
      q4: { outcome: 'correct', isCorrect: true, pointsAwarded: 9, feedback: 'Well structured', manuallyGraded: true },
    },
    totalScore: 16,
    maxScore: 20,
    reviewStatus: 'reviewed',
  };

  const updatedQuestions: QuizQuestion[] = sampleQuestions.map((q) =>
    q.id === 'q1' ? { ...q, correctAnswer: [0] } : q
  );

  const recalc = recalculateSubmissionAfterKeyChange(updatedQuestions, submission);
  assert.equal(recalc.grading.q1.outcome, 'correct');
  assert.equal(recalc.grading.q1.pointsAwarded, 2);
  assert.equal(recalc.grading.q3.pointsAwarded, 4);
  assert.equal(recalc.grading.q3.feedback, 'Good start');
  assert.equal(recalc.grading.q4.pointsAwarded, 9);
  assert.equal(recalc.grading.q4.feedback, 'Well structured');
  assert.equal(recalc.totalScore, 18);
  assert.equal(recalc.reviewStatus, 'reviewed');
});

test('validateQuizDraft rejects empty titles, blank options, and accepts paragraph questions', () => {
  const invalid = validateQuizDraft({
    title: 'A',
    questions: [
      {
        id: 'q1',
        type: 'mcq',
        text: '',
        options: ['A', '', 'C', 'D'],
        correctAnswer: [],
        points: 0,
      },
    ],
  });

  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 4);

  const valid = validateQuizDraft({
    title: 'Systems Architecture Check-In',
    questions: sampleQuestions,
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.errors.length, 0);
  assert.equal(formatQuestionTypeLabel('paragraph'), 'Paragraph');
  assert.equal(countWords('Hello   world\nfrom AnonQuiz'), 4);
});

test('host QR payload builder and strict parser accept only official AnonQuiz host QRs', () => {
  const token = generateQrToken();
  assert.match(token, /^[a-zA-Z0-9_-]{12,64}$/);

  const qrUrl = buildHostQuizQrValue('https://anonquiz.example.com/', 'quiz_abc123', token);
  const parsed = parseAndValidateHostQrPayload(qrUrl);
  assert.equal(parsed.valid, true);
  if (parsed.valid) {
    assert.equal(parsed.quizId, 'quiz_abc123');
    assert.equal(parsed.qrToken, token);
  }

  assert.equal(parseAndValidateHostQrPayload('https://google.com/search?q=quiz').valid, false);
  assert.equal(parseAndValidateHostQrPayload('WIFI:T:WPA;S:OfficeNet;P:secret;;').valid, false);
  assert.equal(
    parseAndValidateHostQrPayload(`https://anonquiz.example.com/quiz/quiz_abc123?qr=${token}`).valid,
    false
  );
  assert.equal(
    parseAndValidateHostQrPayload('https://anonquiz.example.com/quiz/quiz_abc123?qr=short&app=anonquiz').valid,
    false
  );
});

test('isAllowedHostEmail permits only the two authorized host emails case-insensitively', () => {
  assert.equal(isAllowedHostEmail('sharveshragavendra252@gmail.com'), true);
  assert.equal(isAllowedHostEmail('SharveshRagavendra252@GMAIL.COM'), true);
  assert.equal(isAllowedHostEmail('SENTHILKUMARP@bitsathy.ac.in'), true);
  assert.equal(isAllowedHostEmail('senthilkumarp@bitsathy.ac.in'), true);
  assert.equal(isAllowedHostEmail('  SENTHILKUMARP@bitsathy.ac.in  '), true);

  assert.equal(isAllowedHostEmail('other@gmail.com'), false);
  assert.equal(isAllowedHostEmail('senthilkumarp@gmail.com'), false);
  assert.equal(isAllowedHostEmail(''), false);
  assert.equal(isAllowedHostEmail(null), false);
  assert.equal(isAllowedHostEmail(undefined), false);
});
