import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Check, Send, Loader2, Shield } from 'lucide-react';
import type { PublicQuizView, SubmissionResultPayload, UserAnswerValue } from '../../types/quiz.ts';
import { countWords } from '../../utils/gradingUtils.ts';
import { formatCountdown, getRemainingMs } from '../../utils/timeUtils.ts';
import { submitQuizAnswers, subscribePublicQuiz } from '../../services/index.ts';
import { updateAnonSession } from '../../utils/anonSession.ts';
import { useToast } from '../../context/ToastContext.tsx';

interface QuizTakerProps {
  quiz: PublicQuizView;
  sessionToken: string;
  anonId: string;
  initialAlias?: string;
  onSubmitted: (result: SubmissionResultPayload) => void;
}

export function QuizTaker({
  quiz: initialQuiz,
  sessionToken,
  anonId,
  initialAlias = '',
  onSubmitted,
}: QuizTakerProps) {
  const { showToast } = useToast();

  const [quiz, setQuiz] = useState<PublicQuizView>(initialQuiz);
  const [alias, setAlias] = useState(initialAlias);
  const [answers, setAnswers] = useState<Record<string, UserAnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [remainingMs, setRemainingMs] = useState<number>(() =>
    getRemainingMs(initialQuiz.expiresAt, Date.now())
  );

  const answersRef = useRef(answers);
  answersRef.current = answers;
  const aliasRef = useRef(alias);
  aliasRef.current = alias;
  const hasSubmittedRef = useRef(false);
  const prevExpiresAtRef = useRef<number | null>(initialQuiz.expiresAt);

  const performSubmit = useCallback(
    async (autoSubmitted = false) => {
      if (hasSubmittedRef.current) return;
      hasSubmittedRef.current = true;
      setSubmitting(true);
      setSubmitError(null);

      try {
        const cleanAlias = aliasRef.current.trim() || undefined;
        const { result } = await submitQuizAnswers(quiz.id, {
          sessionToken,
          anonId,
          alias: cleanAlias,
          answers: answersRef.current,
          autoSubmitted,
        });

        updateAnonSession(quiz.id, {
          submissionId: result.submission.id,
          alias: cleanAlias,
          quizTitle: quiz.title,
          joinCode: quiz.joinCode,
        });

        showToast(
          autoSubmitted
            ? 'Time expired — your answers were submitted automatically.'
            : 'Quiz submitted!',
          autoSubmitted ? 'info' : 'success'
        );
        onSubmitted(result);
      } catch (err) {
        hasSubmittedRef.current = false;
        setSubmitError(err instanceof Error ? err.message : 'Unable to submit quiz.');
      } finally {
        setSubmitting(false);
      }
    },
    [quiz.id, quiz.title, quiz.joinCode, sessionToken, anonId, onSubmitted, showToast]
  );

  // Live countdown synced to expiresAt — auto-submits when hitting 00:00
  useEffect(() => {
    const tick = () => {
      const left = getRemainingMs(quiz.expiresAt, Date.now());
      setRemainingMs(left);
      if (left <= 0 && quiz.expiresAt !== null && !hasSubmittedRef.current) {
        void performSubmit(true);
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [quiz.expiresAt, performSubmit]);

  // Listen for live host timer extensions or early ending via Node.js SSE
  useEffect(() => {
    const unsubscribe = subscribePublicQuiz(quiz.id, (updated) => {
      if (!updated) return;
      if (
        updated.expiresAt &&
        prevExpiresAtRef.current &&
        updated.expiresAt > prevExpiresAtRef.current
      ) {
        showToast('Host extended the quiz timer!', 'info');
      }
      prevExpiresAtRef.current = updated.expiresAt;
      setQuiz((prev) => ({
        ...prev,
        status: updated.status,
        expiresAt: updated.expiresAt,
      }));
      if (updated.status === 'expired' && !hasSubmittedRef.current) {
        void performSubmit(true);
      }
    });
    return unsubscribe;
  }, [quiz.id, performSubmit, showToast]);

  const handleSelectMcq = (questionId: string, optionIndex: number, multiSelect: boolean) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionId]) ? (prev[questionId] as number[]) : [];
      if (!multiSelect) {
        return { ...prev, [questionId]: [optionIndex] };
      }
      const exists = current.includes(optionIndex);
      const next = exists
        ? current.filter((i) => i !== optionIndex)
        : [...current, optionIndex].sort((a, b) => a - b);
      return { ...prev, [questionId]: next };
    });
  };

  const handleShortAnswerChange = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const answeredCount = quiz.questions.reduce((count, q) => {
    const val = answers[q.id];
    if (q.type === 'mcq') {
      return Array.isArray(val) && val.length > 0 ? count + 1 : count;
    }
    return typeof val === 'string' && val.trim().length > 0 ? count + 1 : count;
  }, 0);

  const isUrgent = remainingMs > 0 && remainingMs <= 60_000;
  const isWarning = remainingMs > 60_000 && remainingMs <= 180_000;

  const progressPct =
    quiz.questions.length > 0 ? Math.round((answeredCount / quiz.questions.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Compact Sticky Header (<= 56px, respects 15% mobile sticky cap) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur border-b border-slate-200 relative">
        <div className="max-w-3xl mx-auto h-full px-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-slate-900 truncate">{quiz.title}</p>
            <p className="text-xs text-slate-500 font-mono truncate">
              {anonId} · {answeredCount}/{quiz.questions.length} answered
            </p>
          </div>

          <div
            data-testid="participant-countdown"
            className={`inline-flex items-center gap-1.5 font-mono text-sm sm:text-base font-bold tabular-nums shrink-0 ${
              isUrgent
                ? 'text-rose-700'
                : isWarning
                  ? 'text-amber-700'
                  : 'text-indigo-700'
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span>{formatCountdown(remainingMs)}</span>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-indigo-600 transition-transform duration-150 origin-left"
            style={{ transform: `scaleX(${progressPct / 100})` }}
          />
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 sm:py-10">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void performSubmit(false);
          }}
          className="space-y-6"
        >
          {/* Quiz Intro & Anonymous Identity Strip */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                <Shield className="w-3.5 h-3.5 text-indigo-600" />
                <span>Anonymous Session · {anonId}</span>
              </div>
              <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
                {quiz.title}
              </h1>
              {quiz.description && (
                <p className="text-sm text-slate-600 leading-relaxed">{quiz.description}</p>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100">
              <label htmlFor="optional-alias" className="block text-xs font-medium text-slate-700 mb-1.5">
                Optional Anonymous Alias (Leave blank to stay {anonId})
              </label>
              <input
                id="optional-alias"
                type="text"
                maxLength={40}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. Blue Fox"
                className="w-full sm:w-72 h-10 px-3 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
            </div>
          </div>

          {/* Questions */}
          {quiz.questions.map((q, index) => {
            const selectedIndices = Array.isArray(answers[q.id]) ? (answers[q.id] as number[]) : [];
            const textValue = typeof answers[q.id] === 'string' ? (answers[q.id] as string) : '';

            return (
              <section
                key={q.id}
                className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500 tabular-nums">
                      Question {index + 1} of {quiz.questions.length}
                      {q.type === 'mcq' && q.multiSelect ? ' · Select all that apply' : ''}
                      {q.type === 'paragraph' ? ' · Paragraph response' : ''}
                      {q.type === 'short_answer' ? ' · Short answer' : ''}
                    </p>
                    <h2 className="text-base font-semibold text-slate-900 leading-snug">
                      {q.text}
                    </h2>
                  </div>
                  <span className="text-xs font-mono font-medium text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                    {q.points} {q.points === 1 ? 'mark' : 'marks'}
                  </span>
                </div>

                {q.type === 'mcq' ? (
                  <div className="space-y-2.5" role="group" aria-label={`Options for question ${index + 1}`}>
                    {q.options.map((opt, optIdx) => {
                      const isSelected = selectedIndices.includes(optIdx);
                      const letter = String.fromCharCode(65 + optIdx);
                      return (
                        <button
                          key={optIdx}
                          type="button"
                          onClick={() => handleSelectMcq(q.id, optIdx, q.multiSelect)}
                          aria-pressed={isSelected}
                          className={`w-full min-h-[48px] px-4 py-3 rounded-lg border text-left flex items-center gap-3 transition-colors ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-50/70 text-slate-950 font-medium'
                              : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                          }`}
                        >
                          <span
                            className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-mono shrink-0 border transition-colors ${
                              isSelected
                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                : 'bg-slate-50 border-slate-300 text-slate-600'
                            }`}
                          >
                            {isSelected ? <Check className="w-3.5 h-3.5" /> : letter}
                          </span>
                          <span className="text-sm leading-snug">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : q.type === 'paragraph' ? (
                  <div className="space-y-1.5">
                    <label htmlFor={`ans-${q.id}`} className="sr-only">
                      Your paragraph answer for question {index + 1}
                    </label>
                    <textarea
                      id={`ans-${q.id}`}
                      rows={7}
                      maxLength={5000}
                      value={textValue}
                      onChange={(e) => handleShortAnswerChange(q.id, e.target.value)}
                      placeholder="Write a detailed paragraph answer here. You can use multiple paragraphs..."
                      className="w-full px-4 py-3 rounded-lg border border-slate-300 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 resize-y"
                    />
                    <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                      <span>Reviewed and marked by your host after submission</span>
                      <span className="font-mono">
                        {countWords(textValue)} {countWords(textValue) === 1 ? 'word' : 'words'} · {textValue.length}/5000
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label htmlFor={`ans-${q.id}`} className="sr-only">
                      Your answer for question {index + 1}
                    </label>
                    <textarea
                      id={`ans-${q.id}`}
                      rows={3}
                      maxLength={1500}
                      value={textValue}
                      onChange={(e) => handleShortAnswerChange(q.id, e.target.value)}
                      placeholder="Write your short response here..."
                      className="w-full px-3.5 py-3 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 resize-y"
                    />
                    <div className="flex items-center justify-end text-xs text-slate-500 font-mono tabular-nums">
                      {textValue.length}/1500
                    </div>
                  </div>
                )}
              </section>
            );
          })}

          {submitError && (
            <p role="alert" className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-sm font-medium text-rose-800">
              {submitError}
            </p>
          )}

          {/* Submit Footer */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-xs text-slate-600 tabular-nums">
              Answered <strong className="text-slate-900">{answeredCount}</strong> of{' '}
              <strong className="text-slate-900">{quiz.questions.length}</strong> questions. You can only submit once per browser session.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="h-11 px-6 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit Quiz
                </>
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
