import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  X,
  Camera,
  Upload,
  ShieldCheck,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { parseAndValidateHostQrPayload } from '../../utils/qrUtils.ts';
import { verifyHostQrCode } from '../../services/index.ts';
import { getStoredAnonSession } from '../../utils/anonSession.ts';
import { useToast } from '../../context/ToastContext.tsx';

interface QrScannerModalProps {
  onClose: () => void;
  onValidatedQuiz: (targetPath: string) => void;
}

type CameraStatus = 'starting' | 'active' | 'unavailable';

export function QrScannerModal({ onClose, onValidatedQuiz }: QrScannerModalProps) {
  const { showToast } = useToast();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const lastRejectedRawRef = useRef<{ value: string; at: number } | null>(null);
  const processingRef = useRef<boolean>(false);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('starting');
  const [cameraMessage, setCameraMessage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleDecodedPayload = useCallback(
    async (rawText: string, source: 'camera' | 'upload') => {
      if (processingRef.current) return;

      // Prevent spamming identical rejected QR frames from live camera
      if (
        source === 'camera' &&
        lastRejectedRawRef.current &&
        lastRejectedRawRef.current.value === rawText &&
        Date.now() - lastRejectedRawRef.current.at < 2000
      ) {
        return;
      }

      const parsed = parseAndValidateHostQrPayload(rawText);
      if (!parsed.valid) {
        lastRejectedRawRef.current = { value: rawText, at: Date.now() };
        setScanError(parsed.reason);
        return;
      }

      processingRef.current = true;
      setVerifying(true);
      setScanError(null);

      try {
        const storedSession = getStoredAnonSession(parsed.quizId);
        const verification = await verifyHostQrCode(
          parsed.quizId,
          parsed.qrToken,
          storedSession?.sessionToken
        );

        if (verification.status === 'valid') {
          stopCamera();
          showToast(`Verified host quiz: ${verification.title}`, 'success');
          onValidatedQuiz(
            `/quiz/${encodeURIComponent(verification.quizId)}?qr=${encodeURIComponent(verification.qrToken)}&app=anonquiz`
          );
          return;
        }

        if (verification.status === 'already_submitted') {
          stopCamera();
          showToast(`Opening your saved marks for ${verification.title}`, 'info');
          onValidatedQuiz(`/quiz/${encodeURIComponent(verification.quizId)}`);
          return;
        }

        lastRejectedRawRef.current = { value: rawText, at: Date.now() };
        setScanError(verification.message);
      } catch (err) {
        lastRejectedRawRef.current = { value: rawText, at: Date.now() };
        setScanError(
          err instanceof Error
            ? err.message
            : 'Unable to verify this host QR code right now. Please try again.'
        );
      } finally {
        setVerifying(false);
        processingRef.current = false;
      }
    },
    [onValidatedQuiz, showToast, stopCamera]
  );

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraStatus('starting');
    setCameraMessage(null);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraStatus('unavailable');
      setCameraMessage(
        'Camera access is unavailable in this browser. Upload a QR code image below instead.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }

      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      setCameraStatus('active');

      const scanFrame = (timestamp: number) => {
        if (!streamRef.current || !videoRef.current || !canvasRef.current) return;

        if (!processingRef.current && timestamp - lastScanTimeRef.current >= 180) {
          lastScanTimeRef.current = timestamp;
          const v = videoRef.current;
          if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0 && v.videoHeight > 0) {
            const canvas = canvasRef.current;
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
              });
              if (code && code.data) {
                void handleDecodedPayload(code.data, 'camera');
              }
            }
          }
        }

        rafRef.current = window.requestAnimationFrame(scanFrame);
      };

      rafRef.current = window.requestAnimationFrame(scanFrame);
    } catch {
      setCameraStatus('unavailable');
      setCameraMessage(
        'Camera permission was denied or no camera was detected. You can upload a photo or screenshot of the host QR code below.'
      );
    }
  }, [handleDecodedPayload, stopCamera]);

  useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, stopCamera]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so selecting the same file again still triggers onChange
    e.target.value = '';
    if (!file) return;

    setScanError(null);

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Unable to read image file.'));
        reader.readAsDataURL(file);
      });

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Selected file is not a valid image.'));
        image.src = dataUrl;
      });

      const canvas = document.createElement('canvas');
      const maxDim = 1200;
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        setScanError('Unable to decode image in this browser.');
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      if (!decoded || !decoded.data) {
        setScanError(
          'No QR code was detected in that image. Make sure the host QR code is sharp and fully visible.'
        );
        return;
      }

      await handleDecodedPayload(decoded.data, 'upload');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to scan the selected image.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="presentation"
      onClick={() => {
        stopCamera();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-scanner-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-xl shadow-xl max-w-md w-full overflow-hidden"
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <h2 id="qr-scanner-title" className="font-display text-lg font-bold text-slate-900">
              Scan Host Quiz QR
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Responds only to official AnonQuiz host QR codes</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close QR scanner"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Camera Viewport */}
          <div className="relative aspect-[4/3] w-full rounded-xl bg-slate-950 overflow-hidden border border-slate-200 flex items-center justify-center">
            <video
              ref={videoRef}
              muted
              playsInline
              className={`w-full h-full object-cover ${cameraStatus === 'active' ? 'block' : 'hidden'}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {cameraStatus === 'active' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 rounded-xl border-2 border-indigo-400/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
              </div>
            )}

            {cameraStatus === 'starting' && (
              <div className="flex flex-col items-center gap-2 text-slate-300 text-xs px-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                <span>Starting camera...</span>
              </div>
            )}

            {cameraStatus === 'unavailable' && (
              <div className="flex flex-col items-center gap-3 text-slate-300 text-xs px-6 text-center">
                <Camera className="w-7 h-7 text-slate-400" />
                <p className="leading-relaxed max-w-xs">
                  {cameraMessage || 'Camera unavailable. Upload a host QR image below.'}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="h-8 px-3 rounded-md bg-white/10 hover:bg-white/20 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry Camera
                </button>
              </div>
            )}

            {verifying && (
              <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center gap-2 text-white text-xs font-medium">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
                <span>Verifying official host QR...</span>
              </div>
            )}
          </div>

          {/* Strict Validation Error Banner */}
          {scanError && (
            <div
              role="alert"
              data-testid="qr-scanner-error"
              className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-rose-900">QR Code Rejected</p>
                <p className="mt-0.5 text-rose-800">{scanError}</p>
              </div>
            </div>
          )}

          {/* Upload QR Image Fallback */}
          <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              No camera or scanning from a screenshot?
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              data-testid="qr-image-upload-input"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={verifying}
              className="h-9 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <Upload className="w-3.5 h-3.5 text-indigo-600" />
              Upload QR Image
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
