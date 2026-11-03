import type { LessonFixture } from '@smartpath/tutor-core';
import { useState } from 'react';

export function QuizPanel({ quiz, onAnswer }: { quiz: LessonFixture['quiz']; onAnswer(choiceId: string): void }) {
  const [answer, setAnswer] = useState<string | null>(null);
  const chosen = quiz.choices.find((choice) => choice.id === answer);

  return (
    <section className="shrink-0 border-t border-line bg-surface p-3" data-target-id="quiz" aria-label="Check your understanding">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">Check your understanding</p>
      <p className="mt-1 text-[15px] font-medium text-ink">{quiz.question}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {quiz.choices.map((choice) => {
          const state = answer === null ? 'open' : choice.correct ? 'correct' : choice.id === answer ? 'wrong' : 'dim';
          return (
            <button
              key={choice.id}
              type="button"
              data-testid={`quiz-${choice.id}`}
              data-state={state}
              disabled={answer !== null}
              onClick={() => {
                setAnswer(choice.id);
                onAnswer(choice.id);
              }}
              className="quiz-choice"
            >
              {choice.label}
            </button>
          );
        })}
      </div>
      {chosen && (
        <p data-testid="quiz-explanation" className="mt-2 text-[13px] text-ink-soft" role="status">
          {chosen.explanation}
        </p>
      )}
    </section>
  );
}
