import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Mail, QrCode as QrCodeIcon, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { accessApi, type InstallationPermission, type ManagedUser } from '../lib/accessApi';
import { useAccess } from '../lib/access';
import { qrSvgPath } from '../lib/qrCode';

const PERMISSION_OPTIONS: Array<{ id: InstallationPermission; label: string; detail: string }> = [
  { id: 'spa_control', label: 'Operate spa', detail: 'Heater, filter, bubbles and target temperature' },
  { id: 'heating_manage', label: 'Heating plans', detail: 'Create, change and cancel ready-by events' },
  { id: 'water_testing', label: 'Water care', detail: 'Testing, dosing, bathing and manual logs' },
  { id: 'user_admin', label: 'Manage users', detail: 'Invite, change and remove other users' }
];

const DEFAULT_INVITE_PERMISSIONS: InstallationPermission[] = ['spa_control', 'heating_manage', 'water_testing'];

function permissionLabel(permission: InstallationPermission) {
  return PERMISSION_OPTIONS.find(option => option.id === permission)?.label || permission;
}

function PermissionChecks({
  value,
  onChange,
  disabled = false
}: {
  value: InstallationPermission[];
  onChange: (permissions: InstallationPermission[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {PERMISSION_OPTIONS.map(option => (
        <label key={option.id} className="min-h-12 flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(option.id)}
            disabled={disabled}
            onChange={event => onChange(event.target.checked
              ? [...value, option.id]
              : value.filter(permission => permission !== option.id))}
            className="mt-0.5 w-5 h-5 accent-indigo-700 shrink-0"
          />
          <span className="min-w-0">
            <span className="block font-black text-slate-900">{option.label}</span>
            <span className="block text-sm font-bold text-slate-600">{option.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function UserRow({
  user,
  currentUid,
  onSaved,
  onRemoved
}: {
  user: ManagedUser;
  currentUid: string;
  onSaved: () => Promise<void>;
  onRemoved: () => Promise<void>;
}) {
  const { user: signedInUser } = useAccess();
  const [permissions, setPermissions] = useState(user.permissions);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isSelf = user.uid === currentUid;

  useEffect(() => setPermissions(user.permissions), [user.permissions]);

  const save = async () => {
    if (!signedInUser) return;
    setBusy(true);
    setError('');
    try {
      await accessApi.updateUser(signedInUser, user.uid, permissions);
      setEditing(false);
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update user.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!signedInUser || isSelf) return;
    setBusy(true);
    setError('');
    try {
      await accessApi.removeUser(signedInUser, user.uid);
      await onRemoved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove user.');
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-slate-950 truncate">{user.displayName || user.email || user.invitedEmail || 'Spararama user'}{isSelf ? ' (you)' : ''}</p>
          {user.email && <p className="text-sm font-bold text-slate-600 break-all">Google: {user.email}</p>}
          {user.invitedEmail && user.invitedEmail !== user.email && <p className="text-sm font-bold text-slate-500 break-all">Invited as: {user.invitedEmail}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{user.role}</span>
      </div>

      {!editing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {user.permissions.length > 0
            ? user.permissions.map(permission => <span key={permission} className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-900">{permissionLabel(permission)}</span>)
            : <span className="text-sm font-bold text-slate-500">View only</span>}
        </div>
      ) : <div className="mt-4"><PermissionChecks value={permissions} onChange={setPermissions} disabled={busy} /></div>}

      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {editing ? <>
          <button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 rounded-xl bg-indigo-700 px-4 font-black text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" disabled={busy} onClick={() => { setPermissions(user.permissions); setEditing(false); }} className="min-h-11 rounded-xl bg-slate-100 px-4 font-black text-slate-800">Cancel</button>
        </> : <button type="button" onClick={() => setEditing(true)} className="min-h-11 rounded-xl bg-slate-100 px-4 font-black text-slate-800">Permissions</button>}
        {!isSelf && <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 rounded-xl px-3 font-black text-rose-800 hover:bg-rose-50 flex items-center gap-2"><Trash2 className="w-4 h-4" aria-hidden="true" />Remove</button>}
      </div>
    </div>
  );
}

export function UserManagement() {
  const { user, access, can, refresh: refreshAccess } = useAccess();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [invites, setInvites] = useState<Array<{ id: string; email: string; permissions: InstallationPermission[]; expiresAt: number }>>([]);
  const [email, setEmail] = useState('');
  const [permissions, setPermissions] = useState<InstallationPermission[]>(DEFAULT_INVITE_PERMISSIONS);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = can('user_admin') && Boolean(user && access?.authorized);
  const currentUid = access?.uid || '';
  const inviteQr = useMemo(() => inviteLink ? qrSvgPath(inviteLink) : null, [inviteLink]);

  const load = async () => {
    if (!user || !isAdmin) return;
    setLoading(true);
    setError('');
    try {
      const snapshot = await accessApi.listUsers(user);
      setUsers(snapshot.users);
      setInvites(snapshot.invites);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [user?.uid, isAdmin]);

  const createInvite = async () => {
    if (!user) return;
    setBusy(true);
    setError('');
    setInviteLink('');
    try {
      const invite = await accessApi.createInvite(user, email, permissions);
      const url = new URL('/', window.location.origin);
      url.searchParams.set('join', invite.token);
      setInviteLink(url.toString());
      setInviteEmail(invite.email);
      setEmail('');
      setPermissions(DEFAULT_INVITE_PERMISSIONS);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create invite.');
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
  };

  const emailInvite = () => {
    if (!inviteLink || !inviteEmail) return;
    const subject = encodeURIComponent('Join our Spararama');
    const body = encodeURIComponent(`Use this link to join our Spararama. You can sign in with your own Google account:\n\n${inviteLink}\n\nThe link is single-use and expires after 7 days.`);
    window.location.href = `mailto:${encodeURIComponent(inviteEmail)}?subject=${subject}&body=${body}`;
  };

  const revoke = async (id: string) => {
    if (!user) return;
    setError('');
    try {
      await accessApi.revokeInvite(user, id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke invite.');
    }
  };

  const currentAccessText = useMemo(() => access?.permissions.includes('user_admin') ? 'Admin' : 'User', [access]);

  if (!isAdmin) return null;

  return (
    <section className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-200 space-y-5">
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-900 flex items-center justify-center"><ShieldCheck className="w-6 h-6" aria-hidden="true" /></span>
        <div>
          <h3 className="text-xl font-black text-slate-950">Users</h3>
          <p className="text-sm font-bold text-slate-600">{currentAccessText} · invite people and choose what they can do</p>
        </div>
      </div>

      <div className="rounded-2xl bg-slate-50 p-4">
        <label className="block font-black text-slate-900" htmlFor="invite-email">Invite by email</label>
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <input id="invite-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" className="min-h-12 flex-1 rounded-xl border border-slate-300 bg-white px-4 font-bold text-slate-950" />
          <button type="button" disabled={busy || !email.trim()} onClick={() => void createInvite()} className="min-h-12 rounded-xl bg-indigo-700 px-5 font-black text-white disabled:opacity-50 flex items-center justify-center gap-2"><UserPlus className="w-5 h-5" aria-hidden="true" />{busy ? 'Creating…' : 'Create invite'}</button>
        </div>
        <div className="mt-4"><PermissionChecks value={permissions} onChange={setPermissions} disabled={busy} /></div>
      </div>

      {inviteLink && <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
        <p className="font-black text-emerald-950">Invite ready for {inviteEmail}</p>
        <p className="mt-1 text-sm font-bold text-emerald-900">The email address is only where you send the invite. They can sign in with a different Google/Gmail address.</p>
        {inviteQr && <div className="mt-4 flex flex-col sm:flex-row items-center sm:items-start gap-4">
          <div className="rounded-2xl bg-white p-3 border border-emerald-200 shadow-sm">
            <svg
              role="img"
              aria-label={`QR code invitation for ${inviteEmail}`}
              viewBox={`${-4} ${-4} ${inviteQr.size + 8} ${inviteQr.size + 8}`}
              className="w-56 h-56 max-w-full"
              shapeRendering="crispEdges"
            >
              <rect x={-4} y={-4} width={inviteQr.size + 8} height={inviteQr.size + 8} fill="white" />
              <path d={inviteQr.path} fill="black" />
            </svg>
          </div>
          <div className="min-w-0 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2 font-black text-emerald-950"><QrCodeIcon className="w-5 h-5" aria-hidden="true" />Scan to join</div>
            <p className="mt-1 text-sm font-bold text-emerald-900">Open the camera on the other phone and scan this code. It contains the same single-use invite link and is generated locally in Spararama.</p>
          </div>
        </div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => void copyInvite()} className="min-h-11 rounded-xl bg-white px-4 font-black text-emerald-950 border border-emerald-200 flex items-center gap-2"><Copy className="w-4 h-4" aria-hidden="true" />Copy link</button>
          <button type="button" onClick={emailInvite} className="min-h-11 rounded-xl bg-emerald-800 px-4 font-black text-white flex items-center gap-2"><Mail className="w-4 h-4" aria-hidden="true" />Email invite</button>
        </div>
      </div>}

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-900">{error}</p>}

      <div>
        <h4 className="font-black text-slate-950">People</h4>
        <div className="mt-3 space-y-3">
          {loading ? <p className="font-bold text-slate-600">Loading users…</p> : users.length > 0
            ? users.map(item => <UserRow key={item.uid} user={item} currentUid={currentUid} onSaved={async () => { await load(); await refreshAccess(); }} onRemoved={load} />)
            : <p className="font-bold text-slate-600">No stored members yet. Bootstrap administrators configured on the server are not stored here.</p>}
        </div>
      </div>

      {invites.length > 0 && <div>
        <h4 className="font-black text-slate-950">Pending invites</h4>
        <div className="mt-3 space-y-2">
          {invites.map(invite => <div key={invite.id} className="min-h-12 rounded-xl bg-slate-50 px-3 py-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-black text-slate-900 truncate">{invite.email}</p>
              <p className="text-xs font-bold text-slate-500">Expires {new Date(invite.expiresAt).toLocaleDateString()} · {invite.permissions.length ? invite.permissions.map(permissionLabel).join(', ') : 'view only'}</p>
            </div>
            <button type="button" aria-label={`Revoke invite for ${invite.email}`} onClick={() => void revoke(invite.id)} className="w-11 h-11 shrink-0 rounded-xl text-rose-800 hover:bg-rose-50 flex items-center justify-center"><Trash2 className="w-5 h-5" aria-hidden="true" /></button>
          </div>)}
        </div>
      </div>}
    </section>
  );
}
