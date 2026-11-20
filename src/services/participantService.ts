import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.ts';
import type {
  PublicQuizView,
  Quiz,
  QuizSubmission,
  SubmissionResultPayload,
  UserAnswerValue,
} from '../types/quiz.ts';
import { autoGradeSubmission } from '../utils/gradingUtils.ts';
import { generateAnonId, normalizeJoinCode } from '../utils/qrUtils.ts';
import { computeEffectiveQuizStatus } from '../utils/timeUtils.ts';
import {
  MAX_ALIAS_LEN,
  MAX_ANON_ID_LEN,
  mapQuizDoc,
  mapSubmissionDoc,
  toPublicQuizView,
} from './mappers.ts';

export type HostQrVerificationResult =
  | { status: 'valid'; quizId: string; qrToken: string; title: string }
  | { status: 'already_submitted'; quizId: string; title: string }
  | {
      status: 'not_found' | 'superseded' | 'expired' | 'draft_or_denied';
      message: string;
    };

export async function lookupQuizByJoinCode(code: string): Promise<PublicQuizView> {
  const normalized = normalizeJoinCode(code);
  if (normalized.length !== 6) {
    throw new Error('Enter a valid 6-character quiz code.');
  }

  const joinCodePath = `joinCodes/${normalized}`;
  let quizId: string;
  try {
    const codeSnap = await getDoc(doc(db, 'joinCodes', normalized));
    if (!codeSnap.exists()) {
      throw new Error('No quiz found with that code. Check the code and try again.');
    }
    quizId = String(codeSnap.data().quizId || '');
  } catch (error) {
    if (error instanceof Error && error.message.includes('No quiz found')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, joinCodePath);
  }

  const quizPath = `quizzes/${quizId}`;
  try {
    const quizSnap = await getDoc(doc(db, 'quizzes', quizId));
    if (!quizSnap.exists()) {
      throw new Error('This quiz is no longer available.');
    }
    return toPublicQuizView(mapQuizDoc(quizSnap.id, quizSnap.data()));
  } catch (error) {
    if (error instanceof Error && error.message.includes('no longer available')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, quizPath);
  }
}

export async function fetchQuizDoc(quizId: string): Promise<Quiz | null> {
  const path = `quizzes/${quizId}`;
  try {
    const snap = await getDoc(doc(db, 'quizzes', quizId));
    if (!snap.exists()) return null;
    return mapQuizDoc(snap.id, snap.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function verifyHostQrCode(
  quizId: string,
  qrToken: string,
  sessionToken?: string
): Promise<HostQrVerificationResult> {
  let quiz: Quiz | null = null;
  try {
    const snap = await getDoc(doc(db, 'quizzes', quizId));
    if (snap.exists()) {
      quiz = mapQuizDoc(snap.id, snap.data());
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (msg.includes('permission') || msg.includes('insufficient')) {
      return {
        status: 'draft_or_denied',
        message: 'This host quiz is not active yet. Ask your host to launch it first.',
      };
    }
    throw error;
  }

  if (!quiz) {
    return {
      status: 'not_found',
      message: 'This QR code does not match any active AnonQuiz host session.',
    };
  }

  // Always let returning participants open their marks even if QR rotated or timer ended
  if (sessionToken) {
    try {
      const existing = await fetchSubmissionBySession(quizId, sessionToken);
      if (existing.found) {
        return {
          status: 'already_submitted',
          quizId: quiz.id,
          title: quiz.title,
        };
      }
    } catch {
      // ignore lookup error and continue regular verification
    }
  }

  if (quiz.qrToken && quiz.qrToken !== qrToken) {
    return {
      status: 'superseded',
      message:
        'This QR code has been replaced by a newer QR from the host. Please scan the latest QR on the host screen.',
    };
  }

  const effectiveStatus = computeEffectiveQuizStatus(quiz, Date.now());
  if (effectiveStatus === 'expired') {
    return {
      status: 'expired',
      message: 'This quiz QR code has expired and is no longer accepting new submissions.',
    };
  }

  if (effectiveStatus === 'draft') {
    return {
      status: 'draft_or_denied',
      message: 'This quiz has not been launched yet. Wait until the host starts the session.',
    };
  }

  return {
    status: 'valid',
    quizId: quiz.id,
    qrToken,
    title: quiz.title,
  };
}

export function subscribeQuizDoc(
  quizId: string,
  onQuiz: (quiz: Quiz | null) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `quizzes/${quizId}`;
  return onSnapshot(
    doc(db, 'quizzes', quizId),
    (snap) => {
      if (!snap.exists()) {
        onQuiz(null);
        return;
      }
      onQuiz(mapQuizDoc(snap.id, snap.data()));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function fetchSubmissionBySession(
  quizId: string,
  sessionToken: string
): Promise<{ found: boolean; result?: SubmissionResultPayload }> {
  const subPath = `quizzes/${quizId}/submissions/${sessionToken}`;
  try {
    const subSnap = await getDoc(doc(db, 'quizzes', quizId, 'submissions', sessionToken));
    if (!subSnap.exists()) {
      return { found: false };
    }
    const quiz = await fetchQuizDoc(quizId);
    if (!quiz) {
      return { found: false };
    }
    return {
      found: true,
      result: {
        quiz: {
          id: quiz.id,
          title: quiz.title,
          description: quiz.description,
          joinCode: quiz.joinCode,
          status: quiz.status,
          expiresAt: quiz.expiresAt,
          questions: quiz.questions,
        },
        submission: mapSubmissionDoc(subSnap.id, subSnap.data()),
      },
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, subPath);
  }
}

export async function submitQuizAnswers(
  quizId: string,
  payload: {
    sessionToken: string;
    anonId: string;
    alias?: string;
    answers: Record<string, UserAnswerValue>;
    autoSubmitted?: boolean;
  }
): Promise<{ result: SubmissionResultPayload; alreadySubmitted?: boolean }> {
  const quiz = await fetchQuizDoc(quizId);
  if (!quiz) {
    throw new Error('Quiz not found.');
  }

  const subRef = doc(db, 'quizzes', quizId, 'submissions', payload.sessionToken);
  const subPath = `quizzes/${quizId}/submissions/${payload.sessionToken}`;

  // Check duplicate submission
  try {
    const existingSnap = await getDoc(subRef);
    if (existingSnap.exists()) {
      return {
        alreadySubmitted: true,
        result: {
          quiz: {
            id: quiz.id,
            title: quiz.title,
            description: quiz.description,
            joinCode: quiz.joinCode,
            status: quiz.status,
            expiresAt: quiz.expiresAt,
            questions: quiz.questions,
          },
          submission: mapSubmissionDoc(existingSnap.id, existingSnap.data()),
        },
      };
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, subPath);
  }

  const graceMs = payload.autoSubmitted ? 10_000 : 0;
  const expired =
    quiz.status === 'draft' ||
    (quiz.expiresAt !== null && Date.now() > quiz.expiresAt + graceMs) ||
    (quiz.status === 'expired' && !payload.autoSubmitted);

  if (expired) {
    throw new Error('This quiz link has expired and is no longer accepting submissions.');
  }

  const cleanAnonId = (payload.anonId || generateAnonId()).trim().slice(0, MAX_ANON_ID_LEN);
  const cleanAlias = payload.alias ? payload.alias.trim().slice(0, MAX_ALIAS_LEN) : '';
  const sanitizedAnswers: Record<string, UserAnswerValue> = {};
  for (const q of quiz.questions) {
    const rawVal = payload.answers?.[q.id];
    if (q.type === 'mcq') {
      sanitizedAnswers[q.id] = Array.isArray(rawVal)
        ? rawVal.map(Number).filter((n) => Number.isInteger(n) && n >= 0)
        : [];
    } else {
      sanitizedAnswers[q.id] =
        typeof rawVal === 'string' ? rawVal.slice(0, q.type === 'paragraph' ? 5000 : 1500) : '';
    }
  }
  const graded = autoGradeSubmission(quiz.questions, sanitizedAnswers);

  const writeDoc = {
    quizId: quiz.id,
    hostUid: quiz.hostUid,
    sessionToken: payload.sessionToken,
    anonId: cleanAnonId,
    ...(cleanAlias ? { alias: cleanAlias } : {}),
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    answers: sanitizedAnswers,
    grading: graded.grading,
    totalScore: graded.totalScore,
    maxScore: graded.maxScore,
    reviewStatus: graded.reviewStatus,
    autoSubmitted: Boolean(payload.autoSubmitted),
  };

  try {
    await setDoc(subRef, writeDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, subPath);
  }

  const createdSubmission: QuizSubmission = {
    id: payload.sessionToken,
    quizId: quiz.id,
    hostUid: quiz.hostUid,
    sessionToken: payload.sessionToken,
    anonId: cleanAnonId,
    alias: cleanAlias || undefined,
    submittedAt: Date.now(),
    updatedAt: Date.now(),
    answers: sanitizedAnswers,
    grading: graded.grading,
    totalScore: graded.totalScore,
    maxScore: graded.maxScore,
    reviewStatus: graded.reviewStatus,
    autoSubmitted: Boolean(payload.autoSubmitted),
  };

  return {
    result: {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        description: quiz.description,
        joinCode: quiz.joinCode,
        status: quiz.status,
        expiresAt: quiz.expiresAt,
        questions: quiz.questions,
      },
      submission: createdSubmission,
    },
  };
}

export function subscribeParticipantResult(
  quizId: string,
  submissionId: string,
  onResult: (result: SubmissionResultPayload) => void,
  onError?: (err: Error) => void
): () => void {
  let latestQuiz: Quiz | null = null;
  let latestSubmission: QuizSubmission | null = null;

  const emitIfReady = () => {
    if (!latestQuiz || !latestSubmission) return;
    onResult({
      quiz: {
        id: latestQuiz.id,
        title: latestQuiz.title,
        description: latestQuiz.description,
        joinCode: latestQuiz.joinCode,
        status: latestQuiz.status,
        expiresAt: latestQuiz.expiresAt,
        questions: latestQuiz.questions,
      },
      submission: latestSubmission,
    });
  };

  const unsubQuiz = subscribeQuizDoc(
    quizId,
    (quiz) => {
      latestQuiz = quiz;
      emitIfReady();
    },
    onError
  );

  const subPath = `quizzes/${quizId}/submissions/${submissionId}`;
  const unsubSub = onSnapshot(
    doc(db, 'quizzes', quizId, 'submissions', submissionId),
    (snap) => {
      if (!snap.exists()) return;
      latestSubmission = mapSubmissionDoc(snap.id, snap.data());
      emitIfReady();
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, subPath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  return () => {
    unsubQuiz();
    unsubSub();
  };
}
