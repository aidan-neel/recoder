'use client';

import type { PullListItem, Repo } from '@recoder/shared';
import type { LinkFact, LinkFacts } from '@recoder/ui/form';
import { useMemo } from 'react';
import { useStore } from 'zustand';

import { useListStore } from '../api/client';
import { repoKey } from '../connections/repo-input';

/** The key a tracked pull request and a link to it share: `host/owner/name#number`. */
function pullKey(address: string, number: number): string {
	return `${address}#${number}`;
}

/** What the list says about an open pull request: its title, and whether it is a draft. */
function factOf(item: PullListItem): LinkFact {
	return item.status.draft
		? { title: item.pull.title, status: 'Draft', tone: 'neutral' }
		: { title: item.pull.title, status: 'Open', tone: 'ok' };
}

/** The open pull requests of the tracked repositories, keyed as links name them. */
function trackedPulls(items: readonly PullListItem[], repos: readonly Repo[]): Map<string, LinkFact> {
	const addresses = new Map(repos.map((repo) => [repo.id, repoKey(repo.url)]));
	const facts = new Map<string, LinkFact>();

	for (const item of items) {
		const address = addresses.get(item.repoId);

		if (address) facts.set(pullKey(address, item.pull.number), factOf(item));
	}

	return facts;
}

/**
 * What the app already knows about a link, for its embed: a link to an open
 * pull request in a tracked repository shows its title and state. Nothing is
 * fetched; the facts come from the pull request list the app holds.
 */
export function useLinkFacts(): LinkFacts {
	const list = useListStore();
	const items = useStore(list.state, (state) => state.list?.items);
	const repos = useStore(list.state, (state) => state.repos);

	return useMemo(() => {
		const facts = trackedPulls(items ?? [], repos ?? []);

		return (link) => {
			if (link.kind !== 'pull' || link.address === null || link.number === null) return undefined;

			return facts.get(pullKey(link.address, link.number));
		};
	}, [items, repos]);
}
