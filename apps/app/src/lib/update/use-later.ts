'use client';

import { useState } from 'react';

import { readStored, writeStored } from '../shell/browser-storage';

/** Where this browser keeps the version the admin put off, so it stays quiet until a newer one appears. */
const LATER_KEY = 'recoder-update-later';

/** Whether `version` was put off in this browser, and the way to put it off or bring it back. */
export function useLater(version: string | null): { later: boolean; setLater: (later: boolean) => void } {
	const [stored, setStored] = useState(() => readStored(LATER_KEY));

	return {
		later: version !== null && stored === version,
		setLater: (later) => {
			const next = later && version ? version : '';

			writeStored(LATER_KEY, next);
			setStored(next);
		}
	};
}
