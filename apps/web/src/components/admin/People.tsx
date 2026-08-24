import { AdminUser, setUserAdmin } from '../../api';
import { displayName, formatRelativeDay, isDormant, signInMethod } from './format';
import { DIVIDER, ErrorLine, LoadingLine } from './primitives';

interface PeopleProps {
  users: AdminUser[];
  loading: boolean;
  error: string | null;
  currentUserId: string | null;
  onChanged: () => void;
}

/** Dormant readers' last-read dates render in accent-strong. */
export function People({ users, loading, error, currentUserId, onChanged }: PeopleProps) {
  const handleToggleAdmin = async (user: AdminUser) => {
    const name = displayName(user);
    const action = user.isAdmin ? `remove admin access for ${name}` : `make ${name} an admin`;
    if (!window.confirm(`Are you sure you want to ${action}?`)) {
      return;
    }
    try {
      await setUserAdmin(user.id, !user.isAdmin);
      onChanged();
    } catch {
      // The list reloads either way; a failed toggle simply leaves it as it was.
      onChanged();
    }
  };

  if (error) {
    return <ErrorLine message={error} onRetry={onChanged} />;
  }
  if (loading && users.length === 0) {
    return <LoadingLine>Loading people.</LoadingLine>;
  }
  if (users.length === 0) {
    return <p className="py-6 text-[15px] text-ink/[0.66]">Nobody has signed up yet.</p>;
  }

  return (
    <>
      {/* Desktop: a table. Phone: list rows with the role right-aligned. */}
      <table className="hidden w-full border-collapse pt-4 text-[14px] lg:table">
        <thead>
          <tr>
            <th
              className={`border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
            >
              Person
            </th>
            <th
              className={`w-[116px] border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
            >
              Signs in with
            </th>
            <th
              className={`w-[104px] border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
            >
              Last read
            </th>
            <th
              className={`w-[86px] border-b ${DIVIDER} px-2 py-2 text-left text-[11px] uppercase tracking-[0.08em] text-ink/[0.6]`}
            >
              Role
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="hover:bg-ink/[0.04]">
              <td className={`border-b ${DIVIDER} px-2 py-2`}>{displayName(user)}</td>
              <td className={`border-b ${DIVIDER} px-2 py-2`}>{signInMethod(user)}</td>
              <td
                className={`tabular border-b ${DIVIDER} px-2 py-2 ${
                  isDormant(user) ? 'text-accent-strong' : ''
                }`}
              >
                {formatRelativeDay(user.lastReadAt)}
              </td>
              <td className={`border-b ${DIVIDER} px-2 py-2`}>
                <button
                  type="button"
                  onClick={() => handleToggleAdmin(user)}
                  disabled={user.id === currentUserId}
                  title={
                    user.id === currentUserId
                      ? 'You cannot change your own role'
                      : user.isAdmin
                        ? 'Remove admin access'
                        : 'Make admin'
                  }
                  className={`cursor-pointer text-[12px] disabled:cursor-default ${
                    user.isAdmin ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {user.isAdmin ? 'Admin' : 'Reader'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pt-4 lg:hidden">
        {users.map((user) => (
          <div
            key={user.id}
            className={`flex items-center gap-3 border-b py-3.5 ${DIVIDER} last:border-b-0`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px]">{displayName(user)}</div>
              <div
                className={`text-[12px] ${isDormant(user) ? 'text-accent-strong' : 'text-ink/[0.55]'}`}
              >
                {signInMethod(user)} ·{' '}
                {isDormant(user)
                  ? `last read ${formatRelativeDay(user.lastReadAt).toLowerCase()}`
                  : `read ${formatRelativeDay(user.lastReadAt).toLowerCase()}`}
              </div>
            </div>
            {/* The role is actionable here too — an admin on a phone can still
                promote and demote. */}
            <button
              type="button"
              onClick={() => handleToggleAdmin(user)}
              disabled={user.id === currentUserId}
              title={
                user.id === currentUserId
                  ? 'You cannot change your own role'
                  : user.isAdmin
                    ? 'Remove admin access'
                    : 'Make admin'
              }
              className={`flex min-h-[44px] flex-none cursor-pointer items-center px-1 text-[12px] uppercase tracking-[0.1em] disabled:cursor-default ${
                user.isAdmin ? 'text-accent' : 'text-ink/[0.55]'
              }`}
            >
              {user.isAdmin ? 'Admin' : 'Reader'}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
