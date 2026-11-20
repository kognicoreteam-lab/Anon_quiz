import { generateAnonId, generateId } from './qrUtils.ts';

export interface StoredAnonSession {
  quizId: string;
  quizTitle?: string;
  joinCode?: string;
  sessionToken: string;
  anonId: string;
  alias?: string;
  submissionId?: string;
  updatedAt: number;
}

const STORAGE_KEY = 'anonquiz_participant_sessions_v1';

function readAllSessions(): Record<string, StoredAnonSession> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllSessions(sessions: Record<string, StoredAnonSession>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // storage unavailable
  }
}

export function getOrCreateAnonSession(quizId: string, quizTitle?: string, joinCode?: string): StoredAnonSession {
  const all = readAllSessions();
  const existing = all[quizId];
  if (existing && existing.sessionToken && existing.anonId) {
    if ((quizTitle && existing.quizTitle !== quizTitle) || (joinCode && existing.joinCode !== joinCode)) {
      existing.quizTitle = quizTitle || existing.quizTitle;
      existing.joinCode = joinCode || existing.joinCode;
      existing.updatedAt = Date.now();
      writeAllSessions(all);
    }
    return existing;
  }

  const created: StoredAnonSession = {
    quizId,
    quizTitle,
    joinCode,
    sessionToken: generateId('anon_tok'),
    anonId: generateAnonId(),
    updatedAt: Date.now(),
  };
  all[quizId] = created;
  writeAllSessions(all);
  return created;
}

export function updateAnonSession(
  quizId: string,
  patch: Partial<Pick<StoredAnonSession, 'submissionId' | 'alias' | 'quizTitle' | 'joinCode'>>
): StoredAnonSession {
  const all = readAllSessions();
  const current = all[quizId] || getOrCreateAnonSession(quizId, patch.quizTitle, patch.joinCode);
  const updated: StoredAnonSession = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  all[quizId] = updated;
  writeAllSessions(all);
  return updated;
}

export function getStoredAnonSession(quizId: string): StoredAnonSession | null {
  const all = readAllSessions();
  return all[quizId] || null;
}

export function listRecentSubmittedSessions(): StoredAnonSession[] {
  const all = readAllSessions();
  return Object.values(all)
    .filter((s) => Boolean(s.submissionId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);
}
