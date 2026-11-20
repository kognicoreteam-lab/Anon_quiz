import type {
  PublicQuizView,
  QuestionType,
  Quiz,
  QuizQuestion,
  QuizSubmission,
  QuizSummary,
  SessionMode,
} from '../types/quiz.ts';
import { calculateScorePercent, isChoiceQuestionType } from '../utils/gradingUtils.ts';
import { generateId } from '../utils/qrUtils.ts';
import { computeEffectiveQuizStatus } from '../utils/timeUtils.ts';

// Payload boundary constants shared across server validation and client sanitization
export const MAX_TITLE_LEN = 160;
export const MAX_DESC_LEN = 1000;
export const MAX_QUESTIONS = 100;
export const MAX_ANON_ID_LEN = 32;
export const MAX_ALIAS_LEN = 40;

export function normalizeSessionMode(mode: unknown): SessionMode {
  return mode === 'poll' ? 'poll' : 'quiz';
}

export function sanitizeQuestions(
  questions: QuizQuestion[],
  mode: SessionMode = 'quiz'
): QuizQuestion[] {
  return questions.slice(0, MAX_QUESTIONS).map((q) => {
    const cleanType: QuestionType =
      q.type === 'multi_select'
        ? 'multi_select'
        : q.type === 'paragraph'
          ? 'paragraph'
          : q.type === 'short_answer'
            ? 'short_answer'
            : 'mcq';

    const isChoice = isChoiceQuestionType(cleanType);
    const cleanOptions = isChoice
      ? (q.options || []).slice(0, 8).map((o) => String(o || '').trim().slice(0, 240))
      : [];

    let cleanCorrectAnswer: number[] | string;
    if (mode === 'poll') {
      cleanCorrectAnswer = isChoice ? [] : '';
    } else if (isChoice) {
      cleanCorrectAnswer = Array.isArray(q.correctAnswer)
        ? Array.from(
            new Set(
              q.correctAnswer
                .map(Number)
                .filter((n) => Number.isInteger(n) && n >= 0 && n < cleanOptions.length)
            )
          ).sort((a, b) => a - b)
        : [];
    } else {
      cleanCorrectAnswer =
        typeof q.correctAnswer === 'string'
          ? q.correctAnswer.trim().slice(0, cleanType === 'paragraph' ? 1500 : 500)
          : '';
    }

    return {
      id: (q.id || generateId('q')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
      type: cleanType,
      text: String(q.text || '').trim().slice(0, 800),
      options: cleanOptions,
      correctAnswer: cleanCorrectAnswer,
      points: mode === 'poll' ? 0 : Math.max(0.5, Math.min(100, Number(q.points) || 1)),
    };
  });
}

export function buildQuizSummaryFromSubmissions(
  quiz: Quiz,
  submissions: QuizSubmission[]
): QuizSummary {
  const mode = normalizeSessionMode(quiz.mode);
  const pendingReviewCount =
    mode === 'poll' ? 0 : submissions.filter((s) => s.reviewStatus === 'pending').length;
  const averageScorePercent =
    mode === 'poll' || submissions.length === 0
      ? null
      : Math.round(
          submissions.reduce(
            (acc, s) => acc + calculateScorePercent(s.totalScore, s.maxScore),
            0
          ) / submissions.length
        );

  return {
    ...quiz,
    mode,
    submissionCount: submissions.length,
    pendingReviewCount,
    averageScorePercent,
  };
}

export function toPublicQuizView(quiz: Quiz, nowMs = Date.now()): PublicQuizView {
  const mode = normalizeSessionMode(quiz.mode);
  const effectiveStatus = computeEffectiveQuizStatus(quiz, nowMs);
  return {
    id: quiz.id,
    mode,
    hostUid: quiz.hostUid,
    title: quiz.title,
    description: quiz.description,
    joinCode: quiz.joinCode,
    qrToken: quiz.qrToken,
    status: effectiveStatus,
    expiresAt: quiz.expiresAt,
    serverNow: nowMs,
    questions: quiz.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      options: q.options,
      multiSelect:
        q.type === 'multi_select' ||
        (q.type === 'mcq' && Array.isArray(q.correctAnswer) && q.correctAnswer.length > 1),
      points: mode === 'poll' ? 0 : q.points,
    })),
  };
}
