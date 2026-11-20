import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase.ts';
import type { QuestionGrading, QuizQuestion } from '../types/quiz.ts';
import {
  finalizeManualGrading,
  recalculateSubmissionAfterKeyChange,
} from '../utils/gradingUtils.ts';
import { mapSubmissionDoc, sanitizeQuestions } from './mappers.ts';

export async function gradeSubmission(
  quizId: string,
  submissionId: string,
  quizQuestions: QuizQuestion[],
  gradingInput: Record<string, Partial<QuestionGrading>>
): Promise<void> {
  const finalized = finalizeManualGrading(quizQuestions, gradingInput);
  const path = `quizzes/${quizId}/submissions/${submissionId}`;
  try {
    await updateDoc(doc(db, 'quizzes', quizId, 'submissions', submissionId), {
      grading: finalized.grading,
      totalScore: finalized.totalScore,
      maxScore: finalized.maxScore,
      reviewStatus: finalized.reviewStatus,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recalculateAllScores(
  quizId: string,
  hostUid: string,
  updatedQuestions: QuizQuestion[]
): Promise<number> {
  const cleanQuestions = sanitizeQuestions(updatedQuestions);
  const path = `quizzes/${quizId}`;
  try {
    const subsQuery = query(
      collection(db, 'quizzes', quizId, 'submissions'),
      where('hostUid', '==', hostUid)
    );
    const subsSnap = await getDocs(subsQuery);

    const batch = writeBatch(db);
    batch.update(doc(db, 'quizzes', quizId), {
      questions: cleanQuestions,
      updatedAt: serverTimestamp(),
    });

    for (const subDoc of subsSnap.docs) {
      const sub = mapSubmissionDoc(subDoc.id, subDoc.data());
      const recalc = recalculateSubmissionAfterKeyChange(cleanQuestions, sub);
      batch.update(subDoc.ref, {
        grading: recalc.grading,
        totalScore: recalc.totalScore,
        maxScore: recalc.maxScore,
        reviewStatus: recalc.reviewStatus,
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
    return subsSnap.size;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}
