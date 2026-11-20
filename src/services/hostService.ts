import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.ts';
import type { HostUser, Quiz, QuizQuestion, QuizSubmission, QuizSummary } from '../types/quiz.ts';
import { validateQuizDraft } from '../utils/gradingUtils.ts';
import { generateId, generateJoinCode, generateQrToken } from '../utils/qrUtils.ts';
import {
  MAX_DESC_LEN,
  MAX_TITLE_LEN,
  mapQuizDoc,
  mapSubmissionDoc,
  sanitizeQuestions,
} from './mappers.ts';

// --- Host Profile (PII Isolation in /users/{uid}) ---

export async function syncHostProfile(user: HostUser): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const displayName = (user.displayName || 'Host').trim().slice(0, 120) || 'Host';
  const email = (user.email || '').trim().slice(0, 254);
  const photoURL = user.photoURL ? user.photoURL.slice(0, 500) : undefined;

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        ...(photoURL ? { photoURL } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email,
        displayName,
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Host Quizzes CRUD & Real-Time Listeners ---

export function subscribeHostQuizzes(
  hostUid: string,
  onQuizzes: (quizzes: Quiz[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = 'quizzes';
  const q = query(collection(db, 'quizzes'), where('hostUid', '==', hostUid));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => mapQuizDoc(d.id, d.data()))
        .sort((a, b) => b.createdAt - a.createdAt);
      onQuizzes(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeQuizSubmissions(
  quizId: string,
  hostUid: string,
  onSubmissions: (submissions: QuizSubmission[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `quizzes/${quizId}/submissions`;
  const q = query(
    collection(db, 'quizzes', quizId, 'submissions'),
    where('hostUid', '==', hostUid)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => mapSubmissionDoc(d.id, d.data()))
        .sort((a, b) => b.submittedAt - a.submittedAt);
      onSubmissions(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

async function allocateUniqueJoinCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const candidate = generateJoinCode(6);
    try {
      const snap = await getDoc(doc(db, 'joinCodes', candidate));
      if (!snap.exists()) {
        return candidate;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `joinCodes/${candidate}`);
    }
  }
  return generateJoinCode(6);
}

export async function createQuiz(payload: {
  hostUid: string;
  title: string;
  description: string;
  questions: QuizQuestion[];
}): Promise<QuizSummary> {
  const validation = validateQuizDraft(payload);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  const quizId = generateId('quiz');
  const joinCode = await allocateUniqueJoinCode();
  const qrToken = generateQrToken();
  const cleanTitle = payload.title.trim().slice(0, MAX_TITLE_LEN);
  const cleanDescription = (payload.description || '').trim().slice(0, MAX_DESC_LEN);
  const cleanQuestions = sanitizeQuestions(payload.questions);

  const batch = writeBatch(db);
  const quizRef = doc(db, 'quizzes', quizId);
  const joinCodeRef = doc(db, 'joinCodes', joinCode);

  batch.set(quizRef, {
    hostUid: payload.hostUid,
    title: cleanTitle,
    description: cleanDescription,
    joinCode,
    qrToken,
    status: 'draft',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expiresAt: null,
    questions: cleanQuestions,
  });

  batch.set(joinCodeRef, {
    quizId,
    hostUid: payload.hostUid,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `quizzes/${quizId}`);
  }

  return {
    id: quizId,
    hostUid: payload.hostUid,
    title: cleanTitle,
    description: cleanDescription,
    joinCode,
    qrToken,
    status: 'draft',
    createdAt: Date.now(),
    expiresAt: null,
    questions: cleanQuestions,
    submissionCount: 0,
    pendingReviewCount: 0,
    averageScorePercent: null,
  };
}

export async function createSampleQuiz(hostUid: string): Promise<QuizSummary> {
  return createQuiz({
    hostUid,
    title: 'Distributed Systems Checkpoint',
    description:
      'Anonymous pulse on HTTP semantics, retry resilience, and system design trade-offs.',
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
  });
}

export async function updateQuiz(
  quizId: string,
  payload: {
    title: string;
    description: string;
    questions: QuizQuestion[];
  }
): Promise<void> {
  const validation = validateQuizDraft(payload);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  const path = `quizzes/${quizId}`;
  try {
    await updateDoc(doc(db, 'quizzes', quizId), {
      title: payload.title.trim().slice(0, MAX_TITLE_LEN),
      description: (payload.description || '').trim().slice(0, MAX_DESC_LEN),
      questions: sanitizeQuestions(payload.questions),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteQuiz(quizId: string, joinCode: string, hostUid: string): Promise<void> {
  const path = `quizzes/${quizId}`;
  try {
    const subsQuery = query(
      collection(db, 'quizzes', quizId, 'submissions'),
      where('hostUid', '==', hostUid)
    );
    const subsSnap = await getDocs(subsQuery);

    const batch = writeBatch(db);
    subsSnap.docs.forEach((subDoc) => {
      batch.delete(subDoc.ref);
    });
    if (joinCode && /^[A-Z0-9]{6}$/.test(joinCode)) {
      batch.delete(doc(db, 'joinCodes', joinCode));
    }
    batch.delete(doc(db, 'quizzes', quizId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function launchQuiz(
  quizId: string,
  durationMinutes: number
): Promise<{ expiresAt: number; qrToken: string }> {
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new Error('Expiration duration must be between 1 and 1440 minutes.');
  }
  const expiresMs = Date.now() + Math.round(durationMinutes * 60 * 1000);
  const qrToken = generateQrToken();
  const path = `quizzes/${quizId}`;
  try {
    await updateDoc(doc(db, 'quizzes', quizId), {
      status: 'active',
      expiresAt: Timestamp.fromMillis(expiresMs),
      qrToken,
      updatedAt: serverTimestamp(),
    });
    return { expiresAt: expiresMs, qrToken };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function regenerateQuizQr(quizId: string): Promise<string> {
  const qrToken = generateQrToken();
  const path = `quizzes/${quizId}`;
  try {
    await updateDoc(doc(db, 'quizzes', quizId), {
      qrToken,
      updatedAt: serverTimestamp(),
    });
    return qrToken;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function extendQuizTime(
  quizId: string,
  currentExpiresAtMs: number | null,
  minutes = 5
): Promise<number> {
  const baseMs = Math.max(Date.now(), currentExpiresAtMs ?? Date.now());
  const nextExpiresMs = baseMs + Math.round(minutes * 60 * 1000);
  const path = `quizzes/${quizId}`;
  try {
    await updateDoc(doc(db, 'quizzes', quizId), {
      status: 'active',
      expiresAt: Timestamp.fromMillis(nextExpiresMs),
      updatedAt: serverTimestamp(),
    });
    return nextExpiresMs;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function endQuizEarly(quizId: string): Promise<void> {
  const path = `quizzes/${quizId}`;
  try {
    await updateDoc(doc(db, 'quizzes', quizId), {
      status: 'expired',
      expiresAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
