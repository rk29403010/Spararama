import type { InstallationRole } from '../remote/cloud/service';

export const INSTALLATION_PERMISSIONS = [
  'spa_control',
  'heating_manage',
  'water_testing',
  'user_admin'
] as const;

export type InstallationPermission = typeof INSTALLATION_PERMISSIONS[number];

export interface InstallationAccess {
  role: InstallationRole;
  permissions: InstallationPermission[];
}

const PERMISSION_SET = new Set<string>(INSTALLATION_PERMISSIONS);

export function defaultPermissionsForRole(role: InstallationRole): InstallationPermission[] {
  if (role === 'owner') return [...INSTALLATION_PERMISSIONS];
  if (role === 'member') return ['spa_control', 'heating_manage', 'water_testing'];
  return [];
}

export function normalizePermissions(value: unknown, role: InstallationRole): InstallationPermission[] {
  if (!Array.isArray(value)) return defaultPermissionsForRole(role);
  const unique = new Set<InstallationPermission>();
  for (const item of value) {
    if (typeof item === 'string' && PERMISSION_SET.has(item)) unique.add(item as InstallationPermission);
  }
  return INSTALLATION_PERMISSIONS.filter(permission => unique.has(permission));
}

export function roleForPermissions(permissions: readonly InstallationPermission[]): InstallationRole {
  return permissions.length > 0 ? 'member' : 'viewer';
}

export function hasPermission(access: InstallationAccess, permission: InstallationPermission) {
  return access.permissions.includes(permission);
}
