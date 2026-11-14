'use client';

import { MAX_CHAT_MESSAGE_CHARS, type ImageUpload } from '@recoder/shared';
import { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { useApi, useListStore } from '../api/client';
import { needsReview } from '../pulls/pull-rows';
import type { TargetContext } from '../pulls/pull-target';
import { trackedPull } from '../pulls/use-open-pull';
import { useLinkFacts } from '../pulls/use-link-facts';
import { useRowEntries, useWatchList } from '../pulls/use-rows';
import { chatHref } from '../shell/routes';
import { useComposeMode, type ComposeMode } from './compose-mode';
import { CHAT_NEEDS_REPO, REVIEW_NEEDS_PULL, takePull } from './compose-target';
import type { ComposeView } from './types';
import { usePullPick } from './use-pull-pick';

/** How many pull requests the New review screen suggests. */
const SUGGESTION_LIMIT = 6;

/** The most characters one edit can add and still be typing; more is a paste, which brings a whole reference at once. */
const TYPED_CHARS = 1;

/**
 * The New screen: the pull request chosen, the brief or message written, the
 * repository the picker searches or a chat is about, and starting the review
 * or the chat.
 */
export function useCompose(): ComposeView {
	useWatchList();

	const { mode, setMode } = useComposeMode();
	const client = useApi();
	const list = useListStore();
	const entries = useRowEntries();
	const picking = usePullPick(entries);
	const { pick, refusal } = picking;

	const data = useStore(
		list.state,
		useShallow((state) => ({
			text: state.composeText,
			chosenRepoId: state.composeRepoId,
			repos: state.repos,
			pulls: state.list,
			phase: state.phase,
			starting: state.starting
		}))
	);

	const { text, chosenRepoId, repos, pulls, starting } = data;
	const repoId = repos?.some((repo) => repo.id === chosenRepoId) ? chosenRepoId : (repos?.[0]?.id ?? null);

	const context = useMemo<TargetContext>(
		() => ({ repos: repos ?? [], pulls: pulls?.items ?? [], base: client.base, repoId }),
		[repos, pulls, client, repoId]
	);

	const overBy = mode === 'chat' ? text.length - MAX_CHAT_MESSAGE_CHARS : 0;
	const ready = mode === 'chat' ? text.trim() !== '' && repoId !== null && overBy <= 0 : pick !== null;
	const hasTypedPull = mode === 'review' && takePull(text, context, true) !== null;
	const linkFacts = useLinkFacts();

	const suggestions = useMemo(
		() =>
			entries
				.filter(({ listed, row }) => needsReview(listed) && !starting.has(row.key))
				.slice(0, SUGGESTION_LIMIT)
				.map(({ row }) => row),
		[entries, starting]
	);

	const repoPulls = useMemo(
		() => entries.filter(({ row }) => row.repoId === repoId).map(({ row }) => row),
		[entries, repoId]
	);

	const repoOptions = useMemo(
		() => (repos ?? []).map((repo) => ({ id: repo.id, name: repo.name, provider: repo.provider })),
		[repos]
	);

	const setText = useCallback(
		(next: string) => {
			const pasted = next.length - list.state.getState().composeText.length > TYPED_CHARS;
			const taken = mode === 'review' ? takePull(next, context, pasted) : null;

			picking.clearRefusal();
			list.state.setState({ composeText: taken ? taken.text : next });

			if (taken) picking.take(taken);
		},
		[mode, context, list, picking]
	);

	const settle = useCallback(() => {
		const taken = takePull(text, context, true);

		if (!taken) return;

		list.state.setState({ composeText: taken.text });
		picking.take(taken);
	}, [text, context, list, picking]);

	const clear = useCallback(() => {
		list.state.setState({ composeText: '' });
		picking.release();
	}, [list, picking]);

	const chooseMode = useCallback(
		(next: ComposeMode) => {
			picking.clearRefusal();
			setMode(next);
		},
		[picking, setMode]
	);

	const setRepoId = useCallback(
		(next: string) => {
			list.setComposeRepo(next);

			if (pick?.target.kind === 'pull' && pick.target.repoId !== next) picking.release();
		},
		[list, pick, picking]
	);

	const startReview = useCallback(
		async (images: ImageUpload[]) => {
			if (!pick) throw new Error(REVIEW_NEEDS_PULL);

			const pull = await trackedPull(pick.target, list, client.base);
			const instructions = text.trim();

			await list.start(
				{ repoId: pull.repoId, number: pull.number, ...(pick.title && { title: pick.title }) },
				{ instructions: instructions || undefined, images }
			);

			list.setComposeRepo(pull.repoId);

			return pull.href;
		},
		[pick, list, client, text]
	);

	const startChat = useCallback(
		async (images: ImageUpload[]) => {
			if (!repoId) throw new Error(CHAT_NEEDS_REPO);

			const { id } = await client.startRepoChat({ repoId, text: text.trim(), ...(images.length && { images }) });

			list.setComposeRepo(repoId);
			list.reload();

			return chatHref(client.base, id);
		},
		[repoId, client, text, list]
	);

	const submit = useCallback(
		(images: ImageUpload[]) => (mode === 'chat' ? startChat(images) : startReview(images)),
		[mode, startChat, startReview]
	);

	return useMemo(
		() => ({
			mode,
			setMode: chooseMode,
			text,
			setText,
			clear,
			pick,
			choose: picking.choose,
			pulls: repoPulls,
			refusal,
			hasTypedPull,
			settle,
			linkFacts,
			repos: repoOptions,
			repoId,
			setRepoId,
			reload: list.reload,
			suggestions,
			loading: data.phase === 'loading',
			overBy,
			ready,
			submit
		}),
		[
			mode,
			chooseMode,
			text,
			setText,
			clear,
			pick,
			picking.choose,
			repoPulls,
			refusal,
			hasTypedPull,
			settle,
			linkFacts,
			repoOptions,
			repoId,
			setRepoId,
			list,
			suggestions,
			data.phase,
			overBy,
			ready,
			submit
		]
	);
}
