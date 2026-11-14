'use client';

import { ConfirmDialog } from '@recoder/ui';
import { ArrowUpRight, Ban, Link2, Trash2 } from 'lucide-react';
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';

import { copyLink } from '@/lib/shell/copy-link';
import {
	QUESTION_COPY,
	useRecentActions,
	type RecentActionsView,
	type RecentQuestion,
	type RecentTarget
} from '@/lib/shell/use-recent-actions';
import type { RecentChat, RecentReview } from '@/lib/shell/types';

/** One entry of a row's menu. The right-click menu and the "more" menu both render the same list. */
export interface RowAction {
	id: string;
	label: string;
	icon: ComponentType;
	destructive?: boolean;
	/** A hairline goes above it, to set a group apart. */
	separated?: boolean;
	onSelect: () => void;
}

const AskContext = createContext<RecentActionsView['ask'] | null>(null);

/**
 * Holds the sidebar's confirm dialog for deleting or cancelling a row. It
 * lives above the lists, so it outlives the row it asks about.
 */
export function RecentActionsHost({ children }: { children: ReactNode }) {
	const view = useRecentActions();
	const copy = view.question ? QUESTION_COPY[view.question.kind] : null;

	return (
		<AskContext.Provider value={view.ask}>
			{children}
			{copy ? (
				<ConfirmDialog
					open={view.open}
					onOpenChange={view.setOpen}
					title={copy.title}
					description={copy.description}
					confirmLabel={copy.confirmLabel}
					cancelLabel={copy.cancelLabel}
					destructive
					onConfirm={view.confirm}
				/>
			) : null}
		</AskContext.Provider>
	);
}

function useAsk(): (question: RecentQuestion) => void {
	const ask = useContext(AskContext);

	if (!ask) throw new Error('A recent row’s actions must be inside a RecentActionsHost.');

	return ask;
}

/** The address of a row's page, whole, for a new tab or the clipboard. */
function absoluteHref(href: string): string {
	return new URL(href, location.origin).href;
}

function pageActions(href: string): RowAction[] {
	return [
		{
			id: 'open',
			label: 'Open in new tab',
			icon: ArrowUpRight,
			onSelect: () => window.open(href, '_blank', 'noopener')
		},
		{ id: 'copy', label: 'Copy link', icon: Link2, onSelect: () => copyLink(absoluteHref(href)) }
	];
}

/** The review row's menu: open, copy, cancel while it runs, delete. */
export function useReviewActions(): (review: RecentReview) => RowAction[] {
	const ask = useAsk();

	return (review) => {
		const target: RecentTarget = { id: review.reviewId, href: review.href };
		const running = review.state === 'running' || review.state === 'queued';

		return [
			...pageActions(review.href),
			...(running
				? [
						{
							id: 'cancel',
							label: 'Cancel review',
							icon: Ban,
							onSelect: () => ask({ kind: 'cancel-review', target })
						}
					]
				: []),
			{
				id: 'delete',
				label: 'Delete review',
				icon: Trash2,
				destructive: true,
				separated: true,
				onSelect: () => ask({ kind: 'delete-review', target })
			}
		];
	};
}

/** The chat row's menu: open, copy, delete. */
export function useChatActions(): (chat: RecentChat) => RowAction[] {
	const ask = useAsk();

	return (chat) => [
		...pageActions(chat.href),
		{
			id: 'delete',
			label: 'Delete chat',
			icon: Trash2,
			destructive: true,
			separated: true,
			onSelect: () => ask({ kind: 'delete-chat', target: { id: chat.chatId, href: chat.href } })
		}
	];
}
