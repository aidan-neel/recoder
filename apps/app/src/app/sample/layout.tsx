'use client';

import type { ReactNode } from 'react';

import { ApiProvider } from '@/lib/api/client';
import { sampleApi } from '@/lib/sample/sample-api';

import { AppShell } from '@/components/shell/app-shell';
import { ModelChip } from '@/components/shell/model-chip';

/** The sample: the same screens answered from memory, so they work with no review server and nothing connected. */
export default function SampleLayout({ children }: { children: ReactNode }) {
	return (
		<ApiProvider client={sampleApi}>
			<AppShell model={<ModelChip label="Sample model" state="ready" />}>{children}</AppShell>
		</ApiProvider>
	);
}
