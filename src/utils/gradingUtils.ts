import type {
  GradingOutcome,
  QuestionGrading,
  QuestionType,
  QuizQuestion,
  QuizSubmission,
  ReviewStatus,
  SessionMode,
  UserAnswerValue,
} from '../types/quiz.ts';

export function isChoiceQuestionType(type: QuestionType): boolean {
  return type === 'mcq' || type === 'multi_select';
}

export function countWords(text: string): number {
  const trimmed = (text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function formatQuestionTypeLabel(type: QuestionType): string {
  if (type === 'mcq') return 'Single Choice';
  if (type === 'multi_select') return 'Multiple Select';
  if (type === 'paragraph') return 'Paragraph';
  return 'Short Answer';
}

export function calculateMaxScore(questions: QuizQuestion[]): number {
  return questions.reduce((sum, q) => sum + Math.max(0, Number(q.points) || 0), 0);
}

function normalizeMcqAnswer(value: UserAnswerValue | number[] | string | undefined): number[] {
  if (!Array.isArray(value)) return [];
  const unique = Array.from(
    new Set(value.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 0))
  );
  unique.sort((a, b) => a - b);
  return unique;
}

export function isMcqAnswerExactMatch(
  userAnswer: UserAnswerValue | undefined,
  correctAnswer: number[] | string
): boolean {
  const expected = normalizeMcqAnswer(correctAnswer);
  if (expected.length === 0) return false;
  const actual = normalizeMcqAnswer(userAnswer);
  if (actual.length !== expected.length) return false;
  return actual.every((val, idx) => val === expected[idx]);
}

export function deriveOutcome(pointsAwarded: number, maxPoints: number): GradingOutcome {
  if (maxPoints <= 0) return 'correct';
  if (pointsAwarded >= maxPoints) return 'correct';
  if (pointsAwarded > 0) return 'partial';
  return 'incorrect';
}

export function roundScore(val: number): number {
  return Math.round(val * 100) / 100;
}

export function clampPoints(value: number, maxPoints: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundScore(Math.min(Math.max(0, value), Math.max(0, maxPoints)));
}

export function calculateScorePercent(totalScore: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.round((totalScore / maxScore) * 100);
}

export function autoGradeSubmission(
  questions: QuizQuestion[],
  answers: Record<string, UserAnswerValue>,
  mode: SessionMode = 'quiz'
): {
  grading: Record<string, QuestionGrading>;
  totalScore: number;
  maxScore: number;
  reviewStatus: ReviewStatus;
} {
  if (mode === 'poll') {
    return {
      grading: {},
      totalScore: 0,
      maxScore: 0,
      reviewStatus: 'auto_graded',
    };
  }

  const grading: Record<string, QuestionGrading> = {};
  let totalScore = 0;
  let hasManualQuestion = false;

  for (const q of questions) {
    const points = Math.max(0, Number(q.points) || 0);
    if (isChoiceQuestionType(q.type)) {
      const exact = isMcqAnswerExactMatch(answers[q.id], q.correctAnswer);
      const awarded = exact ? points : 0;
      totalScore += awarded;
      grading[q.id] = {
        outcome: exact ? 'correct' : 'incorrect',
        isCorrect: exact,
        pointsAwarded: awarded,
        feedback: '',
        manuallyGraded: false,
      };
    } else {
      hasManualQuestion = true;
      grading[q.id] = {
        outcome: 'pending',
        isCorrect: false,
        pointsAwarded: 0,
        feedback: '',
        manuallyGraded: false,
      };
    }
  }

  const maxScore = calculateMaxScore(questions);
  const reviewStatus: ReviewStatus = hasManualQuestion ? 'pending' : 'auto_graded';

  return {
    grading,
    totalScore: roundScore(totalScore),
    maxScore: roundScore(maxScore),
    reviewStatus,
  };
}

export function recalculateSubmissionAfterKeyChange(
  questions: QuizQuestion[],
  submission: QuizSubmission
): {
  grading: Record<string, QuestionGrading>;
  totalScore: number;
  maxScore: number;
  reviewStatus: ReviewStatus;
} {
  const nextGrading: Record<string, QuestionGrading> = {};
  let totalScore = 0;
  let hasPending = false;
  let hasManuallyGraded = false;

  for (const q of questions) {
    const points = Math.max(0, Number(q.points) || 0);
    const prev = submission.grading[q.id];

    if (isChoiceQuestionType(q.type)) {
      const exact = isMcqAnswerExactMatch(submission.answers[q.id], q.correctAnswer);
      const awarded = exact ? points : 0;
      totalScore += awarded;
      nextGrading[q.id] = {
        outcome: exact ? 'correct' : 'incorrect',
        isCorrect: exact,
        pointsAwarded: awarded,
        feedback: prev?.feedback ?? '',
        manuallyGraded: false,
      };
    } else if (prev && prev.outcome !== 'pending') {
      const clamped = clampPoints(prev.pointsAwarded, points);
      totalScore += clamped;
      hasManuallyGraded = true;
      nextGrading[q.id] = {
        ...prev,
        pointsAwarded: clamped,
        isCorrect: clamped >= points && points > 0,
        outcome: deriveOutcome(clamped, points),
      };
    } else {
      hasPending = true;
      nextGrading[q.id] = {
        outcome: 'pending',
        isCorrect: false,
        pointsAwarded: 0,
        feedback: prev?.feedback ?? '',
        manuallyGraded: false,
      };
    }
  }

  const maxScore = calculateMaxScore(questions);
  let reviewStatus: ReviewStatus;
  if (hasPending) {
    reviewStatus = 'pending';
  } else if (hasManuallyGraded || submission.reviewStatus === 'reviewed') {
    reviewStatus = 'reviewed';
  } else {
    reviewStatus = 'auto_graded';
  }

  return {
    grading: nextGrading,
    totalScore: roundScore(totalScore),
    maxScore: roundScore(maxScore),
    reviewStatus,
  };
}

export function finalizeManualGrading(
  questions: QuizQuestion[],
  gradingInput: Record<string, Partial<QuestionGrading>>
): {
  grading: Record<string, QuestionGrading>;
  totalScore: number;
  maxScore: number;
  reviewStatus: ReviewStatus;
} {
  const grading: Record<string, QuestionGrading> = {};
  let totalScore = 0;

  for (const q of questions) {
    const maxPts = Math.max(0, Number(q.points) || 0);
    const entry = gradingInput[q.id];
    const requestedPoints = Number(entry?.pointsAwarded ?? 0);
    const clampedPoints = clampPoints(requestedPoints, maxPts);
    const outcome =
      entry?.outcome && entry.outcome !== 'pending'
        ? entry.outcome
        : deriveOutcome(clampedPoints, maxPts);

    totalScore += clampedPoints;
    grading[q.id] = {
      outcome,
      isCorrect: outcome === 'correct',
      pointsAwarded: clampedPoints,
      feedback: typeof entry?.feedback === 'string' ? entry.feedback.trim().slice(0, 500) : '',
      manuallyGraded: true,
    };
  }

  return {
    grading,
    totalScore: roundScore(totalScore),
    maxScore: roundScore(calculateMaxScore(questions)),
    reviewStatus: 'reviewed',
  };
}

export interface MarksBreakdownSummary {
  mcqEarned: number;
  mcqMax: number;
  manualEarned: number;
  manualMax: number;
  hasMcqQuestions: boolean;
  hasManualQuestions: boolean;
  pendingManualCount: number;
  reviewedManualCount: number;
  totalManualCount: number;
}

export function summarizeMarksBreakdown(
  questions: QuizQuestion[],
  grading: Record<string, QuestionGrading>
): MarksBreakdownSummary {
  let mcqEarned = 0;
  let mcqMax = 0;
  let manualEarned = 0;
  let manualMax = 0;
  let hasMcqQuestions = false;
  let hasManualQuestions = false;
  let pendingManualCount = 0;
  let reviewedManualCount = 0;
  let totalManualCount = 0;

  for (const q of questions) {
    const pts = Math.max(0, Number(q.points) || 0);
    const grade = grading[q.id];
    const awarded = grade ? Math.max(0, Number(grade.pointsAwarded) || 0) : 0;

    if (isChoiceQuestionType(q.type)) {
      hasMcqQuestions = true;
      mcqMax += pts;
      mcqEarned += awarded;
    } else {
      hasManualQuestions = true;
      totalManualCount += 1;
      manualMax += pts;
      if (!grade || grade.outcome === 'pending') {
        pendingManualCount += 1;
      } else {
        reviewedManualCount += 1;
        manualEarned += awarded;
      }
    }
  }

  return {
    mcqEarned: roundScore(mcqEarned),
    mcqMax: roundScore(mcqMax),
    manualEarned: roundScore(manualEarned),
    manualMax: roundScore(manualMax),
    hasMcqQuestions,
    hasManualQuestions,
    pendingManualCount,
    reviewedManualCount,
    totalManualCount,
  };
}

export interface QuizValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateQuizDraft(
  input: {
    title: string;
    description?: string;
    questions: QuizQuestion[];
  },
  mode: SessionMode = 'quiz'
): QuizValidationResult {
  const errors: string[] = [];
  const entityLabel = mode === 'poll' ? 'Poll' : 'Quiz';

  if (!input.title || input.title.trim().length < 2) {
    errors.push(`${entityLabel} title must be at least 2 characters.`);
  }

  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    errors.push('Add at least one question before saving.');
  } else {
    input.questions.forEach((q, idx) => {
      const label = `Question ${idx + 1}`;
      if (!q.text || q.text.trim().length === 0) {
        errors.push(`${label}: Question text is required.`);
      }
      if (mode === 'quiz' && (!Number.isFinite(q.points) || q.points <= 0)) {
        errors.push(`${label}: Points must be greater than 0.`);
      }
      if (isChoiceQuestionType(q.type)) {
        const cleanOptions = (q.options || []).map((opt) => opt.trim());
        if (cleanOptions.length < 2 || cleanOptions.some((opt) => opt.length === 0)) {
          errors.push(`${label}: At least 2 non-empty options are required.`);
        }
        if (mode === 'quiz') {
          const correct = normalizeMcqAnswer(q.correctAnswer);
          if (correct.length === 0) {
            errors.push(`${label}: Select at least one correct option.`);
          } else if (correct.some((c) => c >= cleanOptions.length)) {
            errors.push(`${label}: Selected correct option is out of range.`);
          }
        }
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
