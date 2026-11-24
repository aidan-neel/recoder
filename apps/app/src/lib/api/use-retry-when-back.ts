import { useEffect } from 'react';

import { onServerBack } from './reachability';

/**
 * Runs `retry` once the review server answers again after going quiet, so a screen that failed while it was down
 * loads by itself. Pass null while nothing failed.
 */
export function useRetryWhenBack(retry: (() => void) | null): void {
	useEffect(() => (retry ? onServerBack(retry) : undefined), [retry]);
}
