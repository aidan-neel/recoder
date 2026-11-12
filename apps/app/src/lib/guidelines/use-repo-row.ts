'use client';

import type { GuidelinesOverview, RepoGuidelines } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';

import { useAction } from '../shell/use-action';
import { editLayer, useGuidelinesEditor, type ScopeKey } from './editor-store';
import { useGuidelines } from './guidelines-store';
import { repoSummary, seedText } from './rules';
import type { GuidelinesEditorSpec } from './use-editor';

type TrackedRepo = GuidelinesOverview['repos'][number];

/** What a repository row shows once its file could not be read: the reason and a retry. */
export interface RepoRowError {
	kind: 'error';
	name: string;
	/** The read's reason, under the name. */
	summary: string;
	retry: { status: ButtonStatus; run: () => void };
}

/** What a repository row shows while its file loads. */
export interface RepoRowLoading {
	kind: 'loading';
	name: string;
}

/** What a repository row shows once its file is read. */
export interface RepoRowReady {
	kind: 'ready';
	name: string;
	/** The row's one-line preview. */
	summary: string;
	/** The file as read, for the status pills (active ref, pending pull request). */
	data: RepoGuidelines;
	open: boolean;
	opened: number | undefined;
	actionLabel: 'Edit' | 'Write';
	edit: () => void;
	editor: GuidelinesEditorSpec;
}

/** One tracked repository's row, in whichever state its file read stands. */
export type RepoRowView = RepoRowError | RepoRowLoading | RepoRowReady;

/**
 * One tracked repository and its `RECODER.md`: the first rule, the file's
 * state (active on the default branch, pending in a pull request), and Write
 * or Edit. Saving opens a pull request; the file applies once it merges.
 */
export function useRepoRow(repo: TrackedRepo, overview: GuidelinesOverview): RepoRowView {
	const state = useGuidelines((store) => store.repos[repo.id]);
	const key: ScopeKey = `repo:${repo.id}`;
	const open = useGuidelinesEditor((store) => store.open === key);
	const opened = useGuidelinesEditor((store) => store.sessions[key]?.opened);
	const retry = useAction();

	if (state?.status === 'error') {
		return {
			kind: 'error',
			name: repo.name,
			summary: state.error,
			retry: { status: retry.status, run: () => retry.run(() => useGuidelines.getState().loadRepo(repo.id)) }
		};
	}

	if (state?.status !== 'ready') return { kind: 'loading', name: repo.name };

	const { data } = state;
	const written = data.content !== null || data.pending !== null;

	return {
		kind: 'ready',
		name: repo.name,
		summary: repoSummary(data),
		data,
		open,
		opened,
		actionLabel: written ? 'Edit' : 'Write',
		edit: () => editLayer(key, seedText(data.pending?.content ?? data.content, overview.template)),
		editor: {
			scope: key,
			open,
			repo: data,
			maxChars: overview.maxChars,
			label: `${repo.name} guidelines`
		}
	};
}
