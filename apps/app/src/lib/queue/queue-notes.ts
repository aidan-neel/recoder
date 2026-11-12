import type { Provider } from '@recoder/shared';

import { forgeLabel } from '../connections/forges';
import { joinNames, listTime } from './format';
import type { MissingRepo } from './queue-fetch';

/** One quiet line under the queue's headline: what failed, why, and the way out. */
export interface QueueNote {
	key: string;
	title: string;
	detail: string | null;
	/** `retry` loads the queue again; `connections` opens Settings > Connections, where a forge token is fixed. */
	action: 'retry' | 'connections';
}

/** "GitHub", "GitLab", or the forge in general for a local repository. */
function forgeName(provider: Provider): string {
	return provider === 'local' ? 'The forge' : forgeLabel(provider);
}

/** What groups repositories into one line: a rejected token per forge, a timeout, or the same reason. */
function groupKey(repo: MissingRepo): string {
	if (repo.kind === 'auth') return `auth:${repo.provider}`;
	if (repo.kind === 'timeout') return 'timeout';

	return `failed:${repo.text}`;
}

/** The line for repositories that failed the same way. */
function missingNote(key: string, repos: MissingRepo[]): QueueNote {
	const [{ kind, provider, text }] = repos;
	const names = joinNames(repos.map((repo) => repo.name));

	if (kind === 'auth') {
		return {
			key,
			title: `${forgeName(provider)} rejected the token for ${names}.`,
			detail: null,
			action: 'connections'
		};
	}

	if (kind === 'timeout')
		return { key, title: `Pull requests from ${names} took too long to load.`, detail: null, action: 'retry' };

	return { key, title: `Couldn’t load pull requests from ${names}.`, detail: text, action: 'retry' };
}

/**
 * The line for a list that is not fresh: the refresh that failed and when the
 * list is from, or only how old it is. The time is worked out only for a line
 * that shows it: the first time format of a page load costs about 25ms at 4x
 * CPU, and a fresh list shows no line.
 */
function staleNote(error: string | null, loadedAt: number | null, stale: boolean): QueueNote[] {
	if (!error && !stale) return [];

	const from = loadedAt ? listTime(loadedAt) : null;

	if (error) {
		return [{ key: 'stale', title: error, detail: from ? `This list is from ${from}.` : null, action: 'retry' }];
	}

	if (from)
		return [{ key: 'stale', title: `This list hasn’t refreshed since ${from}.`, detail: null, action: 'retry' }];

	return [];
}

/**
 * The notes over a list that is not all fresh: the refresh that failed, with
 * when the list on screen is from, or a list that missed its refreshes
 * (`stale`), then each group of repositories whose pull requests did not
 * load. A rejected token points to Connections instead of offering a retry
 * that would fail the same way.
 */
export function queueNotes(
	error: string | null,
	loadedAt: number | null,
	missing: MissingRepo[],
	stale = false
): QueueNote[] {
	const groups = new Map<string, MissingRepo[]>();

	for (const repo of missing) groups.set(groupKey(repo), [...(groups.get(groupKey(repo)) ?? []), repo]);

	return [...staleNote(error, loadedAt, stale), ...[...groups].map(([key, repos]) => missingNote(key, repos))];
}
