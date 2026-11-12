'use client';

import type { ReactNode } from 'react';

import { ApiProvider, liveApi } from '@/lib/api/client';

import { LiveModelChip } from '@/components/settings/live-model-chip';
import { AppShell } from '@/components/shell/app-shell';

/** The live app: every page under it talks to the review server on this machine. */
export default function LiveLayout({ children }: { children: ReactNode }) {
	return (
		<ApiProvider client={liveApi}>
			<AppShell model={<LiveModelChip />}>{children}</AppShell>
		</ApiProvider>
	);
}
