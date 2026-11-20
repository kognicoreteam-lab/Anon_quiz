const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateJoinCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * JOIN_CODE_ALPHABET.length);
    code += JOIN_CODE_ALPHABET[idx];
  }
  return code;
}

export function generateAnonId(): string {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `Anon-${num}`;
}

export function generateId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  const timePart = Date.now().toString(36);
  return `${prefix}_${timePart}_${randomPart}`;
}

export function generateQrToken(): string {
  const timePart = Date.now().toString(36);
  const randA = Math.random().toString(36).slice(2, 8);
  const randB = Math.random().toString(36).slice(2, 8);
  return `qr_${timePart}_${randA}${randB}`.slice(0, 48);
}

export function normalizeJoinCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function buildHostQuizQrValue(origin: string, quizId: string, qrToken: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '');
  return `${cleanOrigin}/quiz/${encodeURIComponent(quizId)}?qr=${encodeURIComponent(qrToken)}&app=anonquiz`;
}

export type HostQrParseResult =
  | { valid: true; quizId: string; qrToken: string }
  | { valid: false; reason: string };

export function parseAndValidateHostQrPayload(rawQrText: string): HostQrParseResult {
  const trimmed = (rawQrText || '').trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: 'No QR payload detected. Point the camera at the host quiz QR code.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      reason: 'This is not a valid AnonQuiz host QR code. Only the host’s official quiz QR will open.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: 'This is not a valid AnonQuiz host QR code. Only the host’s official quiz QR will open.',
    };
  }

  if (parsed.searchParams.get('app') !== 'anonquiz') {
    return {
      valid: false,
      reason: 'Unrecognized QR code. This scanner only opens official AnonQuiz host quiz QR codes.',
    };
  }

  const pathMatch = parsed.pathname.match(/^\/quiz\/([a-zA-Z0-9_-]{1,128})\/?$/);
  if (!pathMatch) {
    return {
      valid: false,
      reason: 'Invalid AnonQuiz link format in QR code. Ask the host to generate a fresh QR.',
    };
  }

  const qrToken = parsed.searchParams.get('qr') || '';
  if (!/^[a-zA-Z0-9_-]{12,64}$/.test(qrToken)) {
    return {
      valid: false,
      reason: 'Missing or invalid host QR token. Ask the host to generate a fresh QR code.',
    };
  }

  return {
    valid: true,
    quizId: decodeURIComponent(pathMatch[1]),
    qrToken,
  };
}
