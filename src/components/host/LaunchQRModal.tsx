import React, { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  X,
  Copy,
  Clock,
  Play,
  StopCircle,
  PlusCircle,
  ExternalLink,
  Loader2,
  RotateCcw,
  RefreshCw,
  Download,
} from 'lucide-react';
import type { QuizSummary } from '../../types/quiz.ts';
import { useLiveClock } from '../../hooks/useLiveClock.ts';
import { buildHostQuizQrValue } from '../../utils/qrUtils.ts';
import {
  computeEffectiveQuizStatus,
  formatCountdown,
  getRemainingMs,
} from '../../utils/timeUtils.ts';
import {
  endQuizEarly,
  extendQuizTime,
  launchQuiz,
  regenerateQuizQr,
} from '../../services/index.ts';
import { useToast } from '../../context/ToastContext.tsx';

interface LaunchQRModalProps {
  quiz: QuizSummary;
  onClose: () => void;
  onOpenParticipantLink: (targetPath: string) => void;
}

const PRESET_DURATIONS = [
  { label: '5 mins', value: 5 },
  { label: '15 mins', value: 15 },
  { label: '30 mins', value: 30 },
  { label: '1 hour', value: 60 },
];

export function LaunchQRModal({
  quiz,
  onClose,
  onOpenParticipantLink,
}: LaunchQRModalProps) {
  const { showToast } = useToast();
  const qrContainerRef = useRef<HTMLDivElement | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(15);
  const [customMinutes, setCustomMinutes] = useState<string>('');
  const [busyAction, setBusyAction] = useState<'launch' | 'extend' | 'end' | 'qr' | null>(null);
  const nowMs = useLiveClock();
  const [error, setError] = useState<string | null>(null);

  const effectiveStatus = computeEffectiveQuizStatus(quiz, nowMs);
  const remainingMs = getRemainingMs(quiz.expiresAt, nowMs);

  const activeQrToken = quiz.qrToken || '';
  const qrShareUrl = activeQrToken
    ? buildHostQuizQrValue(window.location.origin, quiz.id, activeQrToken)
    : `${window.location.origin}/quiz/${encodeURIComponent(quiz.id)}`;
  const participantPath = activeQrToken
    ? `/quiz/${encodeURIComponent(quiz.id)}?qr=${encodeURIComponent(activeQrToken)}&app=anonquiz`
    : `/quiz/${encodeURIComponent(quiz.id)}`;


  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleLaunch = async () => {
    const minutes = customMinutes.trim() ? Number(customMinutes) : selectedDuration;
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      setError('Enter a valid duration between 1 and 1440 minutes.');
      return;
    }
    setError(null);
    setBusyAction('launch');
    try {
      await launchQuiz(quiz.id, minutes);
      showToast(`Quiz launched for ${minutes} min with a fresh QR code`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch quiz.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRegenerateQr = async () => {
    setError(null);
    setBusyAction('qr');
    try {
      await regenerateQuizQr(quiz.id);
      showToast('Fresh QR generated — previous QR codes are now invalid.', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a new QR code.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadQrPng = () => {
    const svgEl = qrContainerRef.current?.querySelector('svg');
    if (!svgEl) return;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgEl);
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const size = 512;
      const padding = 36;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, padding, padding, size - padding * 2, size - padding * 2);
        const pngUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `anonquiz-${quiz.joinCode.toLowerCase()}-qr.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(url);
      showToast('QR code downloaded as PNG', 'success');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('Unable to export QR image.', 'error');
    };
    img.src = url;
  };

  const handleExtend = async () => {
    setError(null);
    setBusyAction('extend');
    try {
      await extendQuizTime(quiz.id, quiz.expiresAt, 5);
      showToast('Extended expiration by +5 minutes', 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extend timer.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEndEarly = async () => {
    setError(null);
    setBusyAction('end');
    try {
      await endQuizEarly(quiz.id);
      showToast('Quiz ended. New submissions are now blocked.', 'info');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end quiz.');
    } finally {
      setBusyAction(null);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied!`, 'success');
    } catch {
      showToast(`Copy manually: ${text}`, 'info');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="launch-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-xl w-full max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-200">
          <div className="min-w-0">
            <h2 id="launch-modal-title" className="font-display text-lg font-bold text-slate-900 truncate">
              {effectiveStatus === 'active' ? 'Live Quiz Session' : 'Launch Quiz & QR Code'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{quiz.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close launch modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <p role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800">
              {error}
            </p>
          )}

          {effectiveStatus === 'active' ? (
            <>
              {/* Countdown & Status Strip */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
                <div>
                  <p className="text-xs font-medium text-emerald-700">Active · Accepting anonymous responses</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Link and QR code automatically expire when timer reaches 00:00.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-slate-900">
                  <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span
                    data-testid="host-countdown"
                    className="font-mono text-2xl font-bold tabular-nums tracking-tight"
                  >
                    {formatCountdown(remainingMs)}
                  </span>
                </div>
              </div>

              {/* QR Code + Join Code */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-6 items-start">
                <div className="sm:col-span-5 flex flex-col items-center justify-center p-4 bg-white border border-slate-200 rounded-xl space-y-3">
                  <div ref={qrContainerRef} className="bg-white p-1 rounded">
                    <QRCodeSVG
                      value={qrShareUrl}
                      size={168}
                      level="M"
                      includeMargin={false}
                      fgColor="#0f172a"
                      bgColor="#ffffff"
                    />
                  </div>
                  <div className="text-center space-y-0.5">
                    <span className="block text-xs font-medium text-slate-700">
                      Scan with AnonQuiz Scanner
                    </span>
                    {activeQrToken && (
                      <span className="block font-mono text-[11px] text-slate-400">
                        QR ID: {activeQrToken.slice(-8)}
                      </span>
                    )}
                  </div>
                  <div className="w-full flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleRegenerateQr}
                      disabled={busyAction !== null}
                      className="w-full h-8 px-2.5 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                    >
                      {busyAction === 'qr' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      Generate New QR
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadQrPng}
                      className="w-full h-8 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download QR PNG
                    </button>
                  </div>
                </div>

                <div className="sm:col-span-7 space-y-4">
                  <div>
                    <span className="block text-xs font-medium text-slate-500 mb-1">
                      6-Character Join Code
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        data-testid="modal-join-code"
                        className="font-mono text-2xl font-bold tracking-[0.2em] text-slate-900"
                      >
                        {quiz.joinCode}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyText(quiz.joinCode, 'Join code')}
                        className="h-8 px-2.5 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="shareable-url-input" className="block text-xs font-medium text-slate-500 mb-1">
                      Direct Host QR Link
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="shareable-url-input"
                        type="text"
                        readOnly
                        value={qrShareUrl}
                        className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-slate-200 bg-slate-50 font-mono text-xs text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => void copyText(qrShareUrl, 'QR link')}
                        className="h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Link
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500 leading-relaxed">
                      Each launch or &ldquo;Generate New QR&rdquo; issues a fresh QR token so older screenshots cannot be reused.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenParticipantLink(participantPath)}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1.5"
                  >
                    Open participant quiz link
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Host Timer Controls */}
              <div className="pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleExtend}
                  disabled={busyAction !== null}
                  className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  {busyAction === 'extend' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <PlusCircle className="w-4 h-4 text-indigo-600" />
                  )}
                  Extend Time (+5 min)
                </button>

                <button
                  type="button"
                  onClick={handleEndEarly}
                  disabled={busyAction !== null}
                  className="h-10 px-4 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  {busyAction === 'end' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <StopCircle className="w-4 h-4 text-rose-600" />
                  )}
                  End Quiz Early
                </button>
              </div>
            </>
          ) : (
            <>
              {effectiveStatus === 'expired' && (
                <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                  This quiz session has expired and is currently closed to new participants. Set a new duration below to reopen it.
                </div>
              )}

              <div>
                <span className="block text-sm font-medium text-slate-800 mb-3">
                  Select Expiration Duration
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {PRESET_DURATIONS.map((preset) => {
                    const isSelected = !customMinutes.trim() && selectedDuration === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => {
                          setSelectedDuration(preset.value);
                          setCustomMinutes('');
                        }}
                        className={`h-11 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="custom-minutes-input" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Or Custom Duration (minutes)
                </label>
                <input
                  id="custom-minutes-input"
                  type="number"
                  min={1}
                  max={1440}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  placeholder="e.g. 45"
                  className="w-40 h-10 px-3 rounded-lg border border-slate-300 text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={busyAction !== null}
                  className="h-10 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                >
                  {busyAction === 'launch' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : effectiveStatus === 'expired' ? (
                    <RotateCcw className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  {effectiveStatus === 'expired' ? 'Reopen Quiz' : 'Launch Now'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
