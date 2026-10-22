import { ChevronRight, Link2, MessageSquare, Play, Trash2, type LucideIcon } from 'lucide-react';

import { entryAction, type QueueEntry } from '@/lib/queue/queue';
import { useQueue } from '@/lib/queue/queue-store';
import { copyLink } from '@/lib/shell/copy-link';

/** One thing a row can do, for its right-click menu and for the palette while the row is selected. */
export interface RowAction {
	id: 'open' | 'start' | 'talk' | 'copy' | 'delete';
	label: string;
	icon: LucideIcon;
	shortcut?: string;
	destructive?: boolean;
	disabled?: boolean;
	/** Actions in one group sit together; a menu puts a separator between groups. */
	group: 'review' | 'share' | 'delete';
	run: () => void;
}

/** What the row's actions call back into. */
export interface RowHandlers {
	/** Where the row leads; null when it has no review to open. */
	href: string | null;
	sample: boolean;
	starting: boolean;
	onOpen: (entry: QueueEntry) => void;
	onStart: (entry: QueueEntry) => void;
	/** Asks before deleting the row's review. */
	onDelete: (entry: QueueEntry) => void;
}

/**
 * Everything a row offers beyond its button. A reviewed pull request can be
 * reviewed again here, since the button and `r` only start reviews that are
 * missing. A pull request with no review can open a conversation first. The
 * sample only simulates missing reviews and has nothing on the server to delete.
 */
export function rowActions(entry: QueueEntry, handlers: RowHandlers): RowAction[] {
	const { href, sample, starting } = handlers;
	const action = entryAction(entry);
	const startable = action.starts || (!sample && entry.state !== 'reviewing');
	const actions: RowAction[] = [];

	if (href) {
		actions.push({
			id: 'open',
			label: 'Open review',
			icon: ChevronRight,
			shortcut: action.starts ? undefined : 'Enter',
			group: 'review',
			run: () => handlers.onOpen(entry)
		});
	}

	if (startable) {
		actions.push({
			id: 'start',
			label: action.starts ? action.label : 'Review again',
			icon: Play,
			shortcut: action.starts ? 'r' : undefined,
			disabled: starting,
			group: 'review',
			run: () => handlers.onStart(entry)
		});
	}

	if (!sample && !entry.review) {
		actions.push({
			id: 'talk',
			label: 'Talk it through first',
			icon: MessageSquare,
			disabled: starting,
			group: 'review',
			run: () => void useQueue.getState().talk(entry)
		});
	}

	actions.push({ id: 'copy', label: 'Copy link', icon: Link2, group: 'share', run: () => copyLink(entry.pull.url) });

	if (!sample && entry.review) {
		actions.push({
			id: 'delete',
			label: 'Delete review',
			icon: Trash2,
			destructive: true,
			group: 'delete',
			run: () => handlers.onDelete(entry)
		});
	}

	return actions;
}
