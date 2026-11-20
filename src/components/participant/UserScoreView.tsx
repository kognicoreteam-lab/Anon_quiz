import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  SlidersHorizontal,
  ArrowLeft,
  MessageSquare,
  RefreshCw,
} from 'lucide-react';
import type { SubmissionResultPayload } from '../../types/quiz.ts';
import {
  calculateScorePercent,
  formatQuestionTypeLabel,
  summarizeMarksBreakdown,
} from '../../utils/gradingUtils.ts';
import { fetchSubmissionBySession, subscribeParticipantResult } from '../../services/index.ts';
import { useToast } from '../../context/ToastContext.tsx';

interface UserScoreViewProps {
  initialResult: SubmissionResultPayload;
  onNavigateHome: () => void;
}

export function UserScoreView({ initialResult, onNavigateHome }: UserScoreViewProps) {
  const { showToast } = useToast();
  const [result, setResult] = useState<SubmissionResultPayload>(initialResult);
  const [refreshing, setRefreshing] = useState(false);

  const { quiz, submission } = result;
  const percent = calculateScorePercent(submission.totalScore, submission.maxScore);
  const marksBreakdown = summarizeMarksBreakdown(quiz.questions, submission.grading);

  const lastSignatureRef = useRef(
    `${initialResult.submission.totalScore}|${initialResult.submission.reviewStatus}`
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  // Subscribe to real-time Firestore host grading & answer key recalculation updates
  useEffect(() => {
    const unsubscribe = subscribeParticipantResult(quiz.id, submission.id, (latest) => {
      const nextSig = `${latest.submission.totalScore}|${latest.submission.reviewStatus}`;
      if (nextSig !== lastSignatureRef.current) {
        lastSignatureRef.current = nextSig;
        showToast('Your marks were updated by the host!', 'success');
      }
      setResult(latest);
    });

    return unsubscribe;
  }, [quiz.id, submission.id, showToast]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const check = await fetchSubmissionBySession(quiz.id, submission.sessionToken);
      if (check.found && check.result) {
        setResult(check.result);
      }
    } catch {
      // ignore transient error
    } finally {
      setRefreshing(false);
    }
  };

  const reviewStatusMeta =
    submission.reviewStatus === 'reviewed'
      ? {
          label: 'Reviewed by Host · Final Marks Published',
          description:
            'Your host has reviewed your answers and finalized your marks and feedback below.',
          colorClass: 'text-emerald-700',
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
        }
      : submission.reviewStatus === 'pending'
        ? {
            label: 'Pending Host Review',
            description:
              'Multiple-choice marks are shown now. Your written short-answer and paragraph marks will appear here automatically as soon as the host reviews your submission.',
            colorClass: 'text-amber-700',
            icon: <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
          }
        : {
            label: 'Auto-Graded',
            description:
              'Scored automatically against the quiz answer key. Any future key corrections or host marks adjustments will update here live.',
            colorClass: 'text-indigo-700',
            icon: <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />,
          };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Compact Header */}
      <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto h-full px-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onNavigateHome}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            AnonQuiz Home
          </button>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="h-8 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Marks
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 sm:py-10 space-y-6">
        {/* Marks & Score Summary Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
            <div className="space-y-2 min-w-0">
              <p className="text-xs font-mono text-slate-500">
                {submission.anonId}
                {submission.alias ? ` · ${submission.alias}` : ''} · Code {quiz.joinCode}
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {quiz.title}
              </h1>

              <div className="pt-2 flex items-start gap-2">
                {reviewStatusMeta.icon}
                <div>
                  <p
                    data-testid="review-status-label"
                    className={`text-sm font-semibold ${reviewStatusMeta.colorClass}`}
                  >
                    {reviewStatusMeta.label}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed max-w-lg">
                    {reviewStatusMeta.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Primary Marks Readout */}
            <div className="sm:text-right shrink-0 pt-4 sm:pt-0 border-t sm:border-t-0 border-slate-100">
              <p className="text-xs font-medium text-slate-500">Total Marks Awarded</p>
              <p
                data-testid="participant-total-score"
                className="font-mono text-4xl font-bold text-slate-900 tabular-nums tracking-tight mt-1"
              >
                {submission.totalScore}
                <span className="text-xl text-slate-400 font-medium"> / {submission.maxScore}</span>
              </p>
              <p className="font-mono text-sm font-semibold text-indigo-700 tabular-nums mt-0.5">
                {percent}%
              </p>
            </div>
          </div>

          {/* Structured Marks Breakdown Strip (MCQ vs Host-Reviewed Written Marks) */}
          {(marksBreakdown.hasMcqQuestions || marksBreakdown.hasManualQuestions) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-5 border-t border-slate-100">
              {marksBreakdown.hasMcqQuestions && (
                <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <p className="text-xs font-medium text-slate-500">Multiple-Choice Marks</p>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {marksBreakdown.mcqEarned}{' '}
                    <span className="text-sm font-medium text-slate-400">/ {marksBreakdown.mcqMax} marks</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Auto-graded against answer key</p>
                </div>
              )}

              {marksBreakdown.hasManualQuestions && (
                <div
                  className={`p-3.5 rounded-lg border ${
                    marksBreakdown.pendingManualCount === 0
                      ? 'bg-emerald-50/50 border-emerald-200/80'
                      : 'bg-amber-50/50 border-amber-200/80'
                  }`}
                >
                  <p className="text-xs font-medium text-slate-600">Host-Reviewed Written Marks</p>
                  <p className="mt-1 font-mono text-lg font-bold text-slate-900 tabular-nums">
                    {marksBreakdown.manualEarned}{' '}
                    <span className="text-sm font-medium text-slate-400">
                      / {marksBreakdown.manualMax} marks
                    </span>
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 tabular-nums">
                    {marksBreakdown.pendingManualCount === 0
                      ? `All ${marksBreakdown.totalManualCount} written ${marksBreakdown.totalManualCount === 1 ? 'answer' : 'answers'} marked by host`
                      : `${marksBreakdown.pendingManualCount} of ${marksBreakdown.totalManualCount} awaiting host marks`}
                  </p>
                </div>
              )}
            </div>
          )}

          {submission.autoSubmitted && (
            <p className="pt-4 border-t border-slate-100 text-xs text-slate-500">
              Note: This quiz was automatically submitted when the session timer expired.
            </p>
          )}
        </section>

        {/* Question-by-Question Marks & Feedback Breakdown */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-slate-900">
              Question-by-Question Marks
            </h2>
            <span className="text-xs text-slate-500">Updates automatically when host saves marks</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            {quiz.questions.map((q, idx) => {
              const userAnswer = submission.answers[q.id];
              const grade = submission.grading[q.id] || {
                outcome: 'pending',
                isCorrect: false,
                pointsAwarded: 0,
                feedback: '',
              };

              const answerText =
                q.type === 'mcq'
                  ? Array.isArray(userAnswer) && userAnswer.length > 0
                    ? userAnswer
                        .map((optIdx) => `${String.fromCharCode(65 + optIdx)}. ${q.options[optIdx] ?? ''}`)
                        .join(' · ')
                    : 'Not answered'
                  : typeof userAnswer === 'string' && userAnswer.trim()
                    ? userAnswer
                    : 'Not answered';

              const correctKeyText =
                q.type === 'mcq' && Array.isArray(q.correctAnswer)
                  ? q.correctAnswer
                      .map((optIdx) => `${String.fromCharCode(65 + optIdx)}. ${q.options[optIdx] ?? ''}`)
                      .join(' · ')
                  : null;

              const outcomeDisplay =
                grade.outcome === 'correct'
                  ? {
                      text: 'Correct',
                      cls: 'text-emerald-700',
                      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />,
                    }
                  : grade.outcome === 'partial'
                    ? {
                        text: 'Partial Marks',
                        cls: 'text-amber-700',
                        icon: <SlidersHorizontal className="w-4 h-4 text-amber-600 shrink-0" />,
                      }
                    : grade.outcome === 'pending'
                      ? {
                          text: 'Awaiting Host Review',
                          cls: 'text-amber-700',
                          icon: <Clock className="w-4 h-4 text-amber-600 shrink-0" />,
                        }
                      : {
                          text: 'Incorrect',
                          cls: 'text-rose-700',
                          icon: <XCircle className="w-4 h-4 text-rose-600 shrink-0" />,
                        };

              return (
                <article key={q.id} className="p-5 sm:p-6 space-y-3">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-slate-500">
                        Question {idx + 1} · {formatQuestionTypeLabel(q.type)}
                      </p>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {outcomeDisplay.icon}
                        <span className={`text-xs font-semibold ${outcomeDisplay.cls}`}>
                          {outcomeDisplay.text}
                        </span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums">
                          {grade.outcome === 'pending'
                            ? `Pending / ${q.points} marks`
                            : `Marks given: ${grade.pointsAwarded} / ${q.points}`}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                      {q.text}
                    </h3>
                  </div>

                  <div className="text-sm space-y-2.5 pt-1">
                    <div
                      className={
                        q.type === 'paragraph'
                          ? 'p-3.5 rounded-lg bg-slate-50 border border-slate-200/80'
                          : ''
                      }
                    >
                      <span className="text-xs font-medium text-slate-500 block mb-1">
                        Your Answer
                      </span>
                      <p className="text-slate-900 whitespace-pre-wrap leading-relaxed">
                        {answerText}
                      </p>
                    </div>

                    {correctKeyText && grade.outcome !== 'correct' && (
                      <div>
                        <span className="text-xs font-medium text-slate-500 block mb-0.5">
                          Correct Answer
                        </span>
                        <p className="text-emerald-800 font-medium">{correctKeyText}</p>
                      </div>
                    )}

                    {grade.feedback && (
                      <div className="mt-2 p-3 rounded-lg bg-indigo-50/70 border border-indigo-100 flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                        <div className="text-xs text-slate-800 leading-relaxed">
                          <span className="font-semibold text-indigo-900">Host feedback: </span>
                          <span>{grade.feedback}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
