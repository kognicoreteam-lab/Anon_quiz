import React from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import type { QuizQuestion } from '../../types/quiz.ts';
import { formatQuestionTypeLabel } from '../../utils/gradingUtils.ts';

interface AnswerKeyEditorProps {
  questions: QuizQuestion[];
  submissionCount: number;
  recalculating: boolean;
  onQuestionsChange: React.Dispatch<React.SetStateAction<QuizQuestion[]>>;
  onRecalculateAll: () => void;
}

export function AnswerKeyEditor({
  questions,
  submissionCount,
  recalculating,
  onQuestionsChange,
  onRecalculateAll,
}: AnswerKeyEditorProps) {
  const toggleKeyOption = (qIndex: number, optIndex: number) => {
    onQuestionsChange((prev) =>
      prev.map((q, idx) => {
        if (idx !== qIndex || q.type !== 'mcq') return q;
        const current = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
        const exists = current.includes(optIndex);
        const next = exists
          ? current.filter((v) => v !== optIndex)
          : [...current, optIndex].sort((a, b) => a - b);
        return { ...q, correctAnswer: next };
      })
    );
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            Answer Key Correction
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Fix any MCQ answer key or point value below and recalculate all {submissionCount}{' '}
            anonymous submission(s) automatically. Manual short-answer grades are preserved.
          </p>
        </div>
        <button
          type="button"
          onClick={onRecalculateAll}
          disabled={recalculating}
          className="h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          {recalculating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Recalculate All Scores
        </button>
      </div>

      <div className="divide-y divide-slate-200">
        {questions.map((q, qIdx) => {
          const selected = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
          return (
            <div key={q.id} className="p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    Question {qIdx + 1} · {formatQuestionTypeLabel(q.type)}
                  </p>
                  <h3 className="text-sm font-semibold text-slate-900 mt-0.5">{q.text}</h3>
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor={`key-pts-${q.id}`} className="text-xs font-medium text-slate-600">
                    Marks
                  </label>
                  <input
                    id={`key-pts-${q.id}`}
                    type="number"
                    min={1}
                    max={100}
                    step={0.5}
                    value={q.points}
                    onChange={(e) => {
                      const nextPts = Math.max(1, Number(e.target.value));
                      onQuestionsChange((prev) =>
                        prev.map((item, i) => (i === qIdx ? { ...item, points: nextPts } : item))
                      );
                    }}
                    className="w-20 h-8 px-2.5 rounded-md border border-slate-300 font-mono text-xs tabular-nums text-slate-900"
                  />
                </div>
              </div>

              {q.type === 'mcq' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {q.options.map((opt, optIdx) => {
                    const isChecked = selected.includes(optIdx);
                    const letter = String.fromCharCode(65 + optIdx);
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => toggleKeyOption(qIdx, optIdx)}
                        aria-pressed={isChecked}
                        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left text-sm transition-colors ${
                          isChecked
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-950 font-medium'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`w-6 h-6 rounded flex items-center justify-center text-xs font-mono shrink-0 ${
                            isChecked
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {isChecked ? <Check className="w-3.5 h-3.5" /> : letter}
                        </span>
                        <span className="flex-1">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div>
                  <label
                    htmlFor={`key-ref-${q.id}`}
                    className="block text-xs font-medium text-slate-600 mb-1"
                  >
                    {q.type === 'paragraph'
                      ? 'Grading Rubric / Model Paragraph'
                      : 'Reference Answer'}
                  </label>
                  <textarea
                    id={`key-ref-${q.id}`}
                    rows={q.type === 'paragraph' ? 3 : 2}
                    value={typeof q.correctAnswer === 'string' ? q.correctAnswer : ''}
                    onChange={(e) =>
                      onQuestionsChange((prev) =>
                        prev.map((item, i) =>
                          i === qIdx ? { ...item, correctAnswer: e.target.value } : item
                        )
                      )
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 resize-y"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
