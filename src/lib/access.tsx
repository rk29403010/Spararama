import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { subscribeToAuthChanges } from './firebase';
import { accessApi, type InstallationPermission, type UserAccess } from './accessApi';
import { isCloudRuntime } from './runtime';

interface AccessContextValue {
  user: User | null;
  access: UserAccess | null;
  loading: boolean;
  error: string;
  invitePending: boolean;
  can: (permission: InstallationPermission) => boolean;
  refresh: () => Promise<void>;
}

const AccessContext = createContext<AccessContextValue | null>(null);
const ALL_LOCAL_RECOVERY_PERMISSIONS: InstallationPermission[] = ['spa_control', 'heating_manage', 'water_testing'];

function inviteTokenFromLocation() {
  if (typeof window === 'undefined' || isCloudRuntime) return '';
  try { return new URL(window.location.href).searchParams.get('join') || ''; } catch { return ''; }
}

function removeInviteTokenFromLocation() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('join');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // URL cleanup is best effort; a claimed token cannot be reused server-side.
  }
}

function isDirectBrowserLoopback() {
  if (typeof window === 'undefined' || isCloudRuntime) return false;
  return window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.hostname === '[::1]';
}

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [loading, setLoading] = useState(!isCloudRuntime);
  const [error, setError] = useState('');
  const [invitePending, setInvitePending] = useState(Boolean(inviteTokenFromLocation()));

  const loadAccess = useCallback(async (currentUser: User | null) => {
    if (isCloudRuntime) {
      setAccess(null);
      setLoading(false);
      return;
    }
    if (!currentUser) {
      setAccess(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const inviteToken = inviteTokenFromLocation();
      const next = inviteToken
        ? await accessApi.claimInvite(currentUser, inviteToken)
        : await accessApi.me(currentUser);
      setAccess(next);
      if (inviteToken && next.authorized) {
        removeInviteTokenFromLocation();
        setInvitePending(false);
      }
    } catch (reason) {
      setAccess(null);
      setError(reason instanceof Error ? reason.message : 'Could not check Spararama access.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => subscribeToAuthChanges(nextUser => {
    setUser(nextUser);
    void loadAccess(nextUser);
  }), [loadAccess]);

  const refresh = useCallback(async () => loadAccess(user), [loadAccess, user]);
  const can = useCallback((permission: InstallationPermission) => {
    if (access?.authorized && access.permissions.includes(permission)) return true;
    // Direct localhost is the deliberate offline/recovery boundary already
    // trusted by the backend. It does not inherit user-administration rights.
    return isDirectBrowserLoopback() && ALL_LOCAL_RECOVERY_PERMISSIONS.includes(permission);
  }, [access]);

  const value = useMemo<AccessContextValue>(() => ({
    user,
    access,
    loading,
    error,
    invitePending,
    can,
    refresh
  }), [user, access, loading, error, invitePending, can, refresh]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess() {
  const context = useContext(AccessContext);
  if (!context) throw new Error('useAccess must be used inside AccessProvider.');
  return context;
}
