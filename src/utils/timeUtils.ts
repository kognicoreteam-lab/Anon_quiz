import type { Quiz, QuizStatus } from '../types/quiz.ts';

export function computeEffectiveQuizStatus(
  quiz: Pick<Quiz, 'status' | 'expiresAt'>,
  nowMs: number = Date.now()
): QuizStatus {
  if (quiz.status === 'draft') {
    return 'draft';
  }
  if (quiz.status === 'expired') {
    return 'expired';
  }
  if (quiz.expiresAt !== null && nowMs >= quiz.expiresAt) {
    return 'expired';
  }
  return 'active';
}

export function getRemainingMs(
  expiresAt: number | null,
  nowMs: number = Date.now()
): number {
  if (expiresAt === null) return 0;
  return Math.max(0, expiresAt - nowMs);
}

export function formatCountdown(remainingMs: number): string {
  const clampedSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(clampedSeconds / 3600);
  const minutes = Math.floor((clampedSeconds % 3600) / 60);
  const seconds = clampedSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
