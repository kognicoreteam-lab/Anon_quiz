import type {
  PollOptionStat,
  PollQuestionAggregate,
  PollResultsPayload,
  PollTextResponse,
  Quiz,
  QuizSubmission,
} from '../types/quiz.ts';
import { isChoiceQuestionType } from './gradingUtils.ts';
import { computeEffectiveQuizStatus } from './timeUtils.ts';

function roundPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function aggregatePollResults(
  poll: Quiz,
  submissions: QuizSubmission[],
  nowMs = Date.now()
): PollResultsPayload {
  const totalRespondents = submissions.length;

  const questions: PollQuestionAggregate[] = poll.questions.map((q) => {
    if (isChoiceQuestionType(q.type)) {
      const counts = new Array<number>(q.options.length).fill(0);
      let totalResponses = 0;
      let totalSelections = 0;

      for (const sub of submissions) {
        const rawVal = sub.answers[q.id];
        if (!Array.isArray(rawVal)) continue;
        const validUnique = Array.from(
          new Set(
            rawVal
              .map(Number)
              .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < q.options.length)
          )
        );
        if (validUnique.length > 0) {
          totalResponses += 1;
          for (const idx of validUnique) {
            counts[idx] += 1;
            totalSelections += 1;
          }
        }
      }

      const maxCount = counts.reduce((m, c) => (c > m ? c : m), 0);
      const topOptionIndices =
        maxCount > 0
          ? counts
              .map((c, idx) => (c === maxCount ? idx : -1))
              .filter((idx) => idx >= 0)
          : [];

      const options: PollOptionStat[] = q.options.map((label, optionIndex) => ({
        optionIndex,
        label,
        count: counts[optionIndex],
        respondentPercent: roundPercent(counts[optionIndex], totalRespondents),
        selectionSharePercent: roundPercent(counts[optionIndex], totalSelections),
      }));

      return {
        questionId: q.id,
        type: q.type,
        text: q.text,
        totalResponses,
        totalSelections,
        options,
        topOptionIndices,
        textResponses: [],
      };
    }

    const textResponses: PollTextResponse[] = [];
    for (const sub of submissions) {
      const rawVal = sub.answers[q.id];
      if (typeof rawVal === 'string' && rawVal.trim()) {
        textResponses.push({
          anonId: sub.anonId,
          alias: sub.alias,
          text: rawVal.trim(),
          submittedAt: sub.submittedAt,
        });
      }
    }

    return {
      questionId: q.id,
      type: q.type,
      text: q.text,
      totalResponses: textResponses.length,
      totalSelections: textResponses.length,
      options: [],
      topOptionIndices: [],
      textResponses,
    };
  });

  return {
    poll: {
      id: poll.id,
      mode: 'poll',
      title: poll.title,
      description: poll.description,
      joinCode: poll.joinCode,
      status: computeEffectiveQuizStatus(poll, nowMs),
      expiresAt: poll.expiresAt,
    },
    totalRespondents,
    updatedAt: nowMs,
    questions,
  };
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportPollResultsCsv(results: PollResultsPayload): string {
  const rows: string[][] = [
    ['Question #', 'Question', 'Type', 'Option / Response', 'Votes', '% of Respondents', 'Share of Selections (%)'],
  ];

  results.questions.forEach((q, qIdx) => {
    if (isChoiceQuestionType(q.type)) {
      q.options.forEach((opt) => {
        rows.push([
          String(qIdx + 1),
          q.text,
          q.type === 'multi_select' ? 'Multiple Select' : 'Single Choice',
          opt.label,
          String(opt.count),
          `${opt.respondentPercent}%`,
          `${opt.selectionSharePercent}%`,
        ]);
      });
    } else if (q.textResponses.length === 0) {
      rows.push([String(qIdx + 1), q.text, q.type, '(No responses yet)', '0', '0%', '0%']);
    } else {
      q.textResponses.forEach((r) => {
        rows.push([
          String(qIdx + 1),
          q.text,
          q.type === 'paragraph' ? 'Paragraph' : 'Short Answer',
          `${r.anonId}${r.alias ? ` (${r.alias})` : ''}: ${r.text}`,
          '1',
          '',
          '',
        ]);
      });
    }
  });

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}
