import {
  AlertCircle,
  Book,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'preact/hooks';

import {
  AdminWord,
  AdminWordsResponse,
  bulkCreateAdminWords,
  createAdminWord,
  deleteAdminWord,
  fetchAdminWords,
  updateAdminWord,
  WordInput,
} from '../../api';
import { Button } from '../Button';

interface WordFormData {
  word: string;
  definition: string;
  etymology: string;
  pronunciation: string;
  examples: string[];
}

const emptyForm: WordFormData = {
  word: '',
  definition: '',
  etymology: '',
  pronunciation: '',
  examples: [''],
};

function WordForm({
  initialData,
  onSubmit,
  onCancel,
  loading,
}: {
  initialData?: AdminWord;
  onSubmit: (data: WordInput) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<WordFormData>(
    initialData
      ? {
          word: initialData.word,
          definition: initialData.definition,
          etymology: initialData.etymology || '',
          pronunciation: initialData.pronunciation || '',
          examples: initialData.examples.length ? initialData.examples : [''],
        }
      : emptyForm
  );
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);

    if (!form.word.trim() || !form.definition.trim()) {
      setError('Word and definition are required');
      return;
    }

    try {
      await onSubmit({
        word: form.word.trim(),
        definition: form.definition.trim(),
        etymology: form.etymology.trim() || undefined,
        pronunciation: form.pronunciation.trim() || undefined,
        examples: form.examples.filter((e) => e.trim()).map((e) => e.trim()),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save word');
    }
  };

  const addExample = () => {
    if (form.examples.length < 5) {
      setForm({ ...form, examples: [...form.examples, ''] });
    }
  };

  const removeExample = (index: number) => {
    setForm({
      ...form,
      examples: form.examples.filter((_, i) => i !== index),
    });
  };

  const updateExample = (index: number, value: string) => {
    const newExamples = [...form.examples];
    newExamples[index] = value;
    setForm({ ...form, examples: newExamples });
  };

  const inputClass =
    'w-full rounded-lg border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent-strong focus:outline-none focus:ring-1 focus:ring-accent-strong';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium text-ink">Word *</label>
        <input
          type="text"
          value={form.word}
          onInput={(e) => setForm({ ...form, word: (e.target as HTMLInputElement).value })}
          className={inputClass}
          placeholder="e.g., Serendipity"
          disabled={loading}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink">Definition *</label>
        <textarea
          value={form.definition}
          onInput={(e) => setForm({ ...form, definition: (e.target as HTMLTextAreaElement).value })}
          className={`${inputClass} min-h-[80px] resize-y`}
          placeholder="The occurrence of events by chance in a happy way"
          disabled={loading}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink">Pronunciation</label>
        <input
          type="text"
          value={form.pronunciation}
          onInput={(e) => setForm({ ...form, pronunciation: (e.target as HTMLInputElement).value })}
          className={inputClass}
          placeholder="e.g., /ˌserənˈdipədē/"
          disabled={loading}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-ink">Etymology</label>
        <textarea
          value={form.etymology}
          onInput={(e) => setForm({ ...form, etymology: (e.target as HTMLTextAreaElement).value })}
          className={`${inputClass} min-h-[60px] resize-y`}
          placeholder="Origin and history of the word"
          disabled={loading}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-ink">Examples</label>
          {form.examples.length < 5 && (
            <button
              type="button"
              onClick={addExample}
              className="text-xs text-accent-strong hover:underline"
              disabled={loading}
            >
              + Add example
            </button>
          )}
        </div>
        <div className="space-y-2">
          {form.examples.map((example, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={example}
                onInput={(e) => updateExample(index, (e.target as HTMLInputElement).value)}
                className={inputClass}
                placeholder={`Example sentence ${index + 1}`}
                disabled={loading}
              />
              {form.examples.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeExample(index)}
                  className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink"
                  disabled={loading}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Saving...' : initialData ? 'Update Word' : 'Add Word'}
        </Button>
      </div>
    </form>
  );
}

function BulkUpload({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WordInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    errors: Array<{ index: number; error: string }>;
  } | null>(null);

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const selectedFile = input.files?.[0];
    setError(null);
    setPreview(null);
    setResult(null);

    if (!selectedFile) {
      setFile(null);
      return;
    }

    if (!selectedFile.name.endsWith('.json')) {
      setError('Please select a JSON file');
      return;
    }

    try {
      const text = await selectedFile.text();
      const data = JSON.parse(text);

      let words: WordInput[];
      if (Array.isArray(data)) {
        words = data;
      } else if (data.words && Array.isArray(data.words)) {
        words = data.words;
      } else {
        throw new Error('Invalid format: expected an array or object with "words" array');
      }

      // Validate structure
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w.word || typeof w.word !== 'string') {
          throw new Error(`Word at index ${i} is missing required "word" field`);
        }
        if (!w.definition || typeof w.definition !== 'string') {
          throw new Error(`Word at index ${i} is missing required "definition" field`);
        }
      }

      setFile(selectedFile);
      setPreview(words);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse JSON file');
    }
  };

  const handleUpload = async () => {
    if (!preview) return;

    setLoading(true);
    setError(null);

    try {
      const uploadResult = await bulkCreateAdminWords(preview);
      setResult(uploadResult);
      if (uploadResult.created > 0) {
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-dashed border-[rgba(30,27,22,0.12)] p-6 text-center">
        <Upload className="mx-auto mb-2 text-muted" size={32} />
        <p className="mb-2 text-sm text-muted">Upload a JSON file with words</p>
        <input
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="mx-auto block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-strong hover:file:bg-accent-soft/80"
          disabled={loading}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {preview && !result && (
        <div className="rounded-lg bg-surface p-4">
          <p className="mb-2 text-sm font-medium text-ink">
            Found {preview.length} word{preview.length !== 1 ? 's' : ''} in {file?.name}
          </p>
          <div className="max-h-40 overflow-y-auto">
            <ul className="space-y-1 text-sm text-muted">
              {preview.slice(0, 10).map((w, i) => (
                <li key={i}>
                  <span className="font-medium text-ink">{w.word}</span> -{' '}
                  {w.definition.slice(0, 50)}...
                </li>
              ))}
              {preview.length > 10 && (
                <li className="text-xs">...and {preview.length - 10} more</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg bg-surface p-4">
          <p className="mb-2 text-sm font-medium text-ink">
            Created {result.created} word{result.created !== 1 ? 's' : ''}
            {result.errors.length > 0 &&
              `, ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`}
          </p>
          {result.errors.length > 0 && (
            <div className="max-h-32 overflow-y-auto">
              <ul className="space-y-1 text-xs text-[#991b1b]">
                {result.errors.map((err, i) => (
                  <li key={i}>
                    Index {err.index}: {err.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg bg-[#fffbeb] p-3 text-xs text-[#92400e]">
        <p className="mb-1 font-medium">Expected JSON format:</p>
        <pre className="overflow-x-auto whitespace-pre">
          {`[
  {
    "word": "Serendipity",
    "definition": "The occurrence of events by chance in a happy way",
    "pronunciation": "/ˌserənˈdipədē/",
    "etymology": "Coined by Horace Walpole in 1754",
    "examples": ["A serendipitous discovery"]
  }
]`}
        </pre>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {result ? 'Close' : 'Cancel'}
        </Button>
        {preview && !result && (
          <Button variant="primary" onClick={handleUpload} disabled={loading}>
            {loading ? 'Uploading...' : `Upload ${preview.length} Words`}
          </Button>
        )}
      </div>
    </div>
  );
}

export function WordManagement() {
  const [data, setData] = useState<AdminWordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editingWord, setEditingWord] = useState<AdminWord | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const limit = 20;

  const loadWords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminWords({
        limit,
        offset: page * limit,
        search: search || undefined,
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load words');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  const handleSearch = (e: Event) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(0);
  };

  const handleCreate = async (input: WordInput) => {
    setFormLoading(true);
    try {
      await createAdminWord(input);
      setShowForm(false);
      await loadWords();
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdate = async (input: WordInput) => {
    if (!editingWord) return;
    setFormLoading(true);
    try {
      await updateAdminWord(editingWord.id, input);
      setEditingWord(null);
      await loadWords();
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteAdminWord(id);
      setDeleteConfirm(null);
      await loadWords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete word');
    }
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const cardBase = 'rounded-2xl border border-[rgba(30,27,22,0.08)] bg-[rgba(255,252,247,0.7)]';

  if (showForm || editingWord) {
    return (
      <div className={`${cardBase} p-6`}>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-ink">
          <Book size={20} />
          {editingWord ? 'Edit Word' : 'Add New Word'}
        </h3>
        <WordForm
          initialData={editingWord || undefined}
          onSubmit={editingWord ? handleUpdate : handleCreate}
          onCancel={() => {
            setShowForm(false);
            setEditingWord(null);
          }}
          loading={formLoading}
        />
      </div>
    );
  }

  if (showBulkUpload) {
    return (
      <div className={`${cardBase} p-6`}>
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-ink">
          <Upload size={20} />
          Bulk Upload Words
        </h3>
        <BulkUpload onClose={() => setShowBulkUpload(false)} onSuccess={loadWords} />
      </div>
    );
  }

  return (
    <div className={`${cardBase} p-4`}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <Book size={20} />
          Words ({data?.total ?? 0})
        </h3>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowBulkUpload(true)}>
            <Upload size={14} className="mr-1" />
            Bulk Upload
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowForm(true)}>
            <Plus size={14} className="mr-1" />
            Add Word
          </Button>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
          <input
            type="text"
            value={searchInput}
            onInput={(e) => setSearchInput((e.target as HTMLInputElement).value)}
            placeholder="Search words..."
            className="w-full rounded-lg border border-[rgba(30,27,22,0.12)] bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-accent-strong focus:outline-none focus:ring-1 focus:ring-accent-strong"
          />
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
        {search && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              setSearchInput('');
              setPage(0);
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#991b1b]">
          <AlertCircle size={16} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-[rgba(30,27,22,0.04)]" />
          ))}
        </div>
      ) : data?.words.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted">
          {search ? 'No words found matching your search.' : 'No words yet. Add your first word!'}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {data?.words.map((word) => (
              <div
                key={word.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-[rgba(30,27,22,0.05)] bg-white p-3 transition-colors hover:bg-surface"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-ink">{word.word}</span>
                    {word.pronunciation && (
                      <span className="text-xs text-muted">{word.pronunciation}</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{word.definition}</p>
                  {word.examples.length > 0 && (
                    <p className="mt-1 line-clamp-1 text-xs italic text-muted">
                      "{word.examples[0]}"
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => setEditingWord(word)}
                    className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink"
                    title="Edit"
                  >
                    <Edit2 size={14} />
                  </button>
                  {deleteConfirm === word.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(word.id)}
                        className="rounded-lg bg-[#fef2f2] px-2 py-1 text-xs font-medium text-[#991b1b] hover:bg-[#fee2e2]"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="rounded-lg p-1 text-muted hover:text-ink"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(word.id)}
                      className="rounded-lg p-2 text-muted hover:bg-[#fef2f2] hover:text-[#991b1b]"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-[rgba(30,27,22,0.08)] pt-4">
              <p className="text-xs text-muted">
                Showing {page * limit + 1}-{Math.min((page + 1) * limit, data?.total ?? 0)} of{' '}
                {data?.total}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-3 py-2 text-sm text-ink">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg p-2 text-muted hover:bg-surface hover:text-ink disabled:opacity-50"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
