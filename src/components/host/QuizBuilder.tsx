import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Plus,
  Trash2,
  Check,
  Save,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { QuestionType, QuizQuestion, QuizSummary } from '../../types/quiz.ts';
import { calculateMaxScore, validateQuizDraft } from '../../utils/gradingUtils.ts';
import { generateId } from '../../utils/qrUtils.ts';

interface QuizBuilderProps {
  initialQuiz?: QuizSummary | null;
  onSave: (payload: {
    title: string;
    description: string;
    questions: QuizQuestion[];
  }) => Promise<void>;
  onCancel: () => void;
}

function createBlankQuestion(type: QuestionType): QuizQuestion {
  if (type === 'mcq') {
    return {
      id: generateId('q'),
      type: 'mcq',
      text: '',
      options: ['', '', '', ''],
      correctAnswer: [0],
      points: 2,
    };
  }
  if (type === 'paragraph') {
    return {
      id: generateId('q'),
      type: 'paragraph',
      text: '',
      options: [],
      correctAnswer: '',
      points: 5,
    };
  }
  return {
    id: generateId('q'),
    type: 'short_answer',
    text: '',
    options: [],
    correctAnswer: '',
    points: 3,
  };
}

export function QuizBuilder({ initialQuiz, onSave, onCancel }: QuizBuilderProps) {
  const [title, setTitle] = useState(initialQuiz?.title ?? '');
  const [description, setDescription] = useState(initialQuiz?.description ?? '');
  const [questions, setQuestions] = useState<QuizQuestion[]>(() =>
    initialQuiz?.questions?.length
      ? initialQuiz.questions.map((q) => ({
          ...q,
          options: q.type === 'mcq' ? [...q.options] : [],
          correctAnswer: Array.isArray(q.correctAnswer)
            ? [...q.correctAnswer]
            : q.correctAnswer,
        }))
      : [createBlankQuestion('mcq')]
  );

  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const totalPoints = calculateMaxScore(questions);

  const updateQuestion = (index: number, updater: (q: QuizQuestion) => QuizQuestion) => {
    setQuestions((prev) => prev.map((item, i) => (i === index ? updater(item) : item)));
    if (validationErrors.length > 0) setValidationErrors([]);
  };

  const handleTypeChange = (index: number, nextType: QuestionType) => {
    updateQuestion(index, (q) => {
      if (q.type === nextType) return q;
      if (nextType === 'mcq') {
        return {
          ...q,
          type: 'mcq',
          options: q.options.length >= 2 ? q.options : ['', '', '', ''],
          correctAnswer: [0],
        };
      }
      return {
        ...q,
        type: nextType,
        options: [],
        correctAnswer: typeof q.correctAnswer === 'string' ? q.correctAnswer : '',
      };
    });
  };

  const toggleCorrectOption = (qIndex: number, optIndex: number) => {
    updateQuestion(qIndex, (q) => {
      const current = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
      const exists = current.includes(optIndex);
      const next = exists
        ? current.filter((idx) => idx !== optIndex)
        : [...current, optIndex].sort((a, b) => a - b);
      return { ...q, correctAnswer: next };
    });
  };

  const updateOptionText = (qIndex: number, optIndex: number, value: string) => {
    updateQuestion(qIndex, (q) => {
      const nextOptions = [...q.options];
      nextOptions[optIndex] = value;
      return { ...q, options: nextOptions };
    });
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    setQuestions((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const addQuestion = (type: QuestionType) => {
    setQuestions((prev) => [...prev, createBlankQuestion(type)]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateQuizDraft({ title, description, questions });
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }

    setSaving(true);
    setValidationErrors([]);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        questions,
      });
    } catch (err) {
      setValidationErrors([err instanceof Error ? err.message : 'Unable to save quiz.']);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl mx-auto pb-16">
      {/* Sticky sub-header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 mb-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
              {initialQuiz ? 'Edit Quiz' : 'Create New Quiz'}
            </h1>
            <p className="text-xs text-slate-500 tabular-nums">
              {questions.length} {questions.length === 1 ? 'question' : 'questions'} · {totalPoints} total points
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-10 px-5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : 'Save Quiz'}
          </button>
        </div>
      </div>

      {/* Validation summary */}
      {validationErrors.length > 0 && (
        <div
          role="alert"
          className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-900"
        >
          <div className="flex items-center gap-2 font-semibold text-sm mb-1.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Please fix the following before saving</span>
          </div>
          <ul className="list-disc list-inside text-xs space-y-1 text-rose-800">
            {validationErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Quiz Metadata */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 mb-6 space-y-4">
        <div>
          <label htmlFor="quiz-title-input" className="block text-sm font-medium text-slate-800 mb-1.5">
            Quiz Title
          </label>
          <input
            id="quiz-title-input"
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (validationErrors.length > 0) setValidationErrors([]);
            }}
            placeholder="e.g. Week 4 Distributed Systems Check-In"
            className="w-full h-11 px-3.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
          />
        </div>

        <div>
          <label htmlFor="quiz-desc-input" className="block text-sm font-medium text-slate-800 mb-1.5">
            Description (Optional)
          </label>
          <textarea
            id="quiz-desc-input"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief instructions or scope shown to participants before they start."
            className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 resize-y"
          />
        </div>
      </section>

      {/* Questions List */}
      <div className="space-y-5">
        {questions.map((q, index) => {
          const selectedIndices = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
          return (
            <section
              key={q.id}
              className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
            >
              {/* Question Header Row */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-sm font-bold text-slate-900 tabular-nums">
                    Question {index + 1}
                  </span>

                  {/* Question Type Segmented Switch */}
                  <div className="inline-flex items-center p-0.5 bg-slate-100 rounded-lg" role="group" aria-label={`Question ${index + 1} type`}>
                    <button
                      type="button"
                      onClick={() => handleTypeChange(index, 'mcq')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        q.type === 'mcq'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Multiple Choice
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTypeChange(index, 'short_answer')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        q.type === 'short_answer'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Short Answer
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTypeChange(index, 'paragraph')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        q.type === 'paragraph'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Paragraph
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor={`pts-${q.id}`} className="text-xs font-medium text-slate-600">
                    Points
                  </label>
                  <input
                    id={`pts-${q.id}`}
                    type="number"
                    min={1}
                    max={100}
                    step={0.5}
                    value={q.points}
                    onChange={(e) =>
                      updateQuestion(index, (item) => ({
                        ...item,
                        points: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    className="w-18 h-8 px-2 rounded-md border border-slate-300 text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />

                  <div className="h-4 w-px bg-slate-200 mx-1" aria-hidden="true" />

                  <button
                    type="button"
                    onClick={() => moveQuestion(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move question ${index + 1} up`}
                    className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 transition-colors"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveQuestion(index, 1)}
                    disabled={index === questions.length - 1}
                    aria-label={`Move question ${index + 1} down`}
                    className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-30 transition-colors"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeQuestion(index)}
                    disabled={questions.length <= 1}
                    aria-label={`Delete question ${index + 1}`}
                    className="p-1.5 rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-50 disabled:opacity-30 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Question Prompt */}
              <div>
                <label htmlFor={`q-text-${q.id}`} className="block text-xs font-medium text-slate-700 mb-1.5">
                  Question Text
                </label>
                <textarea
                  id={`q-text-${q.id}`}
                  rows={2}
                  value={q.text}
                  onChange={(e) =>
                    updateQuestion(index, (item) => ({ ...item, text: e.target.value }))
                  }
                  placeholder="Write your question clearly..."
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 resize-y"
                />
              </div>

              {/* MCQ Options or Short Answer Reference */}
              {q.type === 'mcq' ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">
                      Answer Options (click checkboxes to mark one or more correct answers)
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {selectedIndices.length} correct selected
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {q.options.map((opt, optIdx) => {
                      const isCorrect = selectedIndices.includes(optIdx);
                      const letter = String.fromCharCode(65 + optIdx);
                      return (
                        <div
                          key={optIdx}
                          className={`flex items-center gap-2.5 p-2 rounded-lg border transition-colors ${
                            isCorrect
                              ? 'border-emerald-300 bg-emerald-50/50'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => toggleCorrectOption(index, optIdx)}
                            aria-label={`Mark option ${letter} for question ${index + 1} as correct`}
                            aria-pressed={isCorrect}
                            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 border transition-colors ${
                              isCorrect
                                ? 'bg-emerald-600 border-emerald-600 text-white'
                                : 'bg-white border-slate-300 text-slate-400 hover:border-slate-400'
                            }`}
                          >
                            {isCorrect ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <span className="text-xs font-mono font-semibold">{letter}</span>
                            )}
                          </button>
                          <input
                            type="text"
                            aria-label={`Question ${index + 1} option ${letter}`}
                            value={opt}
                            onChange={(e) => updateOptionText(index, optIdx, e.target.value)}
                            placeholder={`Option ${letter}`}
                            className="flex-1 h-8 px-2 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor={`q-ref-${q.id}`} className="block text-xs font-medium text-slate-700 mb-1.5">
                    {q.type === 'paragraph'
                      ? 'Grading Rubric / Model Paragraph (Optional — visible only to host)'
                      : 'Reference Answer for Host Grading (Optional — not shown before submission)'}
                  </label>
                  <textarea
                    id={`q-ref-${q.id}`}
                    rows={q.type === 'paragraph' ? 4 : 2}
                    value={typeof q.correctAnswer === 'string' ? q.correctAnswer : ''}
                    onChange={(e) =>
                      updateQuestion(index, (item) => ({ ...item, correctAnswer: e.target.value }))
                    }
                    placeholder={
                      q.type === 'paragraph'
                        ? 'Outline the key concepts, examples, or structure you will award marks for when grading this paragraph response...'
                        : 'Key points to look for when reviewing anonymous responses...'
                    }
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 resize-y"
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Add Question Actions */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => addQuestion('mcq')}
          className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-indigo-600" />
          Add Multiple Choice
        </button>
        <button
          type="button"
          onClick={() => addQuestion('short_answer')}
          className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-indigo-600" />
          Add Short Answer
        </button>
        <button
          type="button"
          onClick={() => addQuestion('paragraph')}
          className="h-10 px-4 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 text-indigo-600" />
          Add Paragraph Question
        </button>
      </div>
    </form>
  );
}
