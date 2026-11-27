import { ArrowLeft, BarChart, Bell, BookOpen, CheckSquare, KeyRound, Users } from 'lucide-react';

import { DIVIDER } from './primitives';

export type AdminView = 'overview' | 'review' | 'words' | 'notifications' | 'people' | 'sessions';

interface Destination {
  id: AdminView;
  label: string;
  /** The rail is narrower than the sidebar, so Notifications shortens. */
  shortLabel: string;
  icon: typeof BarChart;
}

const DESTINATIONS: Destination[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: BarChart },
  { id: 'review', label: 'Review', shortLabel: 'Review', icon: CheckSquare },
  { id: 'words', label: 'Words', shortLabel: 'Words', icon: BookOpen },
  { id: 'notifications', label: 'Notifications', shortLabel: 'Notifs', icon: Bell },
  { id: 'people', label: 'People', shortLabel: 'People', icon: Users },
  { id: 'sessions', label: 'Sessions', shortLabel: 'Sessions', icon: KeyRound },
];

interface AdminNavProps {
  active: AdminView;
  onNavigate: (view: AdminView) => void;
  /** Rides on Review so it stays visible from any section. */
  queueCount: number;
  onBackToApp: () => void;
}

function QueueBadge({ count, className = '' }: { count: number; className?: string }) {
  return (
    <span
      className={`tabular min-w-[22px] rounded-full border border-accent px-1.5 py-px text-center font-display text-[12px] text-accent ${className}`}
    >
      {count}
    </span>
  );
}

/** 228px sidebar. The active row is accent text with a 2px inset rule at its left edge. */
export function AdminSidebar({ active, onNavigate, queueCount, onBackToApp }: AdminNavProps) {
  return (
    <nav
      aria-label="Admin sections"
      className={`hidden w-[228px] flex-none flex-col border-r pb-[18px] pt-6 lg:flex ${DIVIDER}`}
    >
      <div className="flex flex-col gap-[3px] px-[22px] pb-[22px]">
        <span className="font-display text-[12px] uppercase tracking-[0.28em] text-ink/[0.58]">
          Lexi
        </span>
        <span className="text-[11px] uppercase tracking-[0.16em] text-accent">Admin</span>
      </div>

      <div className="flex flex-col">
        {DESTINATIONS.map((destination) => {
          const Icon = destination.icon;
          const isActive = destination.id === active;
          return (
            <button
              key={destination.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(destination.id)}
              className={`flex min-h-[44px] cursor-pointer items-center gap-[11px] px-[22px] text-left text-[15px] transition-colors ${
                isActive
                  ? 'text-accent shadow-[inset_2px_0_0_var(--color-accent)]'
                  : 'text-ink/[0.72] hover:bg-ink/[0.04]'
              }`}
            >
              <Icon size={17} strokeWidth={1.4} className="flex-none" aria-hidden="true" />
              <span>{destination.label}</span>
              {destination.id === 'review' && queueCount > 0 ? (
                <QueueBadge count={queueCount} className="ml-auto" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-auto px-[22px]">
        <hr className={`m-0 mb-3.5 border-0 border-t ${DIVIDER}`} />
        <button
          type="button"
          onClick={onBackToApp}
          className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[14px] text-accent"
        >
          <ArrowLeft size={15} strokeWidth={1.4} aria-hidden="true" />
          <span>Back to the app</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * Mobile gets a scrolling section rail rather than a tab bar — five
 * destinations will not fit alongside the reader app's two.
 */
export function AdminRail({ active, onNavigate, queueCount, onBackToApp }: AdminNavProps) {
  return (
    <div className="flex-none lg:hidden">
      <div className="flex items-center gap-2.5 px-[22px] pt-2">
        <span className="font-display text-[12px] uppercase tracking-[0.28em] text-ink/[0.58]">
          Lexi
        </span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-accent">Admin</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onBackToApp}
          aria-label="Back to the app"
          className="flex h-11 w-11 cursor-pointer items-center justify-center text-ink/[0.6]"
        >
          <ArrowLeft size={18} strokeWidth={1.4} aria-hidden="true" />
        </button>
      </div>

      <nav
        aria-label="Admin sections"
        className={`no-scrollbar flex gap-[15px] overflow-x-auto border-b px-[22px] pt-1.5 ${DIVIDER}`}
      >
        {DESTINATIONS.map((destination) => {
          const isActive = destination.id === active;
          return (
            <button
              key={destination.id}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(destination.id)}
              className={`flex flex-none cursor-pointer items-center gap-[5px] whitespace-nowrap pb-2.5 font-display text-[11px] uppercase tracking-[0.1em] ${
                isActive
                  ? 'text-accent shadow-[inset_0_-2px_0_var(--color-accent)]'
                  : 'text-ink/[0.55]'
              }`}
            >
              {destination.shortLabel}
              {destination.id === 'review' && queueCount > 0 ? (
                <QueueBadge count={queueCount} />
              ) : null}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
