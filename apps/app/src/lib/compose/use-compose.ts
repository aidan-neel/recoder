'use client';

import { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { needsReview } from '../pulls/pull-rows';
import type { PullRow } from '../pulls/types';
import { readTarget } from '../pulls/pull-target';
import { trackedPull } from '../pulls/use-open-pull';
import { useLinkFacts } from '../pulls/use-link-facts';
import { useRowEntries, useWatchList } from '../pulls/use-rows';
import { targetFacts } from './target-facts';
import type { ComposeView } from './types';

/** How many pull requests the New review screen suggests. */
const SUGGESTION_LIMIT = 6;

/** The New review screen: what the text names, the repository a number is looked up in, and starting the review. */
export function useCompose(): ComposeView {
	useWatchList();

	const client = useApi();
	const list = useListStore();
	const entries = useRowEntries();

	const data = useStore(
		list.state,
		useShallow((state) => ({
			text: state.composeText,
			chosenRepoId: state.composeRepoId,
			repos: state.repos,
			pulls: state.list,
			phase: state.phase,
			starting: state.starting,
			submitting: state.submitting
		}))
	);

	const { text, chosenRepoId, repos, pulls, starting } = data;
	const repoId = repos?.some((repo) => repo.id === chosenRepoId) ? chosenRepoId : (repos?.[0]?.id ?? null);

	const read = useMemo(
		() => readTarget(text, { repos: repos ?? [], pulls: pulls?.items ?? [], base: client.base, repoId }),
		[text, repos, pulls, client, repoId]
	);

	const known = useLinkFacts();
	const linkFacts = useMemo(() => targetFacts(read, known), [read, known]);

	const suggestions = useMemo(
		() =>
			entries
				.filter(({ listed, row }) => needsReview(listed) && !starting.has(row.key))
				.slice(0, SUGGESTION_LIMIT)
				.map(({ row }) => row),
		[entries, starting]
	);

	const repoOptions = useMemo(() => (repos ?? []).map((repo) => ({ id: repo.id, name: repo.name })), [repos]);
	const setText = useCallback((next: string) => list.state.setState({ composeText: next }), [list]);

	/** Starts a review while `submitting` shows, and resolves with its page. */
	const submitting = useCallback(
		async (run: () => Promise<string>) => {
			list.state.setState({ submitting: true });

			try {
				return await run();
			} finally {
				list.state.setState({ submitting: false });
			}
		},
		[list]
	);

	const submit = useCallback(
		() =>
			submitting(async () => {
				const pull = await trackedPull(read.target, list, client.base);

				await list.start({ repoId: pull.repoId, number: pull.number }, read.brief ?? undefined);
				list.setComposeRepo(pull.repoId);
				list.state.setState({ composeText: '' });

				return pull.href;
			}),
		[submitting, read, list, client]
	);

	const submitRow = useCallback(
		(row: PullRow) =>
			submitting(async () => {
				await list.start({ repoId: row.repoId, number: row.number, title: row.title });

				return row.href;
			}),
		[submitting, list]
	);

	return useMemo(
		() => ({
			text,
			setText,
			target: read.target,
			brief: read.brief,
			linkFacts,
			repos: repoOptions,
			repoId,
			setRepoId: list.setComposeRepo,
			suggestions,
			loading: data.phase === 'loading',
			submit,
			submitRow,
			submitting: data.submitting
		}),
		[
			text,
			setText,
			read,
			linkFacts,
			repoOptions,
			repoId,
			list,
			suggestions,
			data.phase,
			submit,
			submitRow,
			data.submitting
		]
	);
}
