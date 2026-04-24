/**
 * PermissionGate — conditional render based on user permissions.
 *
 * Three usage patterns:
 *
 * 1. Hide a button entirely when the user lacks permission:
 *    <PermissionGate permission="candidates.create">
 *      <button>+ New Candidate</button>
 *    </PermissionGate>
 *
 * 2. Disable a button (visible but grayed out, with tooltip explaining why):
 *    <PermissionGate permission="candidates.delete" mode="disable">
 *      <button>Delete</button>
 *    </PermissionGate>
 *
 * 3. Require ANY of multiple permissions:
 *    <PermissionGate anyPermission={['candidates.edit', 'candidates.create']}>
 *      ...
 *    </PermissionGate>
 *
 * Default mode is 'hide'. Use 'disable' when the UI would feel more
 * broken without the button visible (e.g. a primary action bar).
 */
import { cloneElement, isValidElement, ReactNode } from 'react';
import { usePermissions } from '../contexts/PermissionsContext';

interface Props {
  /** Single permission required. Ignored if `anyPermission` is provided. */
  permission?: string;
  /** Any-of list. User needs at least one. */
  anyPermission?: string[];
  /** All-of list. User needs every one. */
  allPermissions?: string[];
  /**
   * What to do when the user doesn't have the permission:
   *  - 'hide'    → render null (default)
   *  - 'disable' → clone the child + add disabled + tooltip
   *  - 'ghost'   → reduced opacity + not-allowed cursor but still clickable
   *    (useful for showing "this exists but ask admin" rather than gone)
   */
  mode?: 'hide' | 'disable' | 'ghost';
  /** Tooltip shown when disabled. Defaults to a generic message. */
  deniedTooltip?: string;
  /** Fallback content when permission is missing + mode is 'hide'. */
  fallback?: ReactNode;
  children: ReactNode;
}

export default function PermissionGate({
  permission,
  anyPermission,
  allPermissions,
  mode = 'hide',
  deniedTooltip = 'You don\'t have permission for this action. Contact your admin.',
  fallback = null,
  children,
}: Props) {
  const { has, hasAny, hasAll } = usePermissions();

  let allowed: boolean;
  if (anyPermission?.length) allowed = hasAny(anyPermission);
  else if (allPermissions?.length) allowed = hasAll(allPermissions);
  else if (permission) allowed = has(permission);
  else allowed = true; // No gate specified — render as-is

  if (allowed) return <>{children}</>;

  switch (mode) {
    case 'hide':
      return <>{fallback}</>;

    case 'disable':
      // Clone the first child and inject disabled + title.
      if (isValidElement(children)) {
        const childProps = children.props as any;
        return cloneElement(children, {
          disabled: true,
          title: deniedTooltip,
          'aria-disabled': true,
          style: {
            ...childProps.style,
            opacity: 0.5,
            cursor: 'not-allowed',
          },
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
          },
        } as any);
      }
      return <>{children}</>;

    case 'ghost':
      if (isValidElement(children)) {
        const childProps = children.props as any;
        return cloneElement(children, {
          title: deniedTooltip,
          style: {
            ...childProps.style,
            opacity: 0.4,
            cursor: 'not-allowed',
          },
        } as any);
      }
      return <>{children}</>;
  }
}
