import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  X,
  SlidersHorizontal,
  Save,
  Loader2,
  Users,
  KeyRound,
} from 'lucide-react';
import type {
  GradingOutcome,
  QuestionGrading,
  Quiz,
  QuizQuestion,
  QuizSubmission,
} from '../../types/quiz.ts';
import {
  gradeSubmission,
  recalculateAllScores,
  subscribeQuizDoc,
  subscribeQuizSubmissions,
} from '../../services/index.ts';
import {
  calculateScorePercent,
  clampPoints,
  countWords,
  formatQuestionTypeLabel,
} from '../../utils/gradingUtils.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import { AnswerKeyEditor } from './AnswerKeyEditor.tsx';

interface HostReviewPanelProps {
  quizId: string;
  onBack: () => void;
}

type ReviewTab = 'submissions' | 'answer_key';

export function HostReviewPanel({ quizId, onBack }: HostReviewPanelProps) {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [submissions, setSubmissions] = useState<QuizSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ReviewTab>('submissions');
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  const [draftGrading, setDraftGrading] = useState<Record<string, QuestionGrading>>({});
  const [savingGrade, setSavingGrade] = useState(false);

  const [keyDraftQuestions, setKeyDraftQuestions] = useState<QuizQuestion[]>([]);
  const [recalculating, setRecalculating] = useState(false);
  const knownSubIdsRef = useRef<Set<string>>(new Set());
  const initializedSubsRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError(null);
    initializedSubsRef.current = false;
    knownSubIdsRef.current = new Set();

    const unsubQuiz = subscribeQuizDoc(
      quizId,
      (docQuiz) => {
        setQuiz(docQuiz);
        if (docQuiz) {
          setKeyDraftQuestions(
            docQuiz.questions.map((q) => ({
              ...q,
              options: [...q.options],
              correctAnswer: Array.isArray(q.correctAnswer)
                ? [...q.correctAnswer]
                : q.correctAnswer,
            }))
          );
        }
        setLoading(false);
      },
      (err) => {
        setError(err.message || 'Unable to load quiz.');
        setLoading(false);
      }
    );

    const unsubSubs = subscribeQuizSubmissions(
      quizId,
      user.uid,
      (subs) => {
        if (initializedSubsRef.current) {
          subs.forEach((s) => {
            if (!knownSubIdsRef.current.has(s.id)) {
              showToast(`New anonymous submission: ${s.anonId}`, 'info');
            }
          });
        }
        initializedSubsRef.current = true;
        knownSubIdsRef.current = new Set(subs.map((s) => s.id));
        setSubmissions(subs);
        setSelectedSubId((prev) => {
          if (prev && subs.some((s) => s.id === prev)) return prev;
          return subs[0]?.id ?? null;
        });
      },
      (err) => {
        setError(err.message || 'Unable to load submissions.');
      }
    );

    return () => {
      unsubQuiz();
      unsubSubs();
    };
  }, [quizId, user, showToast]);

  const selectedSubmission = submissions.find((s) => s.id === selectedSubId) ?? null;

  useEffect(() => {
    if (!selectedSubmission || !quiz) return;
    const nextDraft: Record<string, QuestionGrading> = {};
    for (const q of quiz.questions) {
      const existing = selectedSubmission.grading[q.id];
      nextDraft[q.id] = existing
        ? { ...existing }
        : {
            outcome: 'pending',
            isCorrect: false,
            pointsAwarded: 0,
            feedback: '',
          };
    }
    setDraftGrading(nextDraft);
  }, [
    selectedSubmission?.id,
    selectedSubmission?.totalScore,
    selectedSubmission?.reviewStatus,
    quiz,
  ]);

  const setQuestionOutcome = (q: QuizQuestion, outcome: GradingOutcome) => {
    const maxPts = q.points;
    let pts = 0;
    if (outcome === 'correct') pts = maxPts;
    else if (outcome === 'partial') pts = Math.round((maxPts / 2) * 10) / 10;
    else pts = 0;

    setDraftGrading((prev) => ({
      ...prev,
      [q.id]: {
        ...(prev[q.id] || { feedback: '' }),
        outcome,
        isCorrect: outcome === 'correct',
        pointsAwarded: pts,
        manuallyGraded: true,
      },
    }));
  };

  const setQuestionPoints = (q: QuizQuestion, rawValue: number) => {
    const pts = clampPoints(rawValue, q.points);
    const outcome: GradingOutcome =
      pts >= q.points && q.points > 0 ? 'correct' : pts > 0 ? 'partial' : 'incorrect';
    setDraftGrading((prev) => ({
      ...prev,
      [q.id]: {
        ...(prev[q.id] || { feedback: '' }),
        outcome,
        isCorrect: outcome === 'correct',
        pointsAwarded: pts,
        manuallyGraded: true,
      },
    }));
  };

  const setQuestionFeedback = (qId: string, feedback: string) => {
    setDraftGrading((prev) => ({
      ...prev,
      [qId]: {
        ...(prev[qId] || {
          outcome: 'pending',
          isCorrect: false,
          pointsAwarded: 0,
        }),
        feedback,
      },
    }));
  };

  const handleSaveGrade = async () => {
    if (!quiz || !selectedSubmission) return;
    setSavingGrade(true);
    try {
      await gradeSubmission(quiz.id, selectedSubmission.id, quiz.questions, draftGrading);
      showToast(`Marks published for ${selectedSubmission.anonId}!`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save grade.', 'error');
    } finally {
      setSavingGrade(false);
    }
  };


  const handleRecalculateAll = async () => {
    if (!quiz || !user) return;
    setRecalculating(true);
    try {
      const updatedCount = await recalculateAllScores(quiz.id, user.uid, keyDraftQuestions);
      showToast(`Recalculated scores for ${updatedCount} submission(s)!`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to recalculate scores.', 'error');
    } finally {
      setRecalculating(false);
    }
  };

  const draftTotalScore = quiz
    ? Math.round(
        quiz.questions.reduce((acc, q) => acc + (draftGrading[q.id]?.pointsAwarded ?? 0), 0) * 100
      ) / 100
    : 0;

  const pendingReviewCount = submissions.filter((s) => s.reviewStatus === 'pending').length;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-12 flex items-center justify-center gap-2.5 text-sm text-slate-600">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
        <span>Loading submissions...</span>
      </div>
    );
  }

  if (error || !quiz) {
    return (
      <div className="max-w-4xl mx-auto py-12 text-center space-y-4">
        <p className="text-sm text-rose-700 font-medium">{error || 'Quiz not found.'}</p>
        <button
          type="button"
          onClick={onBack}
          className="h-10 px-4 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 mb-6 border-b border-slate-200">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Dashboard
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900 truncate">
              {quiz.title}
            </h1>
            <p className="text-xs text-slate-500 tabular-nums mt-0.5">
              Code <span className="font-mono text-slate-700">{quiz.joinCode}</span> · {submissions.length}{' '}
              {submissions.length === 1 ? 'submission' : 'submissions'} · {pendingReviewCount} pending review
            </p>
          </div>
        </div>

        {/* Mode Switcher: Submissions vs Answer Key */}
        <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg shrink-0 self-start md:self-auto" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'submissions'}
            onClick={() => setActiveTab('submissions')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'submissions'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Submissions ({submissions.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'answer_key'}
            onClick={() => setActiveTab('answer_key')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'answer_key'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            Answer Key & Recalculate
          </button>
        </div>
      </div>

      {activeTab === 'submissions' ? (
        submissions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-2">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              No anonymous submissions yet
            </h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              Once participants join using code <span className="font-mono font-semibold">{quiz.joinCode}</span> and submit their answers, their entries will appear here automatically in real time.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Submissions List Column */}
            <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70">
                <h2 className="text-xs font-semibold text-slate-700">
                  Anonymous Participants
                </h2>
              </div>
              <ul className="divide-y divide-slate-100 max-h-[680px] overflow-y-auto">
                {submissions.map((sub) => {
                  const isSelected = sub.id === selectedSubmission?.id;
                  const pct = calculateScorePercent(sub.totalScore, sub.maxScore);
                  const statusLabel =
                    sub.reviewStatus === 'pending'
                      ? 'Pending Review'
                      : sub.reviewStatus === 'reviewed'
                        ? 'Reviewed'
                        : 'Auto-Graded';
                  const statusColor =
                    sub.reviewStatus === 'pending'
                      ? 'text-amber-700'
                      : sub.reviewStatus === 'reviewed'
                        ? 'text-emerald-700'
                        : 'text-slate-600';

                  return (
                    <li key={sub.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedSubId(sub.id)}
                        className={`w-full text-left px-4 py-3.5 transition-colors flex items-center justify-between gap-3 ${
                          isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 font-mono truncate">
                            {sub.anonId}
                            {sub.alias ? (
                              <span className="font-sans font-normal text-slate-500"> · {sub.alias}</span>
                            ) : null}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            <span className={`font-medium ${statusColor}`}>{statusLabel}</span>
                            <span aria-hidden="true"> · </span>
                            <span className="tabular-nums">
                              {new Date(sub.submittedAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-mono font-bold text-slate-900 tabular-nums">
                            {sub.totalScore} / {sub.maxScore}
                          </p>
                          <p className="text-xs font-mono text-slate-500 tabular-nums">{pct}%</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Selected Submission Grading Detail */}
            {selectedSubmission && (
              <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden">
                {/* Submission Header Bar */}
                <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50/60">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900 font-mono">
                      {selectedSubmission.anonId}
                      {selectedSubmission.alias ? (
                        <span className="font-sans font-normal text-slate-600"> ({selectedSubmission.alias})</span>
                      ) : null}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                      Draft total: <strong className="text-slate-900 font-mono">{draftTotalScore} / {selectedSubmission.maxScore}</strong> ({calculateScorePercent(draftTotalScore, selectedSubmission.maxScore)}%)
                      {' · '}
                      Current status:{' '}
                      <span className="font-medium text-slate-700">
                        {selectedSubmission.reviewStatus === 'pending'
                          ? 'Pending Host Review'
                          : selectedSubmission.reviewStatus === 'reviewed'
                            ? 'Reviewed by Host'
                            : 'Auto-Graded'}
                      </span>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveGrade}
                    disabled={savingGrade}
                    className="h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    {savingGrade ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save &amp; Publish Marks
                  </button>
                </div>

                {/* Question-by-Question Grading Rows */}
                <div className="divide-y divide-slate-200">
                  {quiz.questions.map((q, idx) => {
                    const userAnswer = selectedSubmission.answers[q.id];
                    const grade = draftGrading[q.id] || {
                      outcome: 'pending' as GradingOutcome,
                      isCorrect: false,
                      pointsAwarded: 0,
                      feedback: '',
                    };

                    const answerDisplay =
                      q.type === 'mcq'
                        ? Array.isArray(userAnswer) && userAnswer.length > 0
                          ? userAnswer
                              .map((optIdx) => {
                                const letter = String.fromCharCode(65 + optIdx);
                                return `${letter}. ${q.options[optIdx] ?? 'Unknown'}`;
                              })
                              .join(' · ')
                          : 'No option selected'
                        : typeof userAnswer === 'string' && userAnswer.trim()
                          ? userAnswer
                          : 'No answer provided';

                    const referenceDisplay =
                      q.type === 'mcq'
                        ? Array.isArray(q.correctAnswer)
                          ? q.correctAnswer
                              .map((optIdx) => `${String.fromCharCode(65 + optIdx)}. ${q.options[optIdx] ?? ''}`)
                              .join(' · ')
                          : ''
                        : typeof q.correctAnswer === 'string' && q.correctAnswer.trim()
                          ? q.correctAnswer
                          : 'None provided';

                    return (
                      <div key={q.id} className="p-5 sm:p-6 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-1 flex-1 min-w-0">
                            <p className="text-xs font-medium text-slate-500">
                              Question {idx + 1} · {formatQuestionTypeLabel(q.type)} · Max {q.points}{' '}
                              {q.points === 1 ? 'mark' : 'marks'}
                            </p>
                            <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                              {q.text}
                            </h3>
                          </div>
                        </div>

                        <div
                          className={`grid grid-cols-1 ${
                            q.type === 'paragraph' ? '' : 'md:grid-cols-2'
                          } gap-4 text-sm`}
                        >
                          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <p className="text-xs font-medium text-slate-500">Participant&apos;s Answer</p>
                              {q.type === 'paragraph' && typeof userAnswer === 'string' && userAnswer.trim() && (
                                <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                                  {countWords(userAnswer)} words
                                </span>
                              )}
                            </div>
                            <p className="text-slate-900 whitespace-pre-wrap leading-relaxed">{answerDisplay}</p>
                          </div>
                          <div className="p-3.5 rounded-lg bg-slate-50/50 border border-slate-200">
                            <p className="text-xs font-medium text-slate-500 mb-1">
                              {q.type === 'mcq'
                                ? 'Correct Answer Key'
                                : q.type === 'paragraph'
                                  ? 'Grading Rubric / Model Paragraph'
                                  : 'Reference Answer'}
                            </p>
                            <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{referenceDisplay}</p>
                          </div>
                        </div>

                        {/* Grading Controls */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                          <div className="inline-flex items-center gap-1.5" role="group" aria-label={`Mark question ${idx + 1}`}>
                            <button
                              type="button"
                              onClick={() => setQuestionOutcome(q, 'correct')}
                              className={`h-8 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                                grade.outcome === 'correct'
                                  ? 'bg-emerald-600 border-emerald-600 text-white'
                                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <Check className="w-3.5 h-3.5" />
                              Correct
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuestionOutcome(q, 'partial')}
                              className={`h-8 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                                grade.outcome === 'partial'
                                  ? 'bg-amber-600 border-amber-600 text-white'
                                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <SlidersHorizontal className="w-3.5 h-3.5" />
                              Partial Credit
                            </button>
                            <button
                              type="button"
                              onClick={() => setQuestionOutcome(q, 'incorrect')}
                              className={`h-8 px-3 rounded-md text-xs font-medium inline-flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
                                grade.outcome === 'incorrect'
                                  ? 'bg-rose-600 border-rose-600 text-white'
                                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <X className="w-3.5 h-3.5" />
                              Incorrect
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <label htmlFor={`award-${q.id}`} className="text-xs font-medium text-slate-600">
                              Marks awarded
                            </label>
                            <input
                              id={`award-${q.id}`}
                              type="number"
                              min={0}
                              max={q.points}
                              step={0.5}
                              value={grade.pointsAwarded}
                              onChange={(e) => setQuestionPoints(q, Number(e.target.value))}
                              className="w-20 h-8 px-2.5 rounded-md border border-slate-300 font-mono text-xs tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                            />
                            <span className="text-xs font-mono text-slate-500 tabular-nums">/ {q.points}</span>
                          </div>
                        </div>

                        {/* Optional Per-Question Feedback */}
                        <div>
                          <label htmlFor={`fb-${q.id}`} className="block text-xs font-medium text-slate-600 mb-1">
                            Host Feedback (Optional)
                          </label>
                          <input
                            id={`fb-${q.id}`}
                            type="text"
                            value={grade.feedback}
                            onChange={(e) => setQuestionFeedback(q.id, e.target.value)}
                            placeholder="Add a brief explanation or note visible on the participant's score page..."
                            className="w-full h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        <AnswerKeyEditor
          questions={keyDraftQuestions}
          submissionCount={submissions.length}
          recalculating={recalculating}
          onQuestionsChange={setKeyDraftQuestions}
          onRecalculateAll={handleRecalculateAll}
        />
      )}
    </div>
  );
}
