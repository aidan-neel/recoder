'use client';

import { CommandItem, Keycap, Pill, StatusGlyph } from '@recoder/ui';
import { GitPullRequest, Plug } from 'lucide-react';

import { entryGlyph, entryStatus } from '@/lib/queue/queue';
import type { RowActions, Suggestion } from '@/lib/queue/review-bar';
import { pullRef, pullTitle } from '@/lib/shell/format';

import { QueueAuthor } from './queue-author';

interface ReviewBarRowProps {
	item: Suggestion;
	actions: RowActions;
	/** True while this row's review is starting. */
	pending: boolean;
	onRun: () => void;
}

/** The row's 16px lead: the queue's own glyph for a pull request, a spinner while it starts, else what kind of row it is. */
function Lead({ item, pending }: { item: Suggestion; pending: boolean }) {
	if (pending) return <StatusGlyph kind="spinner" />;
	if (item.kind === 'pull') return <StatusGlyph kind={entryGlyph(item.entry)} />;

	const Icon = item.kind === 'number' ? GitPullRequest : Plug;

	return <Icon aria-hidden className="review-bar-icon" />;
}

/** The row's first line. */
function title(item: Suggestion): string {
	switch (item.kind) {
		case 'pull':
			return pullTitle(item.entry.pull.title, item.entry.pull.number);
		case 'number':
			return `${item.repo.name} #${item.number}`;
		case 'track':
			return `${item.target.name} #${item.number}`;
		case 'untracked':
			return item.named;
	}
}

/** The pull request's reference, author and size, as the queue row's meta line reads them. */
function PullMeta({ item }: { item: Extract<Suggestion, { kind: 'pull' }> }) {
	const { pull } = item.entry;

	return (
		<span className="review-bar-meta">
			<span className="text-fg-subtle">{pullRef(item.entry.repo, pull.number)}</span>
			<span aria-hidden>·</span>
			<QueueAuthor login={pull.author} />
			<span aria-hidden>·</span>
			<span className="text-ok">+{pull.additions}</span>
			<span className="text-danger">−{pull.deletions}</span>
		</span>
	);
}

/** The row's second line: who and how big for a pull request, else what choosing it does or why it can't. */
function Description({ item }: { item: Suggestion }) {
	switch (item.kind) {
		case 'pull':
			return <PullMeta item={item} />;
		case 'number':
			return 'Not in the queue: closed, or not loaded yet.';
		case 'track':
			return 'Not tracked yet. Tracking adds its pull requests to the queue.';
		case 'untracked':
			return item.reason ?? 'Not tracked. Track it in Settings, then review it here.';
	}
}

/**
 * The row's right edge, stacked in one cell so it never changes width: the
 * status pill at rest, and on the highlighted row what Enter does, or
 * "Starting" while it runs.
 */
function Side({ item, actions, pending }: Omit<ReviewBarRowProps, 'onRun'>) {
	const status = item.kind === 'pull' ? entryStatus(item.entry) : null;

	return (
		<span className="review-bar-side" data-pending={pending || undefined}>
			<span className="review-bar-rest">
				{status ? (
					<Pill tone={status.tone} className="queue-pill">
						{status.label}
					</Pill>
				) : null}
			</span>
			{actions.primary ? (
				<span className="review-bar-action">
					{actions.primary.label}
					<Keycap k="Enter" />
				</span>
			) : null}
			<span className="review-bar-starting">Starting…</span>
		</span>
	);
}

/** One row of the review bar: a pull request, a number in a tracked repository, or a repository to track. */
export function ReviewBarRow({ item, actions, pending, onRun }: ReviewBarRowProps) {
	return (
		<CommandItem
			value={item.id}
			onSelect={onRun}
			leading={<Lead item={item} pending={pending} />}
			description={<Description item={item} />}
			detail={<Side item={item} actions={actions} pending={pending} />}
			className="review-bar-row"
		>
			{title(item)}
		</CommandItem>
	);
}
