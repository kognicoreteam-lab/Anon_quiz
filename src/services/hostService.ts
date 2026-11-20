import type {
  PollResultsPayload,
  Quiz,
  QuizQuestion,
  QuizSubmission,
  QuizSummary,
  SessionMode,
} from '../types/quiz.ts';
import { apiRequest, getStoredHostToken } from './httpClient.ts';

function openHostEventStream(): EventSource | null {
  const token = getStoredHostToken();
  if (!token || typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return null;
  }
  return new EventSource(`/api/events/host?token=${encodeURIComponent(token)}`);
}

export function subscribeHostQuizzes(
  _hostUid: string,
  onQuizzes: (quizzes: Quiz[]) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const fetchList = async () => {
    try {
      const data = await apiRequest<{ quizzes: Quiz[] }>('/api/host/quizzes', { auth: true });
      if (active) onQuizzes(data.quizzes);
    } catch (err) {
      if (active) onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  void fetchList();

  const es = openHostEventStream();
  if (es) {
    es.addEventListener('quizzes_updated', (ev) => {
      if (!active) return;
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { quizzes: Quiz[] };
        if (Array.isArray(parsed.quizzes)) {
          onQuizzes(parsed.quizzes);
        }
      } catch {
        void fetchList();
      }
    });
  }

  // Periodic background sync keeps state fresh even on serverless deployments
  const pollId = window.setInterval(() => {
    void fetchList();
  }, 15_000);

  return () => {
    active = false;
    es?.close();
    window.clearInterval(pollId);
  };
}

export function subscribeHostQuizDoc(
  quizId: string,
  onQuiz: (quiz: Quiz | null) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const fetchQuiz = async () => {
    try {
      const data = await apiRequest<{ quiz: Quiz }>(`/api/host/quizzes/${encodeURIComponent(quizId)}`, {
        auth: true,
      });
      if (active) onQuiz(data.quiz);
    } catch (err) {
      if (active) onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  void fetchQuiz();

  const es = openHostEventStream();
  if (es) {
    es.addEventListener('quiz_detail_updated', (ev) => {
      if (!active) return;
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as { quiz: Quiz };
        if (parsed.quiz && parsed.quiz.id === quizId) {
          onQuiz(parsed.quiz);
        }
      } catch {
        void fetchQuiz();
      }
    });
  }

  return () => {
    active = false;
    es?.close();
  };
}

export function subscribeQuizSubmissions(
  quizId: string,
  _hostUid: string,
  onSubmissions: (submissions: QuizSubmission[]) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  const fetchSubs = async () => {
    try {
      const data = await apiRequest<{ submissions: QuizSubmission[] }>(
        `/api/host/quizzes/${encodeURIComponent(quizId)}/submissions`,
        { auth: true }
      );
      if (active) onSubmissions(data.submissions);
    } catch (err) {
      if (active) onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  void fetchSubs();

  const es = openHostEventStream();
  if (es) {
    es.addEventListener('submissions_updated', (ev) => {
      if (!active) return;
      try {
        const parsed = JSON.parse((ev as MessageEvent).data) as {
          quizId: string;
          submissions: QuizSubmission[];
        };
        if (parsed.quizId === quizId && Array.isArray(parsed.submissions)) {
          onSubmissions(parsed.submissions);
        }
      } catch {
        void fetchSubs();
      }
    });
  }

  const pollId = window.setInterval(() => {
    void fetchSubs();
  }, 10_000);

  return () => {
    active = false;
    es?.close();
    window.clearInterval(pollId);
  };
}

export async function createQuiz(payload: {
  hostUid?: string;
  mode?: SessionMode;
  title: string;
  description: string;
  questions: QuizQuestion[];
}): Promise<QuizSummary> {
  const data = await apiRequest<{ quiz: QuizSummary }>('/api/host/quizzes', {
    method: 'POST',
    auth: true,
    body: {
      mode: payload.mode ?? 'quiz',
      title: payload.title,
      description: payload.description,
      questions: payload.questions,
    },
  });
  return data.quiz;
}

export async function createSampleQuiz(
  _hostUid?: string,
  mode: SessionMode = 'quiz'
): Promise<QuizSummary> {
  const data = await apiRequest<{ quiz: QuizSummary }>('/api/host/quizzes/sample', {
    method: 'POST',
    auth: true,
    body: { mode },
  });
  return data.quiz;
}

export async function fetchHostPollResults(quizId: string): Promise<PollResultsPayload> {
  const data = await apiRequest<{ results: PollResultsPayload }>(
    `/api/host/quizzes/${encodeURIComponent(quizId)}/poll-results`,
    { auth: true }
  );
  return data.results;
}

export async function updateQuiz(
  quizId: string,
  payload: {
    title: string;
    description: string;
    questions: QuizQuestion[];
  }
): Promise<void> {
  await apiRequest(`/api/host/quizzes/${encodeURIComponent(quizId)}`, {
    method: 'PUT',
    auth: true,
    body: payload,
  });
}

export async function deleteQuiz(
  quizId: string,
  _joinCode?: string,
  _hostUid?: string
): Promise<void> {
  await apiRequest(`/api/host/quizzes/${encodeURIComponent(quizId)}`, {
    method: 'DELETE',
    auth: true,
  });
}

export async function launchQuiz(
  quizId: string,
  durationMinutes: number
): Promise<{ expiresAt: number; qrToken: string }> {
  const data = await apiRequest<{ expiresAt: number; qrToken: string }>(
    `/api/host/quizzes/${encodeURIComponent(quizId)}/launch`,
    {
      method: 'POST',
      auth: true,
      body: { durationMinutes },
    }
  );
  return data;
}

export async function regenerateQuizQr(quizId: string): Promise<string> {
  const data = await apiRequest<{ qrToken: string }>(
    `/api/host/quizzes/${encodeURIComponent(quizId)}/regenerate-qr`,
    {
      method: 'POST',
      auth: true,
    }
  );
  return data.qrToken;
}

export async function extendQuizTime(
  quizId: string,
  _currentExpiresAtMs: number | null,
  minutes = 5
): Promise<number> {
  const data = await apiRequest<{ expiresAt: number }>(
    `/api/host/quizzes/${encodeURIComponent(quizId)}/extend`,
    {
      method: 'POST',
      auth: true,
      body: { minutes },
    }
  );
  return data.expiresAt;
}

export async function endQuizEarly(quizId: string): Promise<void> {
  await apiRequest(`/api/host/quizzes/${encodeURIComponent(quizId)}/end`, {
    method: 'POST',
    auth: true,
  });
}
