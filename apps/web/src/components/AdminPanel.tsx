import { useEffect, useMemo, useState } from 'preact/hooks';

import {
  AdminNotifyResponse,
  AdminNotifyTarget,
  AdminUser,
  fetchAdminUsers,
  sendAdminNotification,
  setUserAdmin,
} from '../api';
import { Button } from './Button';

interface AdminPanelProps {
  currentUserId: string | null;
}

export function AdminPanel({ currentUserId }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [notifyResult, setNotifyResult] = useState<AdminNotifyResponse | null>(null);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyBody, setNotifyBody] = useState('');
  const [notifyTarget, setNotifyTarget] = useState<AdminNotifyTarget>('self');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [pushStatus, setPushStatus] = useState<{
    supported: boolean;
    permission: NotificationPermission | 'unsupported';
    hasSubscription: boolean | null;
  } | null>(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const allUsers: AdminUser[] = [];
      let cursor: string | null | undefined = undefined;
      let pageCount = 0;
      do {
        const response = await fetchAdminUsers(cursor, 200);
        allUsers.push(...response.users);
        cursor = response.nextCursor;
        pageCount += 1;
        if (!response.users.length) {
          break;
        }
      } while (cursor && pageCount < 100);
      setUsers(allUsers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
    const loadPushStatus = async () => {
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        setPushStatus({ supported: false, permission: 'unsupported', hasSubscription: null });
        return;
      }
      const permission = Notification.permission;
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setPushStatus({
          supported: true,
          permission,
          hasSubscription: Boolean(subscription),
        });
      } catch {
        setPushStatus({ supported: true, permission, hasSubscription: null });
      }
    };
    void loadPushStatus();
  }, []);

  const handleToggleAdmin = async (
    userId: string,
    currentIsAdmin: boolean,
    displayName: string
  ) => {
    const actionLabel = currentIsAdmin ? 'remove admin access for' : 'make admin';
    const shouldProceed = window.confirm(`Are you sure you want to ${actionLabel} ${displayName}?`);
    if (!shouldProceed) {
      return;
    }
    setTogglingId(userId);
    try {
      await setUserAdmin(userId, !currentIsAdmin);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isAdmin: !currentIsAdmin } : u))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update admin status');
    } finally {
      setTogglingId(null);
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatProviderLabel = (provider: string) => {
    if (provider === 'password') return 'Password';
    if (provider === 'google') return 'Google';
    return provider;
  };

  const getAuthSummary = (user: AdminUser) => {
    if (!user.authProviders || user.authProviders.length === 0) {
      return 'Auth: none';
    }
    const parts = [...user.authProviders]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(
        (provider) =>
          `${formatProviderLabel(provider.provider)} (${formatDate(provider.createdAt)})`
      );
    return `Auth: ${parts.join(' | ')}`;
  };

  const getDisplayName = (user: AdminUser) => {
    if (user.email) return user.email;
    if (user.username) return user.username;
    return user.id.slice(0, 8) + '...';
  };

  const userDisplayNames = useMemo(() => {
    return new Map(users.map((user) => [user.id, getDisplayName(user)]));
  }, [users]);

  const selectedUserSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const notifySummary = useMemo(() => {
    if (!notifyResult) return null;
    const total = notifyResult.results.length;
    const okCount = notifyResult.results.filter((result) => result.ok).length;
    return { total, okCount, failed: total - okCount };
  }, [notifyResult]);

  const isSendDisabled =
    notifyLoading ||
    !notifyTitle.trim() ||
    (notifyTarget === 'custom' && selectedUserIds.length === 0);

  const handleSendNotification = async () => {
    const trimmedTitle = notifyTitle.trim();
    const trimmedBody = notifyBody.trim();
    if (!trimmedTitle) {
      setNotifyError('Add a title before sending.');
      return;
    }
    if (notifyTarget === 'custom' && selectedUserIds.length === 0) {
      setNotifyError('Select at least one user for the custom target.');
      return;
    }

    setNotifyLoading(true);
    setNotifyError(null);
    setNotifyResult(null);
    try {
      const response = await sendAdminNotification({
        title: trimmedTitle,
        body: trimmedBody ? trimmedBody : undefined,
        target: notifyTarget,
        userIds: notifyTarget === 'custom' ? selectedUserIds : undefined,
      });
      setNotifyResult(response);
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : 'Failed to send notification.');
    } finally {
      setNotifyLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-muted">
        <p>Loading users...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-red-600">{error}</p>
        <Button className="mt-2" variant="secondary" size="sm" onClick={loadUsers}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[rgba(30,27,22,0.12)] bg-[rgba(255,252,247,0.7)] p-4">
        <div>
          <h4 className="text-sm font-semibold">Admin notifications</h4>
          <p className="mt-1 text-xs text-muted">
            Send an immediate push to selected users or segments.
          </p>
        </div>
        <div className="mt-3 grid gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Title
            <input
              type="text"
              className="rounded-xl border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm font-normal focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              value={notifyTitle}
              onInput={(event) => setNotifyTitle(event.currentTarget.value)}
              placeholder="Today’s reminder"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Body (optional)
            <textarea
              className="min-h-[88px] rounded-xl border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm font-normal focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              value={notifyBody}
              onInput={(event) => setNotifyBody(event.currentTarget.value)}
              placeholder="Tap to open Lexi."
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">
            Target
            <select
              className="rounded-xl border border-[rgba(30,27,22,0.12)] bg-white px-3 py-2 text-sm font-normal focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              value={notifyTarget}
              onChange={(event) => setNotifyTarget(event.currentTarget.value as AdminNotifyTarget)}
            >
              <option value="self">Just me (test)</option>
              <option value="custom">Selected users</option>
              <option value="all">All users</option>
              <option value="admins">Admins</option>
              <option value="enabled">Notifications enabled</option>
            </select>
          </label>
          {notifyTarget === 'custom' ? (
            <p className="text-xs text-muted">
              Selected users: {selectedUserIds.length}. Use the checkboxes below to choose
              recipients.
            </p>
          ) : null}
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSendNotification}
              disabled={isSendDisabled}
            >
              {notifyLoading ? 'Sending…' : 'Send now'}
            </Button>
          </div>
        </div>
        {pushStatus ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className="rounded-full bg-surface px-2 py-1">
              Permission:{' '}
              {pushStatus.permission === 'unsupported' ? 'Unsupported' : pushStatus.permission}
            </span>
            <span className="rounded-full bg-surface px-2 py-1">
              Subscription:{' '}
              {pushStatus.hasSubscription == null
                ? 'Unknown'
                : pushStatus.hasSubscription
                  ? 'Present'
                  : 'Missing'}
            </span>
          </div>
        ) : null}
        {pushStatus && pushStatus.supported && pushStatus.hasSubscription === false ? (
          <p className="mt-2 text-xs text-muted">
            No subscription found on this device. Enable notifications in Settings and try again.
          </p>
        ) : null}
        {notifyError ? <p className="mt-3 text-sm text-[#8f2d2d]">{notifyError}</p> : null}
        {notifyResult ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className={notifyResult.ok ? 'text-accent-strong' : 'text-[#8f2d2d]'}>
              {notifySummary?.okCount ?? 0}/{notifySummary?.total ?? 0} notifications delivered.
            </p>
            {notifyResult.target ? (
              <p className="text-xs text-muted">
                Target: {notifyResult.target.mode} · {notifyResult.target.userCount} users ·{' '}
                {notifyResult.target.subscriptionCount} subscriptions
              </p>
            ) : null}
            {notifyResult.missingUserIds && notifyResult.missingUserIds.length > 0 ? (
              <p className="text-xs text-muted">
                No subscriptions for:{' '}
                {notifyResult.missingUserIds
                  .map((id) => userDisplayNames.get(id) ?? id.slice(0, 8) + '...')
                  .join(', ')}
              </p>
            ) : null}
            <div className="space-y-2">
              {notifyResult.results.map((result, index) => (
                <div
                  key={`${result.endpointDomain}-${index}`}
                  className="rounded-lg border border-[rgba(30,27,22,0.08)] bg-surface px-3 py-2 text-xs text-muted"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {userDisplayNames.get(result.userId) ?? result.userId.slice(0, 8) + '...'}
                    </span>
                    <span className={result.ok ? 'text-accent-strong' : 'text-[#8f2d2d]'}>
                      {result.status ? `HTTP ${result.status}` : 'Error'}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{result.endpointDomain}</p>
                  {result.error ? <p className="mt-1 text-[#8f2d2d]">{result.error}</p> : null}
                  {result.body ? <p className="mt-1">{result.body}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">User Management</h3>
        <Button variant="ghost" size="sm" onClick={loadUsers}>
          Refresh
        </Button>
      </div>

      {users.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted">Registered Users</h4>
          <ul className="space-y-2">
            {users.map((user) => (
              <li
                key={user.id}
                className="flex items-center justify-between rounded-lg border border-[rgba(30,27,22,0.08)] bg-surface p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-3">
                    {notifyTarget === 'custom' ? (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border border-[rgba(30,27,22,0.2)] text-accent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                        checked={selectedUserSet.has(user.id)}
                        onChange={() => toggleUserSelection(user.id)}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{getDisplayName(user)}</p>
                      <p className="text-xs text-muted">Joined {formatDate(user.createdAt)}</p>
                      <p className="text-xs text-muted">{getAuthSummary(user)}</p>
                    </div>
                  </div>
                </div>
                <div className="ml-3 flex items-center gap-2">
                  {user.isAdmin && (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent-strong">
                      Admin
                    </span>
                  )}
                  <Button
                    variant={user.isAdmin ? 'outline' : 'secondary'}
                    size="sm"
                    disabled={togglingId === user.id || user.id === currentUserId}
                    onClick={() => handleToggleAdmin(user.id, user.isAdmin, getDisplayName(user))}
                  >
                    {togglingId === user.id
                      ? '...'
                      : user.id === currentUserId
                        ? 'You'
                        : user.isAdmin
                          ? 'Remove'
                          : 'Make Admin'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {users.length === 0 && <p className="text-muted">No users found.</p>}
    </div>
  );
}
