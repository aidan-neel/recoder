import { findingsStore, type Finding } from '$lib/findings/findings.svelte';
import { threadsStore } from '$lib/findings/threads.svelte';

/** Focuses the finding and opens its thread. */
export function discussFinding(finding: Finding): void {
	findingsStore.discuss(finding.id);
	threadsStore.open(finding.id);
}

/** Dismisses the finding and closes its thread if it was open. */
export function dismissFinding(finding: Finding): void {
	findingsStore.dismiss(finding.id);
	if (threadsStore.openId === finding.id) threadsStore.close();
}

/** Reopens a dismissed finding and focuses it. */
export function restoreFinding(finding: Finding): void {
	findingsStore.reopen(finding.id);
	findingsStore.discuss(finding.id);
}
