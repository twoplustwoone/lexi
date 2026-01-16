import { useEffect, useState } from 'preact/hooks';

import { AdminUser, fetchAdminUsers, setUserAdmin } from '../api';
import { Button } from './Button';

interface AdminPanelProps {
  currentUserId: string | null;
}

export function AdminPanel({ currentUserId }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchAdminUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleToggleAdmin = async (userId: string, currentIsAdmin: boolean) => {
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

  const getDisplayName = (user: AdminUser) => {
    if (user.email) return user.email;
    if (user.username) return user.username;
    return user.id.slice(0, 8) + '...';
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

  const nonAnonymousUsers = users.filter((u) => !u.isAnonymous);
  const anonymousUsers = users.filter((u) => u.isAnonymous);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">User Management</h3>
        <Button variant="ghost" size="sm" onClick={loadUsers}>
          Refresh
        </Button>
      </div>

      {nonAnonymousUsers.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted">Registered Users</h4>
          <ul className="space-y-2">
            {nonAnonymousUsers.map((user) => (
              <li
                key={user.id}
                className="flex items-center justify-between rounded-lg border border-[rgba(30,27,22,0.08)] bg-surface p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{getDisplayName(user)}</p>
                  <p className="text-xs text-muted">Joined {formatDate(user.createdAt)}</p>
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
                    onClick={() => handleToggleAdmin(user.id, user.isAdmin)}
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

      {anonymousUsers.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-muted">
            Anonymous Users ({anonymousUsers.length})
          </h4>
          <p className="text-xs text-muted">
            Anonymous users cannot be made admins. They need to sign in first.
          </p>
        </div>
      )}

      {users.length === 0 && <p className="text-muted">No users found.</p>}
    </div>
  );
}
