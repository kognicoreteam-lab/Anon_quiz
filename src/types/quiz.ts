export type QuestionType = 'mcq' | 'short_answer' | 'paragraph';

export type QuizStatus = 'draft' | 'active' | 'expired';

export type ReviewStatus = 'auto_graded' | 'pending' | 'reviewed';

export type GradingOutcome = 'correct' | 'incorrect' | 'partial' | 'pending';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  text: string;
  options: string[];
  /** For MCQ: array of option indices (supports single or multi-select). For short_answer/paragraph: optional reference answer or rubric string. */
  correctAnswer: number[] | string;
  points: number;
}

export interface Quiz {
  id: string;
  hostUid: string;
  hostEmail?: string;
  title: string;
  description: string;
  joinCode: string;
  qrToken?: string;
  status: QuizStatus;
  createdAt: number;
  updatedAt?: number;
  expiresAt: number | null;
  questions: QuizQuestion[];
}

export interface QuizSummary extends Quiz {
  submissionCount: number;
  pendingReviewCount: number;
  averageScorePercent: number | null;
}

export interface QuestionGrading {
  outcome: GradingOutcome;
  isCorrect: boolean;
  pointsAwarded: number;
  feedback: string;
  manuallyGraded?: boolean;
}

export type UserAnswerValue = number[] | string;

export interface QuizSubmission {
  id: string;
  quizId: string;
  hostUid: string;
  sessionToken: string;
  anonId: string;
  alias?: string;
  submittedAt: number;
  updatedAt?: number;
  answers: Record<string, UserAnswerValue>;
  grading: Record<string, QuestionGrading>;
  totalScore: number;
  maxScore: number;
  reviewStatus: ReviewStatus;
  autoSubmitted?: boolean;
}

export interface HostUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}

export interface PublicQuizView {
  id: string;
  hostUid: string;
  title: string;
  description: string;
  joinCode: string;
  qrToken?: string;
  status: QuizStatus;
  expiresAt: number | null;
  serverNow: number;
  questions: Array<{
    id: string;
    type: QuestionType;
    text: string;
    options: string[];
    multiSelect: boolean;
    points: number;
  }>;
}

export interface SubmissionResultPayload {
  quiz: {
    id: string;
    title: string;
    description: string;
    joinCode: string;
    status: QuizStatus;
    expiresAt: number | null;
    questions: QuizQuestion[];
  };
  submission: QuizSubmission;
}
