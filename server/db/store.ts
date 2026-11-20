import fs from 'node:fs';
import path from 'node:path';
import type { Quiz, QuizSubmission } from '../../src/types/quiz.ts';
import { computeEffectiveQuizStatus } from '../../src/utils/timeUtils.ts';

export interface StoredHostAccount {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
}

interface DatabaseSchema {
  hosts: Record<string, StoredHostAccount>;
  quizzes: Record<string, Quiz>;
  submissions: Record<string, Record<string, QuizSubmission>>;
}

function createEmptyDb(): DatabaseSchema {
  return {
    hosts: {},
    quizzes: {},
    submissions: {},
  };
}

function resolveDataFilePath(): string {
  if (process.env.DATA_FILE) {
    return path.resolve(process.env.DATA_FILE);
  }
  const preferredDir = path.resolve(process.cwd(), 'data');
  try {
    fs.mkdirSync(preferredDir, { recursive: true });
    fs.accessSync(preferredDir, fs.constants.W_OK);
    return path.join(preferredDir, 'anonquiz-db.json');
  } catch {
    const fallbackDir = path.join('/tmp', 'anonquiz-data');
    fs.mkdirSync(fallbackDir, { recursive: true });
    return path.join(fallbackDir, 'anonquiz-db.json');
  }
}

export class DataStore {
  private filePath: string;
  private data: DatabaseSchema;

  constructor(customFilePath?: string) {
    this.filePath = customFilePath ? path.resolve(customFilePath) : resolveDataFilePath();
    this.data = this.loadFromDisk();
  }

  private loadFromDisk(): DatabaseSchema {
    try {
      if (!fs.existsSync(this.filePath)) {
        return createEmptyDb();
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<DatabaseSchema>;
      return {
        hosts: parsed.hosts && typeof parsed.hosts === 'object' ? parsed.hosts : {},
        quizzes: parsed.quizzes && typeof parsed.quizzes === 'object' ? parsed.quizzes : {},
        submissions:
          parsed.submissions && typeof parsed.submissions === 'object' ? parsed.submissions : {},
      };
    } catch {
      return createEmptyDb();
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }

  // --- Host Accounts ---

  getHostByEmail(email: string): StoredHostAccount | null {
    const normalized = email.trim().toLowerCase();
    return this.data.hosts[normalized] ?? null;
  }

  getHostByUid(uid: string): StoredHostAccount | null {
    for (const host of Object.values(this.data.hosts)) {
      if (host.uid === uid) return host;
    }
    return null;
  }

  saveHost(account: StoredHostAccount): StoredHostAccount {
    const key = account.email.trim().toLowerCase();
    this.data.hosts[key] = { ...account, email: key };
    this.persist();
    return this.data.hosts[key];
  }

  // --- Quizzes ---

  private hydrateQuiz(quiz: Quiz): Quiz {
    return {
      ...quiz,
      status: computeEffectiveQuizStatus(quiz, Date.now()),
    };
  }

  listQuizzesByHost(hostUid: string): Quiz[] {
    return Object.values(this.data.quizzes)
      .filter((q) => q.hostUid === hostUid)
      .map((q) => this.hydrateQuiz(q))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getQuizById(quizId: string): Quiz | null {
    const found = this.data.quizzes[quizId];
    return found ? this.hydrateQuiz(found) : null;
  }

  getQuizByJoinCode(joinCode: string): Quiz | null {
    const normalized = joinCode.trim().toUpperCase();
    for (const q of Object.values(this.data.quizzes)) {
      if (q.joinCode.toUpperCase() === normalized) {
        return this.hydrateQuiz(q);
      }
    }
    return null;
  }

  isJoinCodeTaken(joinCode: string): boolean {
    return this.getQuizByJoinCode(joinCode) !== null;
  }

  saveQuiz(quiz: Quiz): Quiz {
    this.data.quizzes[quiz.id] = { ...quiz };
    if (!this.data.submissions[quiz.id]) {
      this.data.submissions[quiz.id] = {};
    }
    this.persist();
    return this.hydrateQuiz(this.data.quizzes[quiz.id]);
  }

  deleteQuiz(quizId: string): boolean {
    if (!this.data.quizzes[quizId]) return false;
    delete this.data.quizzes[quizId];
    delete this.data.submissions[quizId];
    this.persist();
    return true;
  }

  // --- Submissions ---

  listSubmissionsByQuiz(quizId: string): QuizSubmission[] {
    const bucket = this.data.submissions[quizId] || {};
    return Object.values(bucket).sort((a, b) => b.submittedAt - a.submittedAt);
  }

  getSubmission(quizId: string, submissionId: string): QuizSubmission | null {
    return this.data.submissions[quizId]?.[submissionId] ?? null;
  }

  saveSubmission(submission: QuizSubmission): QuizSubmission {
    if (!this.data.submissions[submission.quizId]) {
      this.data.submissions[submission.quizId] = {};
    }
    this.data.submissions[submission.quizId][submission.id] = { ...submission };
    this.persist();
    return this.data.submissions[submission.quizId][submission.id];
  }

  saveManySubmissions(quizId: string, submissions: QuizSubmission[]): void {
    if (!this.data.submissions[quizId]) {
      this.data.submissions[quizId] = {};
    }
    for (const sub of submissions) {
      this.data.submissions[quizId][sub.id] = { ...sub };
    }
    this.persist();
  }
}

export const store = new DataStore();
