import { Router } from 'express';
import { normalizeSessionMode, toPublicQuizView } from '../../src/services/mappers.ts';
import { aggregatePollResults } from '../../src/utils/pollUtils.ts';
import type { DataStore } from '../db/store.ts';
import { createRequireHostAuth, type AuthenticatedRequest } from '../middleware/auth.ts';
import {
  hostChannel,
  pollChannel,
  quizChannel,
  resultChannel,
  type RealtimeEventBus,
} from '../realtime/eventBus.ts';

export function createSseRoutes(dataStore: DataStore, bus: RealtimeEventBus): Router {
  const router = Router();
  const requireHostAuth = createRequireHostAuth(dataStore);

  // Authenticated SSE stream for Host Dashboard & Review Panel
  router.get('/host', requireHostAuth, (req: AuthenticatedRequest, res) => {
    const hostUid = req.hostUser!.uid;
    bus.subscribe(hostChannel(hostUid), res);
  });

  // Public SSE stream for active quiz/poll timer extensions / early end
  router.get('/quiz/:quizId', (req, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    bus.subscribe(quizChannel(req.params.quizId), res);
    if (quiz && !res.writableEnded) {
      res.write(
        `event: quiz_updated\ndata: ${JSON.stringify({ quiz: toPublicQuizView(quiz) })}\n\n`
      );
    }
  });

  // Live SSE stream for aggregate Poll results (Numerical & Graphical)
  router.get('/poll/:quizId', (req, res) => {
    const quiz = dataStore.getQuizById(req.params.quizId);
    bus.subscribe(pollChannel(req.params.quizId), res);
    if (quiz && normalizeSessionMode(quiz.mode) === 'poll' && !res.writableEnded) {
      const subs = dataStore.listSubmissionsByQuiz(quiz.id);
      res.write(
        `event: poll_results_updated\ndata: ${JSON.stringify({
          results: aggregatePollResults(quiz, subs),
        })}\n\n`
      );
    }
  });

  // Live SSE stream for participant's host-reviewed quiz marks
  router.get('/result/:quizId/:submissionId', (req, res) => {
    const { quizId, submissionId } = req.params;
    bus.subscribe(resultChannel(quizId, submissionId), res);

    const quiz = dataStore.getQuizById(quizId);
    const submission = dataStore.getSubmission(quizId, submissionId);
    if (quiz && submission && !res.writableEnded) {
      res.write(
        `event: result_updated\ndata: ${JSON.stringify({
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
            submission,
          },
        })}\n\n`
      );
    }
  });

  return router;
}
