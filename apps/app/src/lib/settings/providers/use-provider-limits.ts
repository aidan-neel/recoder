'use client';

import type { ProviderLimits } from '@recoder/shared';
import { useEffect, useState } from 'react';

import { failureText } from '../../api/http';
import { settingsApi } from '../../api/settings';

/** A provider's limits as the detail panel shows them: still loading, or what the server said. */
export type LimitsView = { status: 'loading' } | ProviderLimits;

/**
 * Reads the usage limits of the provider `key` names, again whenever the key
 * changes. A request for a key no longer shown is dropped, so a quick switch
 * between providers never shows the last one's limits. A failed read shows as
 * the `error` state, with the plain reason.
 */
export function useProviderLimits(key: string): LimitsView {
	const [read, setRead] = useState<{ key: string; limits: ProviderLimits } | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		settingsApi.limits(key, controller.signal).then(
			(limits) => setRead({ key, limits }),
			(error: unknown) => {
				if (controller.signal.aborted) return;

				setRead({ key, limits: { status: 'error', reason: failureText(error, 'Couldn’t read the limits.') } });
			}
		);

		return () => controller.abort();
	}, [key]);

	return read?.key === key ? read.limits : { status: 'loading' };
}
