export type SessionMode = 'quiz' | 'poll';

export type QuestionType = 'mcq' | 'multi_select' | 'short_answer' | 'paragraph';

export type QuizStatus = 'draft' | 'active' | 'expired';

export type ReviewStatus = 'auto_graded' | 'pending' | 'reviewed';

export type GradingOutcome = 'correct' | 'incorrect' | 'partial' | 'pending';

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  text: string;
  options: string[];
  /** For MCQ / multi_select in quiz mode: array of correct option indices. For short_answer/paragraph: optional reference answer or rubric. Empty in poll mode. */
  correctAnswer: number[] | string;
  points: number;
}

export interface Quiz {
  id: string;
  mode?: SessionMode;
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
  mode: SessionMode;
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
  mode: SessionMode;
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
    mode: SessionMode;
    title: string;
    description: string;
    joinCode: string;
    status: QuizStatus;
    expiresAt: number | null;
    questions: QuizQuestion[];
  };
  submission: QuizSubmission;
}

export interface PollOptionStat {
  optionIndex: number;
  label: string;
  count: number;
  /** Percentage of total respondents who chose this option (can exceed 100% combined on multi_select) */
  respondentPercent: number;
  /** Share of all option selections made for this question (sums to 100%) */
  selectionSharePercent: number;
}

export interface PollTextResponse {
  anonId: string;
  alias?: string;
  text: string;
  submittedAt: number;
}

export interface PollQuestionAggregate {
  questionId: string;
  type: QuestionType;
  text: string;
  totalResponses: number;
  totalSelections: number;
  options: PollOptionStat[];
  topOptionIndices: number[];
  textResponses: PollTextResponse[];
}

export interface PollResultsPayload {
  poll: {
    id: string;
    mode: 'poll';
    title: string;
    description: string;
    joinCode: string;
    status: QuizStatus;
    expiresAt: number | null;
  };
  totalRespondents: number;
  updatedAt: number;
  questions: PollQuestionAggregate[];
}
