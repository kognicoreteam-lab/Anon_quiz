import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  QrCode,
  ClipboardCheck,
  Pencil,
  Trash2,
  LogOut,
  Search,
  Clock,
  Home,
  FilePlus2,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import { useLiveClock } from '../../hooks/useLiveClock.ts';
import type { Quiz, QuizQuestion, QuizStatus, QuizSubmission, QuizSummary } from '../../types/quiz.ts';
import {
  buildQuizSummaryFromSubmissions,
  createQuiz,
  createSampleQuiz,
  deleteQuiz,
  subscribeHostQuizzes,
  subscribeQuizSubmissions,
  updateQuiz,
} from '../../services/index.ts';
import {
  computeEffectiveQuizStatus,
  formatCountdown,
  getRemainingMs,
} from '../../utils/timeUtils.ts';
import { QuizBuilder } from './QuizBuilder.tsx';
import { LaunchQRModal } from './LaunchQRModal.tsx';
import { HostReviewPanel } from './HostReviewPanel.tsx';

interface HostDashboardProps {
  onNavigate: (path: string) => void;
}

type DashboardView =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; quiz: QuizSummary }
  | { kind: 'review'; quizId: string };

type StatusFilter = 'all' | QuizStatus;

export function HostDashboard({ onNavigate }: HostDashboardProps) {
  const { user, signOut } = useAuth();
  const { showToast } = useToast();

  const [rawQuizzes, setRawQuizzes] = useState<Quiz[]>([]);
  const [submissionsByQuiz, setSubmissionsByQuiz] = useState<Record<string, QuizSubmission[]>>({});
  const [loading, setLoading] = useState(true);
  const [creatingSample, setCreatingSample] = useState(false);

  const [view, setView] = useState<DashboardView>({ kind: 'list' });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [launchModalQuizId, setLaunchModalQuizId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const nowMs = useLiveClock();

  // Subscribe to host's quizzes in real time via Firestore onSnapshot
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    const unsub = subscribeHostQuizzes(
      user.uid,
      (list) => {
        setRawQuizzes(list);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        showToast(err.message || 'Unable to sync quizzes.', 'error');
      }
    );
    return unsub;
  }, [user, showToast]);

  // Subscribe to submissions for each quiz in real time so counts and pending reviews stay live
  const quizIdsKey = useMemo(() => rawQuizzes.map((q) => q.id).join(','), [rawQuizzes]);

  useEffect(() => {
    if (!user || rawQuizzes.length === 0) return;
    const unsubs = rawQuizzes.map((quiz) =>
      subscribeQuizSubmissions(quiz.id, user.uid, (subs) => {
        setSubmissionsByQuiz((prev) => ({
          ...prev,
          [quiz.id]: subs,
        }));
      })
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user, quizIdsKey]);


  const quizzes: QuizSummary[] = useMemo(
    () =>
      rawQuizzes.map((q) =>
        buildQuizSummaryFromSubmissions(q, submissionsByQuiz[q.id] || [])
      ),
    [rawQuizzes, submissionsByQuiz]
  );

  const handleSaveNewQuiz = async (payload: {
    title: string;
    description: string;
    questions: QuizQuestion[];
  }) => {
    if (!user) return;
    await createQuiz({
      hostUid: user.uid,
      ...payload,
    });
    setView({ kind: 'list' });
    showToast('Quiz created!', 'success');
  };

  const handleCreateSample = async () => {
    if (!user) return;
    setCreatingSample(true);
    try {
      await createSampleQuiz(user.uid);
      showToast('Sample quiz added to your dashboard!', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to create sample quiz.', 'error');
    } finally {
      setCreatingSample(false);
    }
  };

  const handleSaveEditedQuiz = async (
    quizId: string,
    payload: {
      title: string;
      description: string;
      questions: QuizQuestion[];
    }
  ) => {
    await updateQuiz(quizId, payload);
    setView({ kind: 'list' });
    showToast('Quiz changes saved!', 'success');
  };

  const handleDeleteQuiz = async (quiz: QuizSummary) => {
    if (!user) return;
    try {
      await deleteQuiz(quiz.id, quiz.joinCode, user.uid);
      setConfirmDeleteId(null);
      showToast('Quiz deleted.', 'info');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to delete quiz.', 'error');
    }
  };

  const quizzesWithLiveStatus = quizzes.map((q) => ({
    ...q,
    effectiveStatus: computeEffectiveQuizStatus(q, nowMs),
  }));

  const filteredQuizzes = quizzesWithLiveStatus.filter((q) => {
    if (statusFilter !== 'all' && q.effectiveStatus !== statusFilter) return false;
    if (searchQuery.trim()) {
      const needle = searchQuery.trim().toLowerCase();
      return (
        q.title.toLowerCase().includes(needle) ||
        q.joinCode.toLowerCase().includes(needle) ||
        q.description.toLowerCase().includes(needle)
      );
    }
    return true;
  });

  const activeCount = quizzesWithLiveStatus.filter((q) => q.effectiveStatus === 'active').length;
  const totalSubmissions = quizzes.reduce((acc, q) => acc + q.submissionCount, 0);
  const totalPending = quizzes.reduce((acc, q) => acc + q.pendingReviewCount, 0);

  const launchModalQuiz = quizzes.find((q) => q.id === launchModalQuizId) ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-4 min-w-0">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/');
              }}
              className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
            >
              AnonQuiz
            </a>
            <span className="hidden sm:inline text-slate-300" aria-hidden="true">/</span>
            <span className="hidden sm:inline text-sm font-medium text-slate-600 truncate">
              Host Dashboard
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              <Home className="w-4 h-4" />
              Join View
            </button>
            <div className="hidden md:flex items-center gap-2.5">
              {user?.photoURL && (
                <img
                  src={user.photoURL}
                  alt={user.displayName}
                  referrerPolicy="no-referrer"
                  className="w-7 h-7 rounded-full object-cover border border-slate-200"
                />
              )}
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-900 leading-tight">
                  {user?.displayName}
                </p>
                <p className="text-xs text-slate-500 leading-tight">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void signOut().then(() => onNavigate('/'));
              }}
              aria-label="Sign out of Host Mode"
              className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {view.kind === 'create' && (
          <QuizBuilder
            onSave={handleSaveNewQuiz}
            onCancel={() => setView({ kind: 'list' })}
          />
        )}

        {view.kind === 'edit' && (
          <QuizBuilder
            initialQuiz={view.quiz}
            onSave={(payload) => handleSaveEditedQuiz(view.quiz.id, payload)}
            onCancel={() => setView({ kind: 'list' })}
          />
        )}

        {view.kind === 'review' && (
          <HostReviewPanel
            quizId={view.quizId}
            onBack={() => setView({ kind: 'list' })}
          />
        )}

        {view.kind === 'list' && (
          <div className="space-y-6">
            {/* Page Heading + Primary CTA */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Your Quizzes
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Create timed assessments, display QR join codes, and grade anonymous submissions in real time.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setView({ kind: 'create' })}
                className="h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                New Quiz
              </button>
            </div>

            {/* Structured KPI Strip */}
            <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-slate-200">
              <div className="p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-500">Total Quizzes</p>
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                  {quizzes.length}
                </p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-500">Active Sessions</p>
                <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                  {activeCount}
                </p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-500">Anonymous Submissions</p>
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                  {totalSubmissions}
                </p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-500">Pending Host Reviews</p>
                <p className="mt-1 font-mono text-2xl font-bold text-amber-700 tabular-nums">
                  {totalPending}
                </p>
              </div>
            </div>

            {/* Filters & Search Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg self-start" role="group" aria-label="Filter quizzes by status">
                {(['all', 'active', 'draft', 'expired'] as StatusFilter[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                      statusFilter === status
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {status}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Search quizzes"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title or join code..."
                  className="w-full h-9 pl-9 pr-3 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>
            </div>

            {/* Quiz List */}
            {loading ? (
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="p-5 animate-pulse flex items-center justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-slate-200 rounded w-1/3" />
                      <div className="h-3 bg-slate-100 rounded w-1/2" />
                    </div>
                    <div className="h-9 bg-slate-100 rounded w-36" />
                  </div>
                ))}
              </div>
            ) : filteredQuizzes.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  {quizzes.length === 0 ? 'Create your first anonymous quiz' : 'No matching quizzes'}
                </h2>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  {quizzes.length === 0
                    ? 'Build multiple-choice, short-answer, and paragraph questions, then launch a time-limited QR code for participants.'
                    : 'Adjust your status filter or search query to see other quizzes.'}
                </p>
                {quizzes.length === 0 && (
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => setView({ kind: 'create' })}
                      className="h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Create First Quiz
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateSample}
                      disabled={creatingSample}
                      className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium inline-flex items-center gap-2 transition-colors disabled:opacity-60"
                    >
                      {creatingSample ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FilePlus2 className="w-4 h-4 text-indigo-600" />
                      )}
                      Load Sample Quiz
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
                {filteredQuizzes.map((quiz) => {
                  const status = quiz.effectiveStatus;
                  const remainingMs = getRemainingMs(quiz.expiresAt, nowMs);
                  const statusTextClass =
                    status === 'active'
                      ? 'text-emerald-700 font-semibold'
                      : status === 'expired'
                        ? 'text-rose-700 font-medium'
                        : 'text-slate-600 font-medium';
                  const statusLabel =
                    status === 'active' ? 'Active' : status === 'expired' ? 'Expired' : 'Draft';

                  return (
                    <div
                      key={quiz.id}
                      className="p-5 sm:px-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/60 transition-colors"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <h2 className="font-display text-base font-bold text-slate-900 truncate">
                            {quiz.title}
                          </h2>
                          <span className={`text-xs ${statusTextClass}`}>{statusLabel}</span>
                          {status === 'active' && (
                            <>
                              <span className="text-slate-300" aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-indigo-700 tabular-nums">
                                <Clock className="w-3.5 h-3.5" />
                                {formatCountdown(remainingMs)} left
                              </span>
                            </>
                          )}
                        </div>

                        {quiz.description && (
                          <p className="text-sm text-slate-600 line-clamp-1">{quiz.description}</p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 tabular-nums">
                          <span>
                            Code <strong className="font-mono text-slate-800">{quiz.joinCode}</strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {quiz.questions.length} {quiz.questions.length === 1 ? 'question' : 'questions'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {quiz.submissionCount}{' '}
                            {quiz.submissionCount === 1 ? 'submission' : 'submissions'}
                          </span>
                          {quiz.pendingReviewCount > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-700 font-medium">
                                {quiz.pendingReviewCount} pending review
                              </span>
                            </>
                          )}
                          {quiz.averageScorePercent !== null && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Avg {quiz.averageScorePercent}%</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Row Actions */}
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setLaunchModalQuizId(quiz.id)}
                          className={`h-9 px-3.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                            status === 'active'
                              ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                              : 'border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                          }`}
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          {status === 'active' ? 'Live QR & Timer' : 'Launch Quiz'}
                        </button>

                        <button
                          type="button"
                          onClick={() => setView({ kind: 'review', quizId: quiz.id })}
                          className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5 text-slate-600" />
                          Review ({quiz.submissionCount})
                        </button>

                        <button
                          type="button"
                          onClick={() => setView({ kind: 'edit', quiz })}
                          aria-label={`Edit ${quiz.title}`}
                          className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>

                        {confirmDeleteId === quiz.id ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleDeleteQuiz(quiz)}
                              className="h-9 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium whitespace-nowrap shrink-0"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="h-9 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 whitespace-nowrap shrink-0"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(quiz.id)}
                            aria-label={`Delete ${quiz.title}`}
                            className="h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 text-slate-500 hover:text-rose-700 inline-flex items-center justify-center transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {launchModalQuiz && (
        <LaunchQRModal
          quiz={launchModalQuiz}
          onClose={() => setLaunchModalQuizId(null)}
          onOpenParticipantLink={(targetPath) => {
            setLaunchModalQuizId(null);
            onNavigate(targetPath);
          }}
        />
      )}
    </div>
  );
}
