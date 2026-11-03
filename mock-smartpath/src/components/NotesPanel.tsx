import { useCallback, useState } from 'react';

export interface Note {
  id: string;
  page: number;
  quote: string;
  note: string;
  createdAt: number;
}

const STORAGE_KEY = 'smartpath-demo:notes:v1';

function readNotes(): Note[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as Note[]) : [];
  } catch {
    return [];
  }
}

function writeNotes(notes: Note[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Storage can be blocked; notes still last for this page load.
  }
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(readNotes);

  const addNote = useCallback((input: Pick<Note, 'page' | 'quote' | 'note'>) => {
    setNotes((current) => {
      const next = [{ ...input, id: crypto.randomUUID(), createdAt: Date.now() }, ...current];
      writeNotes(next);
      return next;
    });
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((current) => {
      const next = current.filter((note) => note.id !== id);
      writeNotes(next);
      return next;
    });
  }, []);

  return { notes, addNote, removeNote };
}

interface Props {
  notes: Note[];
  onJump(page: number): void;
  onRemove(id: string): void;
  onClose(): void;
}

export function NotesPanel({ notes, onJump, onRemove, onClose }: Props) {
  return (
    <aside className="absolute right-3 top-14 z-30 flex max-h-[70%] w-80 flex-col rounded-xl border border-line bg-surface shadow-xl" data-target-id="notes-panel" aria-label="Saved notes">
      <header className="flex h-11 shrink-0 items-center border-b border-line px-3 text-[13px] font-medium">
        Saved notes
        <button type="button" aria-label="Close notes" className="ml-auto grid h-7 w-7 place-items-center rounded text-ink-soft hover:bg-canvas" onClick={onClose}>
          ×
        </button>
      </header>
      <ul className="min-h-0 flex-1 overflow-auto p-2">
        {notes.length === 0 && <li className="p-2 text-[13px] text-ink-soft">Nothing saved yet. Select a passage or ask the companion to save an explanation.</li>}
        {notes.map((note) => (
          <li key={note.id} data-testid="note-item" className="rounded-lg p-2 text-[13px] hover:bg-canvas">
            <p className="text-ink">{note.note}</p>
            {note.quote && <p className="mt-1 line-clamp-2 border-l-2 border-marker pl-2 text-ink-soft">{note.quote}</p>}
            <div className="mt-1 flex gap-2 text-xs">
              <button type="button" className="text-brand hover:underline" onClick={() => onJump(note.page)}>
                Page {note.page}
              </button>
              <button type="button" className="text-ink-soft hover:underline" onClick={() => onRemove(note.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
