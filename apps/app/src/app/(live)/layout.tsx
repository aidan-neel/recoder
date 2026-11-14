'use client';

import type { ReactNode } from 'react';

import { ApiProvider, liveApi } from '@/lib/api/client';

import { AccountGate } from '@/components/account/account-gate';
import { LiveModelChip } from '@/components/settings/live-model-chip';
import { AppShell } from '@/components/shell/app-shell';

/**
 * The live app: every page under it talks to the review server on this
 * machine. The account gate is outside the client provider, so signing in
 * again starts the pages from a clean list.
 */
export default function LiveLayout({ children }: { children: ReactNode }) {
	return (
		<AccountGate api={liveApi.auth}>
			<ApiProvider client={liveApi}>
				<AppShell model={<LiveModelChip />}>{children}</AppShell>
			</ApiProvider>
		</AccountGate>
	);
}
