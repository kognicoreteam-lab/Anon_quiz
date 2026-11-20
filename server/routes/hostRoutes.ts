import { Router } from 'express';
import type { QuestionGrading, Quiz, QuizQuestion } from '../../src/types/quiz.ts';
import {
  finalizeManualGrading,
  recalculateSubmissionAfterKeyChange,
  validateQuizDraft,
} from '../../src/utils/gradingUtils.ts';
import { aggregatePollResults } from '../../src/utils/pollUtils.ts';
import { generateId, generateJoinCode, generateQrToken } from '../../src/utils/qrUtils.ts';
import {
  MAX_DESC_LEN,
  MAX_TITLE_LEN,
  buildQuizSummaryFromSubmissions,
  normalizeSessionMode,
  sanitizeQuestions,
  toPublicQuizView,
} from '../../src/services/mappers.ts';
import type { DataStore } from '../db/store.ts';
import { createRequireHostAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import {
  hostChannel,
  pollChannel,
  quizChannel,
  resultChannel,
  type RealtimeEventBus,
} from '../realtime/eventBus.ts';

export function createHostRoutes(dataStore: DataStore, bus: RealtimeEventBus): Router {
  const router = Router();
  const requireHostAuth = createRequireHostAuth(dataStore);

  router.use(requireHostAuth);

  const allocateUniqueJoinCode = (): string => {
    for (let i = 0; i < 20; i++) {
      const candidate = generateJoinCode(6);
      if (!dataStore.isJoinCodeTaken(candidate)) {
        return candidate;
      }
    }
    return generateJoinCode(6);
  };

  const broadcastHostQuizzes = (hostUid: string) => {
    const quizzes = dataStore.listQuizzesByHost(hostUid);
    bus.publish(hostChannel(hostUid), 'quizzes_updated', { quizzes });
  };

  const broadcastQuizChange = (quiz: Quiz) => {
    bus.publish(quizChannel(quiz.id), 'quiz_updated', { quiz: toPublicQuizView(quiz) });
    bus.publish(hostChannel(quiz.hostUid), 'quiz_detail_updated', { quiz });
    if (normalizeSessionMode(quiz.mode) === 'poll') {
      const subs = dataStore.listSubmissionsByQuiz(quiz.id);
      bus.publish(pollChannel(quiz.id), 'poll_results_updated', {
        results: aggregatePollResults(quiz, subs),
      });
    }
    broadcastHostQuizzes(quiz.hostUid);
  };

  // List all quizzes & polls owned by the authenticated host
  router.get('/quizzes', (req: AuthenticatedRequest, res) => {
    const hostUid = req.hostUser!.uid;
    const quizzes = dataStore.listQuizzesByHost(hostUid).map((q) => ({
      ...q,
      mode: normalizeSessionMode(q.mode),
    }));
    res.json({ quizzes });
  });

  // Get a single quiz or poll (including answer keys for host review)
  router.get('/quizzes/:quizId', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json({ quiz: { ...quiz, mode: normalizeSessionMode(quiz.mode) } });
  });

  // Get live aggregated numerical & graphical poll results
  router.get('/quizzes/:quizId/poll-results', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Poll not found.' });
      return;
    }
    const submissions = dataStore.listSubmissionsByQuiz(quiz.id);
    res.json({ results: aggregatePollResults(quiz, submissions) });
  });

  // Create a new quiz or opinion survey poll
  router.post('/quizzes', (req: AuthenticatedRequest, res) => {
    const host = req.hostUser!;
    const mode = normalizeSessionMode(req.body?.mode);
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const description = typeof req.body?.description === 'string' ? req.body.description : '';
    const questions = Array.isArray(req.body?.questions)
      ? (req.body.questions as QuizQuestion[])
      : [];

    const validation = validateQuizDraft({ title, description, questions }, mode);
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0] });
      return;
    }

    const now = Date.now();
    const created: Quiz = {
      id: generateId(mode === 'poll' ? 'poll' : 'quiz'),
      mode,
      hostUid: host.uid,
      hostEmail: host.email,
      title: title.trim().slice(0, MAX_TITLE_LEN),
      description: description.trim().slice(0, MAX_DESC_LEN),
      joinCode: allocateUniqueJoinCode(),
      qrToken: generateQrToken(),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      expiresAt: null,
      questions: sanitizeQuestions(questions, mode),
    };

    const saved = dataStore.saveQuiz(created);
    broadcastHostQuizzes(host.uid);
    res.status(201).json({ quiz: buildQuizSummaryFromSubmissions(saved, []) });
  });

  // Create a sample quiz or sample opinion survey poll
  router.post('/quizzes/sample', (req: AuthenticatedRequest, res) => {
    const host = req.hostUser!;
    const mode = normalizeSessionMode(req.body?.mode);
    const now = Date.now();

    const created: Quiz =
      mode === 'poll'
        ? {
            id: generateId('poll'),
            mode: 'poll',
            hostUid: host.uid,
            hostEmail: host.email,
            title: 'Course & Workshop Opinion Survey',
            description:
              'Anonymous feedback poll on session format, preferred hands-on topics, and open suggestions.',
            joinCode: allocateUniqueJoinCode(),
            qrToken: generateQrToken(),
            status: 'draft',
            createdAt: now,
            updatedAt: now,
            expiresAt: null,
            questions: [
              {
                id: generateId('q'),
                type: 'mcq',
                text: 'Which session format helps you learn best?',
                options: [
                  'Live coding walkthroughs',
                  'Short concept lectures with Q&A',
                  'Small group lab exercises',
                  'Self-paced guided projects',
                ],
                correctAnswer: [],
                points: 0,
              },
              {
                id: generateId('q'),
                type: 'multi_select',
                text: 'Which upcoming workshop topics interest you most? (Select all that apply)',
                options: [
                  'React & State Architecture',
                  'Node.js & REST APIs',
                  'Database Design & Indexing',
                  'Cloud Deployment & CI/CD',
                  'System Design Case Studies',
                ],
                correctAnswer: [],
                points: 0,
              },
              {
                id: generateId('q'),
                type: 'paragraph',
                text: 'Any additional suggestions or topics you would like us to cover this semester?',
                options: [],
                correctAnswer: '',
                points: 0,
              },
            ],
          }
        : {
            id: generateId('quiz'),
            mode: 'quiz',
            hostUid: host.uid,
            hostEmail: host.email,
            title: 'Distributed Systems Checkpoint',
            description:
              'Anonymous assessment on HTTP semantics, multi-select protocol properties, retry resilience, and system design trade-offs.',
            joinCode: allocateUniqueJoinCode(),
            qrToken: generateQrToken(),
            status: 'draft',
            createdAt: now,
            updatedAt: now,
            expiresAt: null,
            questions: [
              {
                id: generateId('q'),
                type: 'mcq',
                text: 'Which HTTP status code indicates that a request succeeded and created a new resource?',
                options: ['200 OK', '201 Created', '204 No Content', '304 Not Modified'],
                correctAnswer: [1],
                points: 2,
              },
              {
                id: generateId('q'),
                type: 'multi_select',
                text: 'Which of the following HTTP methods are idempotent according to RFC 9110? (Select all that apply)',
                options: ['GET', 'POST', 'PUT', 'DELETE'],
                correctAnswer: [0, 2, 3],
                points: 3,
              },
              {
                id: generateId('q'),
                type: 'short_answer',
                text: 'Briefly explain one advantage of using exponential backoff when retrying failed API calls.',
                options: [],
                correctAnswer:
                  'Prevents synchronized retry storms on a recovering backend by progressively spacing out attempts.',
                points: 3,
              },
              {
                id: generateId('q'),
                type: 'paragraph',
                text: 'Compare strong consistency and eventual consistency in a globally distributed web application. Include one concrete scenario where you would choose each model.',
                options: [],
                correctAnswer:
                  'Strong consistency guarantees linearizable reads at the cost of higher cross-region latency (e.g., financial ledgers or seat reservations). Eventual consistency lowers latency and stays available during partitions (e.g., social feed counts or product catalog views).',
                points: 5,
              },
            ],
          };

    const saved = dataStore.saveQuiz(created);
    broadcastHostQuizzes(host.uid);
    res.status(201).json({ quiz: buildQuizSummaryFromSubmissions(saved, []) });
  });

  // Update quiz/poll metadata & questions
  router.put('/quizzes/:quizId', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const mode = normalizeSessionMode(req.body?.mode ?? quiz.mode);
    const title = typeof req.body?.title === 'string' ? req.body.title : '';
    const description = typeof req.body?.description === 'string' ? req.body.description : '';
    const questions = Array.isArray(req.body?.questions)
      ? (req.body.questions as QuizQuestion[])
      : [];

    const validation = validateQuizDraft({ title, description, questions }, mode);
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors[0] });
      return;
    }

    const updated = dataStore.saveQuiz({
      ...quiz,
      mode,
      title: title.trim().slice(0, MAX_TITLE_LEN),
      description: description.trim().slice(0, MAX_DESC_LEN),
      questions: sanitizeQuestions(questions, mode),
      updatedAt: Date.now(),
    });

    broadcastQuizChange(updated);
    res.json({ quiz: updated });
  });

  // Delete a quiz/poll and all its submissions
  router.delete('/quizzes/:quizId', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    dataStore.deleteQuiz(quiz.id);
    broadcastHostQuizzes(req.hostUser!.uid);
    res.json({ ok: true });
  });

  // Launch or reopen a quiz/poll with a fresh QR token
  router.post('/quizzes/:quizId/launch', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const durationMinutes = Number(req.body?.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      res.status(400).json({ error: 'Expiration duration must be between 1 and 1440 minutes.' });
      return;
    }

    const expiresAt = Date.now() + Math.round(durationMinutes * 60 * 1000);
    const qrToken = generateQrToken();
    const updated = dataStore.saveQuiz({
      ...quiz,
      mode: normalizeSessionMode(quiz.mode),
      status: 'active',
      expiresAt,
      qrToken,
      updatedAt: Date.now(),
    });

    broadcastQuizChange(updated);
    res.json({ expiresAt, qrToken, quiz: updated });
  });

  // Generate a fresh QR token (invalidating previous QR screenshots)
  router.post('/quizzes/:quizId/regenerate-qr', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const qrToken = generateQrToken();
    const updated = dataStore.saveQuiz({
      ...quiz,
      mode: normalizeSessionMode(quiz.mode),
      qrToken,
      updatedAt: Date.now(),
    });

    broadcastQuizChange(updated);
    res.json({ qrToken, quiz: updated });
  });

  // Extend timer
  router.post('/quizzes/:quizId/extend', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const minutes = Number(req.body?.minutes ?? 5);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      res.status(400).json({ error: 'Extension minutes must be between 1 and 1440.' });
      return;
    }

    const baseMs = Math.max(Date.now(), quiz.expiresAt ?? Date.now());
    const expiresAt = baseMs + Math.round(minutes * 60 * 1000);
    const updated = dataStore.saveQuiz({
      ...quiz,
      mode: normalizeSessionMode(quiz.mode),
      status: 'active',
      expiresAt,
      updatedAt: Date.now(),
    });

    broadcastQuizChange(updated);
    res.json({ expiresAt, quiz: updated });
  });

  // End early
  router.post('/quizzes/:quizId/end', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const now = Date.now();
    const updated = dataStore.saveQuiz({
      ...quiz,
      mode: normalizeSessionMode(quiz.mode),
      status: 'expired',
      expiresAt: now,
      updatedAt: now,
    });

    broadcastQuizChange(updated);
    res.json({ quiz: updated });
  });

  // List all anonymous submissions for a quiz or poll
  router.get('/quizzes/:quizId/submissions', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const submissions = dataStore.listSubmissionsByQuiz(quiz.id);
    res.json({ submissions });
  });

  // Grade & publish marks for a single quiz submission
  router.put('/quizzes/:quizId/submissions/:submissionId/grade', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    const existing = dataStore.getSubmission(quiz.id, req.params.submissionId);
    if (!existing) {
      res.status(404).json({ error: 'Submission not found.' });
      return;
    }

    const gradingInput =
      req.body?.grading && typeof req.body.grading === 'object'
        ? (req.body.grading as Record<string, Partial<QuestionGrading>>)
        : {};
    const finalized = finalizeManualGrading(quiz.questions, gradingInput);

    const updatedSub = dataStore.saveSubmission({
      ...existing,
      grading: finalized.grading,
      totalScore: finalized.totalScore,
      maxScore: finalized.maxScore,
      reviewStatus: finalized.reviewStatus,
      updatedAt: Date.now(),
    });

    const allSubs = dataStore.listSubmissionsByQuiz(quiz.id);
    bus.publish(hostChannel(quiz.hostUid), 'submissions_updated', {
      quizId: quiz.id,
      submissions: allSubs,
    });
    bus.publish(resultChannel(quiz.id, updatedSub.id), 'result_updated', {
      result: {
        quiz: {
          id: quiz.id,
          mode: normalizeSessionMode(quiz.mode),
          title: quiz.title,
          description: quiz.description,
          joinCode: quiz.joinCode,
          status: quiz.status,
          expiresAt: quiz.expiresAt,
          questions: quiz.questions,
        },
        submission: updatedSub,
      },
    });

    res.json({ submission: updatedSub });
  });

  // Update answer key and bulk recalculate every submission (quiz mode)
  router.post('/quizzes/:quizId/recalculate', (req: AuthenticatedRequest, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    if (!quiz || quiz.hostUid !== req.hostUser!.uid) {
      res.status(404).json({ error: 'Quiz not found.' });
      return;
    }

    const mode = normalizeSessionMode(quiz.mode);
    const rawQuestions = Array.isArray(req.body?.questions)
      ? (req.body.questions as QuizQuestion[])
      : [];
    const cleanQuestions = sanitizeQuestions(rawQuestions, mode);

    const updatedQuiz = dataStore.saveQuiz({
      ...quiz,
      mode,
      questions: cleanQuestions,
      updatedAt: Date.now(),
    });

    const currentSubs = dataStore.listSubmissionsByQuiz(quiz.id);
    const updatedSubs = currentSubs.map((sub) => {
      const recalc = recalculateSubmissionAfterKeyChange(cleanQuestions, sub);
      return {
        ...sub,
        grading: recalc.grading,
        totalScore: recalc.totalScore,
        maxScore: recalc.maxScore,
        reviewStatus: recalc.reviewStatus,
        updatedAt: Date.now(),
      };
    });

    dataStore.saveManySubmissions(quiz.id, updatedSubs);

    bus.publish(hostChannel(quiz.hostUid), 'quiz_detail_updated', { quiz: updatedQuiz });
    bus.publish(hostChannel(quiz.hostUid), 'submissions_updated', {
      quizId: quiz.id,
      submissions: updatedSubs,
    });
    broadcastHostQuizzes(quiz.hostUid);

    for (const sub of updatedSubs) {
      bus.publish(resultChannel(quiz.id, sub.id), 'result_updated', {
        result: {
          quiz: {
            id: updatedQuiz.id,
            mode,
            title: updatedQuiz.title,
            description: updatedQuiz.description,
            joinCode: updatedQuiz.joinCode,
            status: updatedQuiz.status,
            expiresAt: updatedQuiz.expiresAt,
            questions: updatedQuiz.questions,
          },
          submission: sub,
        },
      });
    }

    res.json({ updatedCount: updatedSubs.length, quiz: updatedQuiz });
  });

  return router;
}
