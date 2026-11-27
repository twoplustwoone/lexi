import { BookOpen, User } from 'lucide-react';
import { route } from 'preact-router';

/**
 * Two destinations. The active tab is accent text plus a 2px accent inset rule
 * on its top edge — no pill, no sliding indicator, no fill.
 *
 * This replaces NavLinks and its ResizeObserver-driven indicator entirely.
 * Admin is reached from You, not from the bar.
 */
export function TabBar({ active }: { active: 'words' | 'you' }) {
  const tabs = [
    { id: 'words' as const, label: 'Words', icon: BookOpen, href: '/' },
    { id: 'you' as const, label: 'You', icon: User, href: '/you' },
  ];

  return (
    <nav
      aria-label="Main"
      className="flex flex-none border-t border-ink/[0.16] bg-bg pb-[env(safe-area-inset-bottom,16px)]"
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => route(tab.href)}
            className={`flex min-h-[56px] flex-1 cursor-pointer flex-col items-center justify-center gap-1.5 font-display text-[10px] uppercase tracking-[0.12em] ${
              isActive
                ? 'text-accent shadow-[inset_0_2px_0_var(--color-accent)]'
                : 'text-ink/[0.48]'
            }`}
          >
            <Icon size={20} strokeWidth={1.4} aria-hidden="true" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
