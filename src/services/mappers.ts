import { Timestamp, type DocumentData } from 'firebase/firestore';
import type {
  PublicQuizView,
  QuestionGrading,
  Quiz,
  QuizQuestion,
  QuizSubmission,
  QuizSummary,
  UserAnswerValue,
} from '../types/quiz.ts';
import { calculateScorePercent } from '../utils/gradingUtils.ts';
import { generateId } from '../utils/qrUtils.ts';
import { computeEffectiveQuizStatus } from '../utils/timeUtils.ts';

// Blueprint boundary constants synced verbatim with firebase-blueprint.json & firestore.rules
export const MAX_TITLE_LEN = 160;
export const MAX_DESC_LEN = 1000;
export const MAX_QUESTIONS = 100;
export const MAX_ANON_ID_LEN = 32;
export const MAX_ALIAS_LEN = 40;

export function timestampToMs(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Timestamp) return val.toMillis();
  if (
    typeof val === 'object' &&
    val !== null &&
    'toMillis' in val &&
    typeof (val as { toMillis: unknown }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  return null;
}

export function mapQuizDoc(id: string, data: DocumentData): Quiz {
  const expiresAt = timestampToMs(data.expiresAt);
  const rawStatus = data.status === 'active' || data.status === 'expired' ? data.status : 'draft';
  const effectiveStatus = computeEffectiveQuizStatus({ status: rawStatus, expiresAt }, Date.now());
  return {
    id,
    hostUid: String(data.hostUid || ''),
    title: String(data.title || ''),
    description: String(data.description || ''),
    joinCode: String(data.joinCode || ''),
    qrToken: typeof data.qrToken === 'string' && data.qrToken ? data.qrToken : undefined,
    status: effectiveStatus,
    createdAt: timestampToMs(data.createdAt) ?? Date.now(),
    updatedAt: timestampToMs(data.updatedAt) ?? undefined,
    expiresAt,
    questions: Array.isArray(data.questions) ? (data.questions as QuizQuestion[]) : [],
  };
}

export function mapSubmissionDoc(id: string, data: DocumentData): QuizSubmission {
  return {
    id,
    quizId: String(data.quizId || ''),
    hostUid: String(data.hostUid || ''),
    sessionToken: String(data.sessionToken || id),
    anonId: String(data.anonId || 'Anon-0000'),
    alias: typeof data.alias === 'string' && data.alias ? data.alias : undefined,
    submittedAt: timestampToMs(data.submittedAt) ?? Date.now(),
    updatedAt: timestampToMs(data.updatedAt) ?? undefined,
    answers: (data.answers && typeof data.answers === 'object' ? data.answers : {}) as Record<
      string,
      UserAnswerValue
    >,
    grading: (data.grading && typeof data.grading === 'object' ? data.grading : {}) as Record<
      string,
      QuestionGrading
    >,
    totalScore: Number(data.totalScore) || 0,
    maxScore: Number(data.maxScore) || 0,
    reviewStatus:
      data.reviewStatus === 'reviewed' || data.reviewStatus === 'auto_graded'
        ? data.reviewStatus
        : 'pending',
    autoSubmitted: Boolean(data.autoSubmitted),
  };
}

export function sanitizeQuestions(questions: QuizQuestion[]): QuizQuestion[] {
  return questions.slice(0, MAX_QUESTIONS).map((q) => {
    const cleanType =
      q.type === 'paragraph' ? 'paragraph' : q.type === 'short_answer' ? 'short_answer' : 'mcq';
    return {
      id: (q.id || generateId('q')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
      type: cleanType,
      text: String(q.text || '').trim().slice(0, 800),
      options:
        cleanType === 'mcq'
          ? (q.options || []).slice(0, 8).map((o) => String(o || '').trim().slice(0, 240))
          : [],
      correctAnswer:
        cleanType === 'mcq'
          ? Array.isArray(q.correctAnswer)
            ? q.correctAnswer.map(Number)
            : []
          : typeof q.correctAnswer === 'string'
            ? q.correctAnswer.trim().slice(0, cleanType === 'paragraph' ? 1500 : 500)
            : '',
      points: Math.max(0.5, Math.min(100, Number(q.points) || 1)),
    };
  });
}

export function buildQuizSummaryFromSubmissions(
  quiz: Quiz,
  submissions: QuizSubmission[]
): QuizSummary {
  const pendingReviewCount = submissions.filter((s) => s.reviewStatus === 'pending').length;
  const averageScorePercent =
    submissions.length > 0
      ? Math.round(
          submissions.reduce(
            (acc, s) => acc + calculateScorePercent(s.totalScore, s.maxScore),
            0
          ) / submissions.length
        )
      : null;

  return {
    ...quiz,
    submissionCount: submissions.length,
    pendingReviewCount,
    averageScorePercent,
  };
}

export function toPublicQuizView(quiz: Quiz): PublicQuizView {
  const effectiveStatus = computeEffectiveQuizStatus(quiz, Date.now());
  return {
    id: quiz.id,
    hostUid: quiz.hostUid,
    title: quiz.title,
    description: quiz.description,
    joinCode: quiz.joinCode,
    qrToken: quiz.qrToken,
    status: effectiveStatus,
    expiresAt: quiz.expiresAt,
    serverNow: Date.now(),
    questions: quiz.questions.map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      options: q.options,
      multiSelect: q.type === 'mcq' && Array.isArray(q.correctAnswer) && q.correctAnswer.length > 1,
      points: q.points,
    })),
  };
}
