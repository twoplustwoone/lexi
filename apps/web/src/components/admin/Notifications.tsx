import { useEffect, useMemo, useState } from 'preact/hooks';
import { Bell } from 'lucide-react';

import {
  AdminLogEntry,
  AdminNotifyResponse,
  AdminUser,
  DailyWordPayload,
  sendAdminNotification,
} from '../../api';
import { displayName, formatDateTime } from './format';
import { AdminButton, DIVIDER, LoadingLine, SectionLabel, Tag } from './primitives';

interface NotificationsProps {
  users: AdminUser[];
  logs: AdminLogEntry[];
  loading: boolean;
  today: DailyWordPayload | null;
  /** Preselected when Overview sends you here to test a failed recipient. */
  initialRecipients: string[];
}

/**
 * The recipient picker sits inline with the composer it controls — previously
 * the checkboxes lived far below the message they applied to.
 */
export function Notifications({
  users,
  logs,
  loading,
  today,
  initialRecipients,
}: NotificationsProps) {
  const [selected, setSelected] = useState<string[]>(initialRecipients);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<AdminNotifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialRecipients.length > 0) {
      setSelected(initialRecipients);
    }
  }, [initialRecipients.join(',')]);

  const allSelected = selected.length === users.length && users.length > 0;

  const toggle = (userId: string) => {
    setSelected((previous) =>
      previous.includes(userId) ? previous.filter((id) => id !== userId) : [...previous, userId]
    );
  };

  const handleUseTodaysWord = () => {
    if (!today) return;
    const definition = today.details?.meanings?.[0]?.definitions?.[0];
    setMessage(
      definition ? `Today's word is ${today.word} — ${definition}` : `Today's word is ${today.word}`
    );
  };

  const handleSend = async () => {
    if (selected.length === 0 || !message.trim()) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await sendAdminNotification({
        title: 'Lexi',
        body: message.trim(),
        target: 'custom',
        userIds: selected,
        includePayload: true,
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  /** Recent sends, newest first — delivery result on the right, failures in gold. */
  const recentSends = useMemo(() => {
    const byRun = new Map<string, { timestamp: string; delivered: number; failed: number }>();
    for (const entry of logs) {
      if (entry.category !== 'push' && entry.category !== 'cron') continue;
      const bucket = entry.timestamp.slice(0, 16);
      const existing = byRun.get(bucket) ?? { timestamp: entry.timestamp, delivered: 0, failed: 0 };
      if (entry.level === 'info') {
        existing.delivered += 1;
      } else {
        existing.failed += 1;
      }
      byRun.set(bucket, existing);
    }
    return Array.from(byRun.values())
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 8);
  }, [logs]);

  const summary = result
    ? {
        ok: result.results.filter((item) => item.ok).length,
        failed: result.results.filter((item) => !item.ok).length,
      }
    : null;

  if (loading && users.length === 0) {
    return <LoadingLine>Loading recipients.</LoadingLine>;
  }

  return (
    <>
      <SectionLabel className="mb-3 pt-4">Send a test</SectionLabel>

      <div className={`rounded-md border px-4 py-4 lg:px-5 ${DIVIDER}`}>
        <div className={`flex items-baseline gap-2.5 border-b pb-3 ${DIVIDER}`}>
          <span className="text-[14px] text-ink/[0.65]">To</span>
          <span className="text-[15px]">
            {selected.length} of {users.length}
            <span className="hidden lg:inline"> people</span>
          </span>
          <button
            type="button"
            onClick={() => setSelected(allSelected ? [] : users.map((user) => user.id))}
            className="ml-auto cursor-pointer text-[13px] text-accent"
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 pb-1 pt-3.5">
          {users.map((user) => {
            const isSelected = selected.includes(user.id);
            return (
              <Tag key={user.id} selected={isSelected} onClick={() => toggle(user.id)}>
                {displayName(user)}
                {isSelected ? ' ✓' : ''}
              </Tag>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_250px]">
        <div>
          <SectionLabel className="mb-2.5">Message</SectionLabel>
          <textarea
            value={message}
            onInput={(event) => setMessage((event.target as HTMLTextAreaElement).value)}
            aria-label="Message"
            placeholder="What should it say?"
            className={`min-h-[104px] w-full resize-y rounded-md border bg-transparent px-4 py-3.5 text-[15px] leading-[1.55] text-ink caret-accent outline-none placeholder:text-ink/[0.45] focus:border-accent ${DIVIDER}`}
          />
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <AdminButton
              variant="primary"
              onClick={handleSend}
              disabled={sending || selected.length === 0 || !message.trim()}
              className="min-h-[42px]"
            >
              {sending ? 'Sending…' : `Send to ${selected.length}`}
            </AdminButton>
            <AdminButton
              variant="ghost"
              onClick={handleUseTodaysWord}
              disabled={!today}
              className="min-h-[42px]"
            >
              Use today&apos;s word
            </AdminButton>
          </div>

          {error ? <p className="mt-3 text-[14px] text-accent-strong">{error}</p> : null}
          {summary ? (
            <p className="mt-3 text-[14px] text-ink/[0.68]">
              {summary.ok} delivered
              {summary.failed > 0 ? (
                <span className="text-accent-strong">, {summary.failed} failed</span>
              ) : null}
              .
            </p>
          ) : null}
        </div>

        {/* The preview drops at phone width. */}
        <div className="hidden lg:block">
          <SectionLabel className="mb-2.5">Preview</SectionLabel>
          <div className={`rounded-md border bg-neutral-100 px-3.5 py-3 ${DIVIDER}`}>
            <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-ink/[0.5]">
              <Bell size={12} strokeWidth={1.6} aria-hidden="true" />
              <span>Lexi · now</span>
            </div>
            <div className="text-[14px] leading-[1.5]">
              {message.trim() || 'Your message will appear here.'}
            </div>
          </div>
        </div>
      </div>

      <SectionLabel className="mb-3 mt-6">Recent sends</SectionLabel>
      {recentSends.length === 0 ? (
        <p className="m-0 text-[15px] text-ink/[0.66]">Nothing sent yet.</p>
      ) : (
        recentSends.map((send) => (
          <div
            key={send.timestamp}
            className={`flex items-baseline gap-3 border-b py-[11px] ${DIVIDER} last:border-b-0`}
          >
            <span className="tabular w-[92px] flex-none text-[12px] text-ink/[0.52]">
              {formatDateTime(send.timestamp)}
            </span>
            <span className="flex-1 text-[14px]">
              {send.delivered + send.failed} {send.delivered + send.failed === 1 ? 'send' : 'sends'}
            </span>
            <span className="tabular text-[13px]">
              {send.delivered} delivered
              {send.failed > 0 ? (
                <span className="text-accent-strong">, {send.failed} failed</span>
              ) : null}
            </span>
          </div>
        ))
      )}
    </>
  );
}
