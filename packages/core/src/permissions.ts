// RBAC: permissions are `resource.action` strings. Roles bundle permissions.
// RLS handles *data* isolation; these gate *actions/features*.

export const PERMISSIONS = [
  'dashboard.view',
  'lead.view', 'lead.create', 'lead.edit', 'lead.delete',
  'lead_inbox.view', 'lead_inbox.manage', 'lead_channel.manage',
  'customer.view', 'customer.create', 'customer.edit', 'customer.delete',
  'quotation.view', 'quotation.create', 'quotation.edit',
  'order.view', 'order.create', 'order.edit',
  'invoice.view', 'invoice.create', 'invoice.edit',
  'settings.manage', 'user.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'owner', 'sales', 'production', 'operator', 'store', 'accounts', 'hr', 'viewer',
] as const;
export type RoleName = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<RoleName, Permission[] | '*'> = {
  owner: '*',
  sales: [
    'dashboard.view',
    'lead.view', 'lead.create', 'lead.edit', 'lead.delete',
    'lead_inbox.view', 'lead_inbox.manage',
    'customer.view', 'customer.create', 'customer.edit',
    'quotation.view', 'quotation.create', 'quotation.edit',
    'order.view', 'order.create',
    'invoice.view',
  ],
  production: ['dashboard.view', 'customer.view', 'order.view'],
  operator: [],
  store: ['dashboard.view', 'customer.view', 'order.view'],
  accounts: [
    'dashboard.view', 'customer.view',
    'quotation.view', 'order.view',
    'invoice.view', 'invoice.create', 'invoice.edit',
  ],
  hr: ['dashboard.view'],
  viewer: ['dashboard.view', 'lead.view', 'customer.view', 'quotation.view', 'order.view', 'invoice.view'],
};

export function expandPermissions(perms: Permission[] | '*'): Permission[] {
  return perms === '*' ? [...PERMISSIONS] : perms;
}
