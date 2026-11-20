import type {
  PollResultsPayload,
  PublicQuizView,
  SubmissionResultPayload,
  UserAnswerValue,
} from '../types/quiz.ts';
import { normalizeJoinCode } from '../utils/qrUtils.ts';
import { ApiError, apiRequest } from './httpClient.ts';

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
  const data = await apiRequest<{ quiz: PublicQuizView }>(
    `/api/public/join/${encodeURIComponent(normalized)}`
  );
  return data.quiz;
}

export async function fetchPublicQuiz(quizId: string): Promise<PublicQuizView | null> {
  try {
    const data = await apiRequest<{ quiz: PublicQuizView }>(
      `/api/public/quizzes/${encodeURIComponent(quizId)}`
    );
    return data.quiz;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function verifyHostQrCode(
  quizId: string,
  qrToken: string,
  sessionToken?: string
): Promise<HostQrVerificationResult> {
  return apiRequest<HostQrVerificationResult>('/api/public/verify-qr', {
    method: 'POST',
    body: { quizId, qrToken, sessionToken },
  });
}

export function subscribePublicQuiz(
  quizId: string,
  onQuiz: (quiz: PublicQuizView | null) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const fetchLatest = async () => {
    try {
      const quiz = await fetchPublicQuiz(quizId);
      if (active) onQuiz(quiz);
    } catch (err) {
      if (active) onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  let es: EventSource | null = null;
  if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
    es = new EventSource(`/api/events/quiz/${encodeURIComponent(quizId)}`);
    es.addEventListener('quiz_updated', (ev) => {
      if (!active) return;
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { quiz: PublicQuizView };
        if (parsed.quiz) {
          onQuiz(parsed.quiz);
        }
      } catch {
        void fetchLatest();
      }
    });
  }

  const pollId = window.setInterval(() => {
    void fetchLatest();
  }, 15_000);

  return () => {
    active = false;
    es?.close();
    window.clearInterval(pollId);
  };
}

export async function fetchSubmissionBySession(
  quizId: string,
  sessionToken: string
): Promise<{ found: boolean; result?: SubmissionResultPayload }> {
  return apiRequest<{ found: boolean; result?: SubmissionResultPayload }>(
    `/api/public/quizzes/${encodeURIComponent(quizId)}/submissions/${encodeURIComponent(sessionToken)}`
  );
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
  return apiRequest<{ result: SubmissionResultPayload; alreadySubmitted?: boolean }>(
    `/api/public/quizzes/${encodeURIComponent(quizId)}/submit`,
    {
      method: 'POST',
      body: payload,
    }
  );
}

export function subscribeParticipantResult(
  quizId: string,
  submissionId: string,
  onResult: (result: SubmissionResultPayload) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const fetchLatest = async () => {
    try {
      const check = await fetchSubmissionBySession(quizId, submissionId);
      if (active && check.found && check.result) {
        onResult(check.result);
      }
    } catch (err) {
      if (active) onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  let es: EventSource | null = null;
  if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
    es = new EventSource(
      `/api/events/result/${encodeURIComponent(quizId)}/${encodeURIComponent(submissionId)}`
    );
    es.addEventListener('result_updated', (ev) => {
      if (!active) return;
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as {
          result: SubmissionResultPayload;
        };
        if (parsed.result) {
          onResult(parsed.result);
        }
      } catch {
        void fetchLatest();
      }
    });
  }

  const pollId = window.setInterval(() => {
    void fetchLatest();
  }, 10_000);

  return () => {
    active = false;
    es?.close();
    window.clearInterval(pollId);
  };
}
