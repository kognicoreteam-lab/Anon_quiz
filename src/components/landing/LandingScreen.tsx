import React, { useState } from 'react';
import { ArrowRight, QrCode, CheckSquare, Clock, ShieldCheck, Loader2, History, ScanLine } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../../context/ToastContext.tsx';
import { lookupQuizByJoinCode } from '../../services/index.ts';
import { normalizeJoinCode } from '../../utils/qrUtils.ts';
import { listRecentSubmittedSessions } from '../../utils/anonSession.ts';
import { QrScannerModal } from '../participant/QrScannerModal.tsx';

interface LandingScreenProps {
  onNavigate: (path: string) => void;
}

export function LandingScreen({ onNavigate }: LandingScreenProps) {
  const { user, loading: authLoading, accessDeniedMessage, clearAccessDenied, signInWithGoogle } =
    useAuth();
  const { showToast } = useToast();

  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const recentSessions = listRecentSubmittedSessions();

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = normalizeJoinCode(joinCode);
    setJoinError(null);

    if (cleaned.length !== 6) {
      setJoinError('Enter a 6-character quiz code (letters and numbers).');
      return;
    }

    setJoining(true);
    try {
      const quiz = await lookupQuizByJoinCode(cleaned);
      onNavigate(`/quiz/${quiz.id}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Unable to find that quiz.');
    } finally {
      setJoining(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (user) {
      onNavigate('/host');
      return;
    }
    setAuthError(null);
    clearAccessDenied();
    setSigningIn(true);
    try {
      await signInWithGoogle();
      showToast('Signed in with Google', 'success');
      onNavigate('/host');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Google sign-in failed.';
      if (raw.includes('auth/popup-closed-by-user')) {
        setAuthError('Sign-in popup was closed before completing.');
      } else if (raw.includes('auth/popup-blocked')) {
        setAuthError('Popup was blocked by your browser. Please allow popups for this site and try again.');
      } else {
        setAuthError(raw);
      }
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-8">
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

          <nav aria-label="Primary" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#join-quiz" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Join Quiz
            </a>
            <a href="#host-mode" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Host Console
            </a>
            <a href="#workflow" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={signingIn || authLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              {user ? 'Open Dashboard' : signingIn ? 'Signing in...' : 'Host Sign In'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero & Dual Entry Section */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-12 sm:pt-14 sm:pb-16">
          <div className="max-w-3xl mb-10">
            <p className="text-sm font-medium text-indigo-600 mb-3">
              Zero-login anonymous assessments · Real-time host grading
            </p>
            <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12] text-balance">
              Run timed anonymous quizzes with live QR entry and instant score updates.
            </h1>
            <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed max-w-2xl">
              Participants scan a time-limited QR code or enter a 6-character code without creating an account. Hosts review open-ended answers, update keys, and push corrected scores in real time.
            </p>
          </div>

          {/* Two Clear Mode Entry Paths */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* User Mode (Anonymous Entry) */}
            <div
              id="join-quiz"
              className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-4 mb-2">
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    Join a Quiz Anonymously
                  </h2>
                  <span className="text-xs font-medium text-slate-500">No login required</span>
                </div>
                <p className="text-sm text-slate-600 mb-6">
                  Enter the 6-character code or scan the host&apos;s official quiz QR code without creating an account. Your browser saves an anonymous token so you can revisit your host-reviewed marks anytime.
                </p>

                <form onSubmit={handleJoinSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="quiz-join-code"
                      className="block text-sm font-medium text-slate-700 mb-1.5"
                    >
                      6-Character Quiz Code
                    </label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        id="quiz-join-code"
                        name="joinCode"
                        type="text"
                        inputMode="text"
                        autoComplete="off"
                        maxLength={8}
                        value={joinCode}
                        onChange={(e) => {
                          setJoinCode(e.target.value.toUpperCase());
                          if (joinError) setJoinError(null);
                        }}
                        placeholder="Q7X4M9"
                        className="flex-1 h-12 px-4 rounded-lg border border-slate-300 bg-white font-mono text-lg tracking-widest uppercase text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-indigo-600"
                      />
                      <button
                        type="submit"
                        disabled={joining}
                        className="h-12 px-6 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60"
                      >
                        {joining ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Checking...
                          </>
                        ) : (
                          <>
                            Join Quiz
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    </div>
                    {joinError && (
                      <p role="alert" className="mt-2 text-sm text-rose-700 font-medium">
                        {joinError}
                      </p>
                    )}
                  </div>

                  {/* Built-in Host-Only QR Scanner Trigger */}
                  <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800">
                        Have the host&apos;s QR code on screen?
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Built-in scanner opens only verified AnonQuiz host QR codes.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setScannerOpen(true)}
                      data-testid="open-qr-scanner-btn"
                      className="h-10 px-4 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-700 text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
                    >
                      <ScanLine className="w-4 h-4" />
                      Scan Host QR
                    </button>
                  </div>
                </form>
              </div>

              {recentSessions.length > 0 ? (
                <div className="mt-6 pt-5 border-t border-slate-200">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 mb-3">
                    <History className="w-3.5 h-3.5 text-slate-500" />
                    <span>Your Submitted Quizzes &amp; Marks</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {recentSessions.map((sess) => (
                      <li key={sess.quizId} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {sess.quizTitle || 'Quiz Session'}
                          </p>
                          <p className="text-xs text-slate-500 font-mono">
                            {sess.anonId}
                            {sess.joinCode ? ` · ${sess.joinCode}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigate(`/quiz/${sess.quizId}`)}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap shrink-0"
                        >
                          View Marks
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-6 pt-5 border-t border-slate-100 text-xs text-slate-500">
                  After submitting a quiz, return here or refresh your session link anytime to view the marks awarded by your host.
                </div>
              )}
            </div>

            {/* Host Mode Entry */}
            <div
              id="host-mode"
              className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-4 mb-2">
                  <h2 className="font-display text-xl font-bold text-slate-900">
                    Host Mode
                  </h2>
                  <span className="text-xs font-medium text-slate-500">Authorized hosts only</span>
                </div>
                <p className="text-sm text-slate-600 mb-6">
                  Sign in with your Google account to build MCQ, short-answer, and paragraph quizzes, generate a fresh QR code anytime, award marks with feedback, and recalculate scores live.
                </p>

                {user ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-3">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-full object-cover shrink-0 border border-slate-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-display font-bold text-sm flex items-center justify-center shrink-0">
                          {user.displayName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</p>
                        <p className="text-xs text-slate-600 truncate">{user.email}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('/host')}
                      className="w-full h-11 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      Go to Host Dashboard
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={signingIn || authLoading}
                      className="w-full h-11 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium inline-flex items-center justify-center gap-2.5 transition-colors disabled:opacity-60"
                    >
                      {signingIn ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="currentColor"
                            d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.24-.92 2.29-1.97 3v2.48h3.18c1.86-1.71 2.93-4.24 2.93-7.22 0-.4-.04-.79-.23-1.18z"
                          />
                          <path
                            fill="currentColor"
                            d="M12.17 22c2.66 0 4.89-.88 6.52-2.38l-3.18-2.48c-.88.59-2.01.94-3.34.94-2.57 0-4.74-1.73-5.52-4.06H3.37v2.56C5.01 19.83 8.33 22 12.17 22z"
                          />
                          <path
                            fill="currentColor"
                            d="M6.65 14.02c-.2-.59-.31-1.22-.31-1.87s.11-1.28.31-1.87V7.72H3.37A9.96 9.96 0 0 0 2.17 12.15c0 1.61.39 3.13 1.2 4.43l3.28-2.56z"
                          />
                          <path
                            fill="currentColor"
                            d="M12.17 6.22c1.45 0 2.75.5 3.77 1.48l2.83-2.83C17.05 3.26 14.83 2.3 12.17 2.3c-3.84 0-7.16 2.17-8.8 5.42l3.28 2.56c.78-2.33 2.95-4.06 5.52-4.06z"
                          />
                        </svg>
                      )}
                      {signingIn ? 'Signing in...' : 'Sign in with Google'}
                    </button>

                    {(authError || accessDeniedMessage) && (
                      <p
                        role="alert"
                        className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 font-medium leading-relaxed"
                      >
                        {authError || accessDeniedMessage}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-6 pt-5 border-t border-slate-100 text-xs text-slate-500">
                Real-time Firestore sync keeps submissions, timer extensions, and host score updates in lockstep.
              </div>
            </div>
          </div>
        </section>

        {/* How It Works — 3 crisp workflow steps */}
        <section id="workflow" className="border-t border-slate-200 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
            <h2 className="font-display text-2xl font-bold text-slate-900 mb-8">
              How AnonQuiz Works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <QrCode className="w-4 h-4" />
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  01. Time-Limited QR Launch
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Set an exact duration from 5 minutes to custom windows. Generate a scannable QR code and 6-character code that automatically locks when the timer hits 00:00.
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  02. Frictionless Anonymous Entry
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Participants receive a generated anonymous tag (like Anon-4821) stored locally in their browser. Duplicate submissions are blocked while score history stays accessible.
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <CheckSquare className="w-4 h-4" />
                </div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  03. Live Grading & Key Recalculation
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Award full or partial credit on short answers, add per-question feedback, or fix a question&apos;s answer key to recalculate every submission and push updates instantly.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50 py-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            <span>AnonQuiz · Anonymous Assessment & Live Grading</span>
          </div>
          <span>Privacy-first sessions with real-time score synchronization</span>
        </div>
      </footer>

      {scannerOpen && (
        <QrScannerModal
          onClose={() => setScannerOpen(false)}
          onValidatedQuiz={(targetPath) => {
            setScannerOpen(false);
            onNavigate(targetPath);
          }}
        />
      )}
    </div>
  );
}
