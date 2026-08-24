import { useEffect, useMemo, useState } from 'preact/hooks';
import { ArrowLeft, ChevronRight, Volume2 } from 'lucide-react';

import {
  WordReviewQueueItem,
  approveWordPoolReview,
  autoApproveWordPoolQueue,
  bulkReviewWordPool,
  rejectWordPoolReview,
  retryWordPoolReview,
} from '../../api';
import { difficultyLabel, formatShortDate } from './format';
import {
  AdminButton,
  DIVIDER,
  ErrorLine,
  KeyCap,
  LoadingLine,
  SectionLabel,
  StatusEnum,
} from './primitives';

interface ReviewProps {
  queue: WordReviewQueueItem[];
  loading: boolean;
  error: string | null;
  /** Whole pending backlog, which may run past the loaded page. */
  queueTotal: number;
  /** Last auto-approve sweep, so the rail can report what it did. */
  lastSweep: { scanned: number; approved: number; flagged: number } | null;
  onSweepComplete: (result: { scanned: number; approved: number; flagged: number }) => void;
  onQueueChanged: () => void;
  onLeave: () => void;
}

/**
 * One word at a time; approving advances to the next. This is its own screen
 * entered from the sidebar badge, not a section of Words — a queue you work
 * through should not make you pick the next item out of a list.
 */
export function Review({
  queue,
  queueTotal,
  loading,
  error,
  lastSweep,
  onSweepComplete,
  onQueueChanged,
  onLeave,
}: ReviewProps) {
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPayload, setShowPayload] = useState(false);

  const current = queue[index] ?? null;

  // A shrinking queue can leave the cursor past the end.
  useEffect(() => {
    if (index > 0 && index >= queue.length) {
      setIndex(Math.max(0, queue.length - 1));
    }
  }, [queue.length, index]);

  // The note belongs to the word being judged, not to the screen.
  useEffect(() => {
    setNote('');
    setShowPayload(false);
    setActionError(null);
  }, [current?.id]);

  const canReject = note.trim().length > 0;

  const advance = () => {
    setIndex((previous) => (previous + 1 < queue.length ? previous + 1 : previous));
  };

  const runAction = async (action: () => Promise<unknown>, thenAdvance: boolean) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      if (thenAdvance) {
        advance();
      }
      onQueueChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = () => {
    if (!current) return;
    // The API requires a definition to approve against.
    if (!current.details || current.details.meanings.length === 0) {
      setActionError('This word has no card to approve. Retry enrichment first.');
      return;
    }
    void runAction(
      () =>
        approveWordPoolReview(current.id, {
          details: current.details ?? undefined,
          reviewNote: note.trim() ? note.trim() : undefined,
        }),
      true
    );
  };

  const handleReject = () => {
    if (!current || !canReject) return;
    void runAction(() => rejectWordPoolReview(current.id, note.trim()), true);
  };

  const handleRetry = () => {
    if (!current) return;
    void runAction(() => retryWordPoolReview(current.id), false);
  };

  const handleSweep = () => {
    void runAction(async () => {
      const result = await autoApproveWordPoolQueue();
      onSweepComplete(result);
    }, false);
  };

  const handleApproveAll = () => {
    if (queue.length === 0) return;
    void runAction(
      () =>
        bulkReviewWordPool({
          wordPoolIds: queue.map((item) => item.id),
          action: 'approve',
          reviewNote: note.trim() ? note.trim() : undefined,
        }),
      false
    );
  };

  // A approves, R rejects (blocked without a note), → skips.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'a' || event.key === 'A') {
        event.preventDefault();
        handleApprove();
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        handleReject();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current?.id, note, busy, queue.length]);

  const meaning = current?.details?.meanings?.[0] ?? null;
  const definition = meaning?.definitions?.[0] ?? null;
  const example = meaning?.examples?.[0] ?? null;

  const payload = useMemo(() => {
    if (!current?.rawPayload) return null;
    try {
      return JSON.stringify(current.rawPayload, null, 2);
    } catch {
      return null;
    }
  }, [current?.rawPayload]);

  if (error) {
    return <ErrorLine message={error} onRetry={onQueueChanged} />;
  }
  if (loading && queue.length === 0) {
    return <LoadingLine>Loading the queue.</LoadingLine>;
  }
  if (!current) {
    return (
      <div className="py-8">
        <SectionLabel className="mb-2">Nothing to review</SectionLabel>
        <p className="m-0 font-display text-[26px] font-normal leading-[1.25]">
          The queue is clear.
        </p>
        <p className="mt-1.5 text-[14px] leading-[1.6] text-ink/[0.66]">
          Words flagged by the quality gate will land here.
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <AdminButton variant="ghost" onClick={handleSweep} disabled={busy}>
            Run sweep
          </AdminButton>
          <AdminButton variant="ghost" onClick={onLeave}>
            Back to Overview
          </AdminButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col pt-6 lg:pt-[34px]">
        <div className="mb-5 flex items-center gap-3 lg:mb-[22px]">
          <SectionLabel>Needs a decision</SectionLabel>
          <span className="h-px flex-1 bg-accent/50" />
          <span className="tabular text-[10px] uppercase tracking-[0.14em] text-ink/[0.5] lg:text-[12px] lg:tracking-[0.1em]">
            {difficultyLabel(current.difficultyCategory)}
            {current.fetchedAt ? ` · fetched ${formatShortDate(current.fetchedAt)}` : ''}
          </span>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-5">
          <h1 className="m-0 font-display text-[52px] font-normal leading-[0.95] tracking-[-0.02em] lg:text-[76px]">
            {current.word}
          </h1>
          <div className="flex items-center gap-3 lg:pb-2">
            <span className="text-[15px] italic text-ink/[0.6] lg:text-[16px]">
              {current.details?.phonetics ?? '—'}
              {meaning?.partOfSpeech ? ` · ${meaning.partOfSpeech}` : ''}
            </span>
            <button
              type="button"
              disabled={!current.details?.audioUrl}
              title={
                current.details?.audioUrl
                  ? `Play ${current.word}`
                  : 'No audio available for this word'
              }
              onClick={() => {
                if (current.details?.audioUrl) {
                  void new Audio(current.details.audioUrl).play().catch(() => undefined);
                }
              }}
              className="ml-auto flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full border border-accent text-accent disabled:opacity-45 lg:ml-0"
            >
              <Volume2 size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-5 max-w-[620px] lg:mt-[26px]">
          {definition ? (
            <p className="m-0 hyphens-auto text-justify text-[17px] leading-[1.6] text-pretty lg:text-[18px]">
              {definition}
            </p>
          ) : (
            <p className="m-0 text-[17px] italic leading-[1.6] text-ink/[0.68]">
              No definition came back for this one.
            </p>
          )}
          {example ? (
            <p
              className={`mt-4 border-l border-accent pl-4 text-[16px] italic leading-[1.55] text-ink/[0.72] lg:mt-[18px]`}
            >
              {example}
            </p>
          ) : null}
          {current.details?.etymology ? (
            <p className="mt-5 hyphens-auto text-justify text-[15px] leading-[1.6] text-ink/[0.68]">
              {current.details.etymology}
            </p>
          ) : null}
        </div>

        {/* Why it was flagged */}
        <div
          className={`mt-[18px] max-w-[620px] rounded-[2px] border ${DIVIDER} border-l-2 border-l-accent-strong px-4 py-3.5 lg:mt-6 lg:px-[18px] lg:py-4`}
        >
          <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <SectionLabel tone="warning">Why it was flagged</SectionLabel>
            <span className="font-mono text-[11px] text-ink/[0.6] lg:ml-auto">
              detailsStatus: {current.detailsStatus} · reviewStatus: {current.reviewStatus}
            </span>
          </div>
          <p className="m-0 text-[14px] leading-[1.6] text-ink/[0.78]">
            {current.error
              ? current.error
              : 'Enrichment returned a card but it did not pass the quality gate, so it was held instead of auto-approved.'}
          </p>
          {payload ? (
            <>
              <button
                type="button"
                onClick={() => setShowPayload((previous) => !previous)}
                aria-expanded={showPayload}
                className="mt-2.5 flex cursor-pointer items-center gap-2.5 text-[13px] text-accent"
              >
                <ChevronRight
                  size={13}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className={
                    showPayload ? 'rotate-90 transition-transform' : 'transition-transform'
                  }
                />
                <span>Raw provider payload</span>
              </button>
              {showPayload ? (
                <pre className="mt-2.5 max-h-64 overflow-auto rounded-[2px] bg-ink/[0.04] p-3 font-mono text-[11px] leading-[1.5] text-ink/[0.72]">
                  {payload}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>

        {/* Review note */}
        <div className="mt-4 max-w-[620px] lg:mt-5">
          <div className="mb-1.5 flex items-baseline gap-2 lg:mb-[7px]">
            <SectionLabel>Review note</SectionLabel>
            <span className="text-[12px] text-ink/[0.55]">
              required to reject, optional to approve
            </span>
          </div>
          <input
            type="text"
            value={note}
            onInput={(event) => setNote((event.target as HTMLInputElement).value)}
            placeholder="Reason for approval, edit, or rejection"
            aria-label="Review note"
            className={`w-full border-0 border-b ${DIVIDER} bg-transparent pb-2 text-[15px] text-ink caret-accent outline-none placeholder:text-ink/[0.45] focus:border-accent`}
          />
        </div>

        {actionError ? <p className="mt-3 text-[14px] text-accent-strong">{actionError}</p> : null}

        {/* Action bar */}
        <div
          className={`mt-auto flex flex-col gap-2.5 border-t pt-4 pb-6 lg:flex-row lg:items-center lg:gap-3 lg:pt-5 ${DIVIDER}`}
        >
          <AdminButton
            variant="primary"
            onClick={handleApprove}
            disabled={busy}
            className="min-h-[48px] lg:min-h-[46px]"
          >
            Approve
          </AdminButton>
          <div className="flex gap-2.5 lg:contents">
            <AdminButton
              variant="secondary"
              onClick={handleRetry}
              disabled={busy}
              className="min-h-[46px] flex-1 lg:flex-none"
            >
              <span className="lg:hidden">Retry</span>
              <span className="hidden lg:inline">Retry enrichment</span>
            </AdminButton>
            <AdminButton
              variant="ghost"
              onClick={handleReject}
              disabled={busy || !canReject}
              title={canReject ? undefined : 'A review note is required to reject'}
              className="min-h-[46px] flex-1 lg:flex-none"
            >
              Reject
            </AdminButton>
          </div>
          <span className="hidden flex-1 lg:block" />
          <span className="hidden items-center gap-3.5 text-[12px] text-ink/[0.55] lg:flex">
            <span className="flex items-center gap-1.5">
              <KeyCap>A</KeyCap>approve
            </span>
            <span className="flex items-center gap-1.5">
              <KeyCap>R</KeyCap>reject
            </span>
            <span className="flex items-center gap-1.5">
              <KeyCap>→</KeyCap>skip
            </span>
          </span>
        </div>
      </div>

      {/* Right rail — what is still queued */}
      <aside
        className={`w-full flex-none border-t pt-6 lg:ml-[26px] lg:w-[300px] lg:border-l lg:border-t-0 lg:pt-[30px] lg:pl-[26px] ${DIVIDER}`}
      >
        <SectionLabel className="mb-3.5">
          Still queued
          {queueTotal > queue.length ? ` · ${queue.length} of ${queueTotal}` : ''}
        </SectionLabel>
        <div className="flex flex-col">
          {queue.map((item, itemIndex) => {
            const isCurrent = itemIndex === index;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setIndex(itemIndex)}
                className={`flex min-h-[44px] cursor-pointer items-baseline gap-2.5 border-b py-[11px] text-left ${DIVIDER} last:border-b-0`}
              >
                <span
                  className={`font-display text-[19px] ${isCurrent ? 'text-accent' : 'text-ink'}`}
                >
                  {item.word}
                </span>
                {isCurrent ? (
                  <span className="ml-auto text-[11px] uppercase tracking-[0.1em] text-accent">
                    Now
                  </span>
                ) : (
                  <StatusEnum status={item.detailsStatus} className="ml-auto" />
                )}
              </button>
            );
          })}
        </div>

        <div className={`mt-5 flex flex-col gap-2.5 border-t pt-4 ${DIVIDER}`}>
          {lastSweep ? (
            <div className="text-[13px] leading-[1.6] text-ink/[0.62]">
              Last sweep scanned {lastSweep.scanned} words: approved {lastSweep.approved}, flagged{' '}
              {lastSweep.flagged} for manual review.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <AdminButton variant="ghost" onClick={handleApproveAll} disabled={busy}>
              Approve these {queue.length}
            </AdminButton>
            <AdminButton variant="ghost" onClick={handleSweep} disabled={busy}>
              Run sweep
            </AdminButton>
          </div>
        </div>

        <button
          type="button"
          onClick={onLeave}
          className="mt-5 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[14px] text-accent lg:hidden"
        >
          <ArrowLeft size={15} strokeWidth={1.4} aria-hidden="true" />
          Skip all, review later
        </button>
      </aside>
    </div>
  );
}
