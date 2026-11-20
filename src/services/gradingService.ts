import type { QuestionGrading, QuizQuestion } from '../types/quiz.ts';
import { apiRequest } from './httpClient.ts';

export async function gradeSubmission(
  quizId: string,
  submissionId: string,
  _quizQuestions: QuizQuestion[],
  gradingInput: Record<string, Partial<QuestionGrading>>
): Promise<void> {
  await apiRequest(
    `/api/host/quizzes/${encodeURIComponent(quizId)}/submissions/${encodeURIComponent(submissionId)}/grade`,
    {
      method: 'PUT',
      auth: true,
      body: { grading: gradingInput },
    }
  );
}

export async function recalculateAllScores(
  quizId: string,
  _hostUid: string,
  updatedQuestions: QuizQuestion[]
): Promise<number> {
  const data = await apiRequest<{ updatedCount: number }>(
    `/api/host/quizzes/${encodeURIComponent(quizId)}/recalculate`,
    {
      method: 'POST',
      auth: true,
      body: { questions: updatedQuestions },
    }
  );
  return data.updatedCount;
}
