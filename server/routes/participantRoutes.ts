import { Router } from 'express';
import type { QuizSubmission, SubmissionResultPayload, UserAnswerValue } from '../../src/types/quiz.ts';
import { autoGradeSubmission, isChoiceQuestionType } from '../../src/utils/gradingUtils.ts';
import { aggregatePollResults } from '../../src/utils/pollUtils.ts';
import { generateAnonId, normalizeJoinCode } from '../../src/utils/qrUtils.ts';
import { computeEffectiveQuizStatus } from '../../src/utils/timeUtils.ts';
import {
  MAX_ALIAS_LEN,
  MAX_ANON_ID_LEN,
  normalizeSessionMode,
  toPublicQuizView,
} from '../../src/services/mappers.ts';
import type { DataStore } from '../db/store.ts';
import { hostChannel, pollChannel, type RealtimeEventBus } from '../realtime/eventBus.ts';

function buildResultPayload(
  quiz: ReturnType<DataStore['getQuizById']>,
  submission: QuizSubmission
): SubmissionResultPayload {
  const q = quiz!;
  return {
    quiz: {
      id: q.id,
      mode: normalizeSessionMode(q.mode),
      title: q.title,
      description: q.description,
      joinCode: q.joinCode,
      status: q.status,
      expiresAt: q.expiresAt,
      questions: q.questions,
    },
    submission,
  };
}

export function createParticipantRoutes(dataStore: DataStore, bus: RealtimeEventBus): Router {
  const router = Router();

  // Look up quiz or poll by 6-character join code (returns answer-key-stripped PublicQuizView)
  router.get('/join/:code', (req, res) => {
    const normalized = normalizeJoinCode(req.params.code || '');
    if (normalized.length !== 6) {
      res.status(400).json({ error: 'Enter a valid 6-character session code.' });
      return;
    }

    const quiz = dataStore.getQuizByJoinCode(normalized);
    if (!quiz) {
      res.status(404).json({
        error: 'No quiz or poll found with that code. Check the code and try again.',
      });
      return;
    }

    res.json({ quiz: toPublicQuizView(quiz) });
  });

  // Fetch public quiz/poll view by ID (never exposes correctAnswer before submission)
  router.get('/quizzes/:quizId', (req, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz) {
      res.status(404).json({ error: 'We could not find a session matching this link.' });
      return;
    }

    res.json({ quiz: toPublicQuizView(quiz) });
  });

  // Public aggregate numerical & graphical poll results (anonymous totals only)
  router.get('/quizzes/:quizId/poll-results', (req, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || normalizeSessionMode(quiz.mode) !== 'poll') {
      res.status(404).json({ error: 'Poll results not found.' });
      return;
    }
    const submissions = dataStore.listSubmissionsByQuiz(quiz.id);
    res.json({ results: aggregatePollResults(quiz, submissions) });
  });

  // Strictly verify an official host QR code against live quiz/poll state and active qrToken
  router.post('/verify-qr', (req, res) => {
    const quizId = typeof req.body?.quizId === 'string' ? req.body.quizId.trim() : '';
    const qrToken = typeof req.body?.qrToken === 'string' ? req.body.qrToken.trim() : '';
    const sessionToken =
      typeof req.body?.sessionToken === 'string' ? req.body.sessionToken.trim() : undefined;

    if (!quizId || !qrToken) {
      res.json({
        status: 'not_found',
        message: 'This QR code does not match any active AnonQuiz host session.',
      });
      return;
    }

    const quiz = dataStore.getQuizById(quizId);
    if (!quiz) {
      res.json({
        status: 'not_found',
        message: 'This QR code does not match any active AnonQuiz host session.',
      });
      return;
    }

    // Always allow returning participants to open their saved marks or live poll results
    if (sessionToken) {
      const existing = dataStore.getSubmission(quizId, sessionToken);
      if (existing) {
        res.json({
          status: 'already_submitted',
          quizId: quiz.id,
          title: quiz.title,
        });
        return;
      }
    }

    if (quiz.qrToken && quiz.qrToken !== qrToken) {
      res.json({
        status: 'superseded',
        message:
          'This QR code has been replaced by a newer QR from the host. Please scan the latest QR on the host screen.',
      });
      return;
    }

    const effectiveStatus = computeEffectiveQuizStatus(quiz, Date.now());
    if (effectiveStatus === 'expired') {
      res.json({
        status: 'expired',
        message: 'This QR code has expired and is no longer accepting new responses.',
      });
      return;
    }

    if (effectiveStatus === 'draft') {
      res.json({
        status: 'draft_or_denied',
        message: 'This session has not been launched yet. Wait until the host starts it.',
      });
      return;
    }

    res.json({
      status: 'valid',
      quizId: quiz.id,
      qrToken,
      title: quiz.title,
    });
  });

  // Fetch existing anonymous submission and marks/confirmation by session token
  router.get('/quizzes/:quizId/submissions/:sessionToken', (req, res) => {
    const { quizId, sessionToken } = req.params;
    const submission = dataStore.getSubmission(quizId, sessionToken);
    if (!submission) {
      res.json({ found: false });
      return;
    }

    const quiz = dataStore.getQuizById(quizId);
    if (!quiz) {
      res.json({ found: false });
      return;
    }

    res.json({
      found: true,
      result: buildResultPayload(quiz, submission),
    });
  });

  // Submit anonymous quiz answers or poll vote (server-side timer enforcement)
  router.post('/quizzes/:quizId/submit', (req, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const mode = normalizeSessionMode(quiz.mode);
    const sessionToken =
      typeof req.body?.sessionToken === 'string' ? req.body.sessionToken.trim() : '';
    if (!sessionToken || sessionToken.length > 96) {
      res.status(400).json({ error: 'Invalid anonymous session token.' });
      return;
    }

    const existing = dataStore.getSubmission(quiz.id, sessionToken);
    if (existing) {
      res.json({
        alreadySubmitted: true,
        result: buildResultPayload(quiz, existing),
      });
      return;
    }

    const autoSubmitted = Boolean(req.body?.autoSubmitted);
    const graceMs = autoSubmitted ? 10_000 : 0;
    const now = Date.now();
    const expired =
      quiz.status === 'draft' ||
      (quiz.expiresAt !== null && now > quiz.expiresAt + graceMs) ||
      (quiz.status === 'expired' && !autoSubmitted);

    if (expired) {
      res.status(410).json({
        error: 'This session link has expired and is no longer accepting responses.',
      });
      return;
    }

    const rawAnonId = typeof req.body?.anonId === 'string' ? req.body.anonId : '';
    const rawAlias = typeof req.body?.alias === 'string' ? req.body.alias : '';
    const rawAnswers =
      req.body?.answers && typeof req.body.answers === 'object'
        ? (req.body.answers as Record<string, UserAnswerValue>)
        : {};

    const cleanAnonId = (rawAnonId || generateAnonId()).trim().slice(0, MAX_ANON_ID_LEN);
    const cleanAlias = rawAlias.trim().slice(0, MAX_ALIAS_LEN);

    const sanitizedAnswers: Record<string, UserAnswerValue> = {};
    for (const q of quiz.questions) {
      const rawVal = rawAnswers[q.id];
      if (isChoiceQuestionType(q.type)) {
        const cleaned = Array.isArray(rawVal)
          ? Array.from(
              new Set(
                rawVal
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n >= 0 && n < q.options.length)
              )
            ).sort((a, b) => a - b)
          : [];
        const allowsMultiple =
          q.type === 'multi_select' ||
          (q.type === 'mcq' && Array.isArray(q.correctAnswer) && q.correctAnswer.length > 1);
        sanitizedAnswers[q.id] = allowsMultiple ? cleaned : cleaned.slice(0, 1);
      } else {
        sanitizedAnswers[q.id] =
          typeof rawVal === 'string' ? rawVal.slice(0, q.type === 'paragraph' ? 5000 : 1500) : '';
      }
    }

    const graded = autoGradeSubmission(quiz.questions, sanitizedAnswers, mode);
    const createdSubmission = dataStore.saveSubmission({
      id: sessionToken,
      quizId: quiz.id,
      hostUid: quiz.hostUid,
      sessionToken,
      anonId: cleanAnonId,
      alias: cleanAlias || undefined,
      submittedAt: now,
      updatedAt: now,
      answers: sanitizedAnswers,
      grading: graded.grading,
      totalScore: graded.totalScore,
      maxScore: graded.maxScore,
      reviewStatus: graded.reviewStatus,
      autoSubmitted,
    });

    const allSubs = dataStore.listSubmissionsByQuiz(quiz.id);
    bus.publish(hostChannel(quiz.hostUid), 'submissions_updated', {
      quizId: quiz.id,
      submissions: allSubs,
    });

    if (mode === 'poll') {
      bus.publish(pollChannel(quiz.id), 'poll_results_updated', {
        results: aggregatePollResults(quiz, allSubs),
      });
    }

    res.status(201).json({
      result: buildResultPayload(quiz, createdSubmission),
    });
  });

  return router;
}
