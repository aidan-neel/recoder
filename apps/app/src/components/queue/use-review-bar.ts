'use client';

import type { CommandHint } from '@recoder/ui';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { useConnections } from '@/lib/connections/connections-store';
import { useQueue } from '@/lib/queue/queue-store';
import {
	completion,
	rowActions,
	suggestionGroups,
	type BarAction,
	type RowActions,
	type Suggestion,
	type SuggestionGroup
} from '@/lib/queue/review-bar';
import { parseReviewQuery, type ReviewQuery } from '@/lib/shell/pull-ref';
import { useKeys } from '@/lib/shell/use-keys';

import { barFailure, itemRef, runAction, type BarFailure, type BarOutcome } from './review-bar-run';

/** Where the bar's last action stands: running, started, or failed with why. */
export type BarStatus =
	| { phase: 'idle' }
	| ({ phase: 'pending'; id: string } & BarOutcome)
	| ({ phase: 'done' } & BarOutcome)
	| ({ phase: 'failed' } & BarFailure);

const IDLE: BarStatus = { phase: 'idle' };

/** How long "Reviewing api #214." stays under the bar. */
const DONE_MS = 6000;

/** "Start review" as a footer hint reads "start review"; "PR" keeps its capitals. */
function hintLabel(label: string): string {
	return label[0].toLowerCase() + label.slice(1);
}

/** What the list says when it has no row: a hint while nothing is typed, else why nothing matched. */
function emptyText(query: ReviewQuery, sample: boolean, reposLoaded: boolean): string {
	if (query.ref && sample) return 'Only the sample’s own pull requests are here.';
	if (query.ref && !reposLoaded) return 'Looking through your repositories…';
	if (query.search) return 'No open pull request matches. Paste a link to review a closed one.';

	return 'Paste a link to a pull request, or type its number.';
}

/** The footer's keys for the highlighted row: what Enter and ⌘Enter do, Tab when it completes, and Escape. */
function footerHints(actions: RowActions | null, completes: boolean): CommandHint[] {
	return [
		...(actions?.primary ? [{ keys: ['Enter'], label: hintLabel(actions.primary.label) }] : []),
		...(actions?.alternate ? [{ keys: ['mod+Enter'], label: hintLabel(actions.alternate.label) }] : []),
		...(completes ? [{ keys: ['Tab'], label: 'complete' }] : []),
		{ keys: ['Escape'], label: 'close' }
	];
}

/** The sample has no pull request to comment on, so its rows offer no commenting alternate. */
function withoutComment(actions: RowActions, sample: boolean): RowActions {
	return sample && actions.alternate?.comment ? { ...actions, alternate: null } : actions;
}

/** Clears a finished start's note after a while, so the line under the bar goes quiet again. */
function useSettle(status: BarStatus, setStatus: (status: BarStatus) => void): void {
	useEffect(() => {
		if (status.phase !== 'done') return;

		const timer = setTimeout(() => setStatus(IDLE), DONE_MS);

		return () => clearTimeout(timer);
	}, [status, setStatus]);
}

/** Loads what a reference needs once the bar takes focus: the tracked repositories, and the GitLab host for its links. */
function prepare(sample: boolean): void {
	if (sample) return;

	const connections = useConnections.getState();

	void connections.loadRepos();

	if (!connections.auth) void connections.loadAuth();
}

/**
 * The review bar's state. `/` focuses it; its results show while it has
 * focus. The text reads as a reference and a brief, or a search; Enter runs
 * the highlighted row's action, ⌘Enter or Shift+Enter its alternate, and Tab
 * completes the reference. A start shows pending on its row, and the rows hold
 * still until it settles (tracking a repository would otherwise turn its row
 * into another); then the bar closes with a note under it. A failure stays in
 * the open bar with its reason.
 */
export function useReviewBar(sample: boolean) {
	const inputRef = useRef<HTMLInputElement>(null);
	const busy = useRef(false);
	const [text, setText] = useState('');
	const [focused, setFocused] = useState(false);
	const [highlighted, setHighlighted] = useState('');
	const [comment, setComment] = useState(false);
	const [status, setStatus] = useState<BarStatus>(IDLE);
	const [held, setHeld] = useState<SuggestionGroup[] | null>(null);
	const entries = useQueue((state) => state.entries);
	const repos = useConnections((state) => state.repos);
	const gitlabHost = useConnections((state) => state.auth?.gitlab.host ?? null);
	const query = useMemo(() => parseReviewQuery(text), [text]);

	const fresh = useMemo(
		() => suggestionGroups(query, { entries, repos: sample ? null : repos, sample, gitlabHost }),
		[query, entries, repos, sample, gitlabHost]
	);

	const groups = held ?? fresh;

	const items = groups.flatMap((group) => group.items);
	const current = items.find((item) => item.id === highlighted) ?? items[0] ?? null;
	const actionsFor = (item: Suggestion) => withoutComment(rowActions(item, !!query.brief, comment), sample);
	const next = current ? completion(current, entries, query.brief) : null;
	const completes = next !== null && next !== text;

	useKeys({ '/': () => inputRef.current?.focus() });
	useSettle(status, setStatus);

	function change(value: string): void {
		setText(value);

		if (status.phase === 'done' || status.phase === 'failed') setStatus(IDLE);
	}

	function onFocusChange(next: boolean): void {
		setFocused(next);

		if (next) prepare(sample);
	}

	async function run(item: Suggestion, action: BarAction | null): Promise<void> {
		if (!action || busy.current) return;

		busy.current = true;
		setHeld(groups);

		if (action.kind === 'start' || action.kind === 'track')
			setStatus({ phase: 'pending', id: item.id, text: `Starting ${itemRef(item)}…`, reviewId: null });

		try {
			const outcome = await runAction(item, action, query.brief, sample);

			setText('');
			setStatus(outcome ? { phase: 'done', ...outcome } : IDLE);
			inputRef.current?.blur();
		} catch (error) {
			setStatus({ phase: 'failed', ...barFailure(item, error) });
		} finally {
			busy.current = false;
			setHeld(null);
		}
	}

	/** ⌘Enter and Shift+Enter run the alternate; Tab completes the reference when it would change the text. */
	function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || event.shiftKey)) {
			event.preventDefault();

			if (current) void run(current, actionsFor(current).alternate);

			return;
		}

		if (event.key === 'Tab' && !event.shiftKey && completes && next) {
			event.preventDefault();
			change(next);
		}
	}

	return {
		inputRef,
		text,
		change,
		query,
		groups,
		open: focused,
		onFocusChange,
		highlighted: current?.id ?? '',
		setHighlighted,
		comment,
		setComment,
		status,
		actionsFor,
		run: (item: Suggestion) => void run(item, actionsFor(item).primary),
		onKeyDown,
		hints: footerHints(current ? actionsFor(current) : null, completes),
		empty: emptyText(query, sample, repos !== null)
	};
}
