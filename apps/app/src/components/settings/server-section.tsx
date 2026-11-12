'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { useSettings } from '@/lib/settings/settings-store';
import { useAction } from '@/lib/shell/use-action';

import { SectionNotice } from './section-notice';
import { SettingsSkeleton } from './settings-skeleton';

interface ServerSectionProps {
	/** The row counts of the groups the section shows, for its skeleton. */
	groups: readonly number[];
	children: ReactNode;
}

/** A section that reads the server's settings: a skeleton while they load, a notice when they do not. */
export function ServerSection({ groups, children }: ServerSectionProps) {
	const status = useSettings((state) => state.status);
	const error = useSettings((state) => state.error);
	const retry = useAction();

	useEffect(() => {
		void useSettings.getState().load();
	}, []);

	if (status === 'offline') {
		return (
			<SectionNotice
				what="Settings"
				error={error}
				retry={{ status: retry.status, run: () => retry.run(() => useSettings.getState().load(true)) }}
			/>
		);
	}

	if (status !== 'ready') return <SettingsSkeleton groups={groups} />;

	return children;
}
