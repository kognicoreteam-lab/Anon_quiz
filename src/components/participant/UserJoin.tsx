import React, { useEffect, useState } from 'react';
import { Clock, ArrowLeft, AlertCircle, Loader2, QrCode } from 'lucide-react';
import type { PublicQuizView, SubmissionResultPayload } from '../../types/quiz.ts';
import { fetchPublicQuiz, fetchSubmissionBySession } from '../../services/index.ts';
import { getOrCreateAnonSession, updateAnonSession } from '../../utils/anonSession.ts';
import { computeEffectiveQuizStatus } from '../../utils/timeUtils.ts';
import { QuizTaker } from './QuizTaker.tsx';
import { UserScoreView } from './UserScoreView.tsx';

interface UserJoinProps {
  quizId: string;
  qrParam?: string | null;
  onNavigate: (path: string) => void;
}

export function UserJoin({ quizId, qrParam, onNavigate }: UserJoinProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrSuperseded, setQrSuperseded] = useState(false);
  const [quiz, setQuiz] = useState<PublicQuizView | null>(null);
  const [result, setResult] = useState<SubmissionResultPayload | null>(null);
  const [session, setSession] = useState(() => getOrCreateAnonSession(quizId));

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setQrSuperseded(false);

    const localSession = getOrCreateAnonSession(quizId);
    setSession(localSession);

    async function load() {
      try {
        // Check if this browser session already submitted this quiz (always allow viewing marks)
        const existingCheck = await fetchSubmissionBySession(quizId, localSession.sessionToken);
        if (!active) return;

        if (existingCheck.found && existingCheck.result) {
          updateAnonSession(quizId, {
            submissionId: existingCheck.result.submission.id,
            quizTitle: existingCheck.result.quiz.title,
            joinCode: existingCheck.result.quiz.joinCode,
          });
          setResult(existingCheck.result);
          setLoading(false);
          return;
        }

        // Otherwise load public quiz metadata and verify QR token + expiration
        const publicQuiz = await fetchPublicQuiz(quizId);
        if (!active) return;
        if (!publicQuiz) {
          setError('We could not find a quiz matching this link.');
          setLoading(false);
          return;
        }

        if (qrParam && publicQuiz.qrToken && qrParam !== publicQuiz.qrToken) {
          setQrSuperseded(true);
          setQuiz(publicQuiz);
          setLoading(false);
          return;
        }

        updateAnonSession(quizId, {
          quizTitle: publicQuiz.title,
          joinCode: publicQuiz.joinCode,
        });
        setQuiz(publicQuiz);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Unable to load this quiz.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [quizId, qrParam]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm font-medium text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          <span>Opening anonymous quiz session...</span>
        </div>
      </div>
    );
  }

  if (result) {
    return <UserScoreView initialResult={result} onNavigateHome={() => onNavigate('/')} />;
  }

  if (qrSuperseded && quiz) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <QrCode className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-xl font-bold text-slate-900">
              This QR code has been replaced
            </h1>
            <p className="text-sm font-medium text-slate-700">{quiz.title}</p>
            <p className="text-sm text-slate-600 leading-relaxed">
              The host generated a newer QR code for this quiz. Scan the latest QR code on the host&apos;s screen or enter the 6-character code on the home page.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="h-10 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Scan Latest QR
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error || !quiz) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
          <div className="w-11 h-11 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900">Quiz Unavailable</h1>
          <p className="text-sm text-slate-600">{error || 'We could not find this quiz link.'}</p>
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const effectiveStatus = computeEffectiveQuizStatus(quiz, quiz.serverNow);

  if (effectiveStatus === 'expired' || effectiveStatus === 'draft') {
    const isExpired = effectiveStatus === 'expired';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-md w-full text-center space-y-4">
          <div
            className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${
              isExpired ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
            }`}
          >
            <Clock className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="font-display text-xl font-bold text-slate-900">
              {isExpired ? 'This quiz link has expired' : 'This quiz has not started yet'}
            </h1>
            <p className="text-sm font-medium text-slate-700">{quiz.title}</p>
            <p className="text-sm text-slate-600 leading-relaxed">
              {isExpired
                ? 'The timer for this anonymous quiz session has ended and new submissions are now closed.'
                : 'Your host has not launched this quiz session yet. Check back once the QR code is live.'}
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onNavigate('/')}
              className="h-10 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Enter Another Code
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <QuizTaker
      quiz={quiz}
      sessionToken={session.sessionToken}
      anonId={session.anonId}
      initialAlias={session.alias}
      onSubmitted={(submittedResult) => setResult(submittedResult)}
    />
  );
}
