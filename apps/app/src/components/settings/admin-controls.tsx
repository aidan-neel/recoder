'use client';

import type { ReactNode } from 'react';

import { useIsAdmin } from '@/lib/account/use-is-admin';

/**
 * Settings the server only lets the admin change. A member sees them as they
 * are, read-only under one quiet line: the fieldset turns off every control
 * inside it, so no control needs to know who is looking.
 */
export function AdminControls({ children }: { children: ReactNode }) {
	if (useIsAdmin()) return children;

	return (
		<fieldset disabled className="admin-controls">
			<p className="settings-group-note">Only the admin can change this.</p>
			{children}
		</fieldset>
	);
}
