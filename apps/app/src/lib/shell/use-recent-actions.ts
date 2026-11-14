'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { useApi, useListStore } from '../api/client';
import { failureText } from '../api/http';
import { navigate } from './navigation';
import { errorToast, undoToast } from './notify';
import { pullsHref } from './routes';

/** A sidebar row an action is about, with the page the row opens. */
export interface RecentTarget {
	id: string;
	href: string;
}

/** What the sidebar's confirm dialog can ask about. */
export type RecentQuestion =
	| { kind: 'delete-review'; target: RecentTarget }
	| { kind: 'cancel-review'; target: RecentTarget }
	| { kind: 'delete-chat'; target: RecentTarget };

/** The words of one question: the dialog's copy and the toasts that follow. */
export interface QuestionCopy {
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel?: string;
	done: string;
	failed: string;
}

/** The copy of every question. */
export const QUESTION_COPY: Record<RecentQuestion['kind'], QuestionCopy> = {
	'delete-review': {
		title: 'Delete this review?',
		description: 'Its findings and conversation are removed for good.',
		confirmLabel: 'Delete',
		done: 'Review deleted',
		failed: 'Couldn’t delete the review'
	},
	'cancel-review': {
		title: 'Cancel this review?',
		description: 'The review stops and the findings so far are dropped. You can start a new one.',
		confirmLabel: 'Cancel review',
		cancelLabel: 'Keep reviewing',
		done: 'Review cancelled',
		failed: 'Couldn’t cancel the review'
	},
	'delete-chat': {
		title: 'Delete this chat?',
		description: 'The conversation is removed for good.',
		confirmLabel: 'Delete',
		done: 'Chat deleted',
		failed: 'Couldn’t delete the chat'
	}
};

/** The sidebar's question dialog: which question is open, and the call that answers it. */
export interface RecentActionsView {
	/** The last question asked; it stays while the dialog plays its exit, so the words do not vanish. */
	question: RecentQuestion | null;
	open: boolean;
	ask: (question: RecentQuestion) => void;
	setOpen: (open: boolean) => void;
	/** Runs the open question's action. A failure is a toast and the dialog closes; a deleted page the person is on gives way to the list. */
	confirm: () => Promise<void>;
}

/** Deletes or cancels a sidebar row after the person confirms, and leaves the page the row opened if it was deleted. */
export function useRecentActions(): RecentActionsView {
	const [question, setQuestion] = useState<RecentQuestion | null>(null);
	const [open, setOpen] = useState(false);
	const pathname = usePathname();
	const client = useApi();
	const list = useListStore();

	async function perform({ kind, target }: RecentQuestion): Promise<void> {
		if (kind === 'cancel-review') {
			await client.cancelReview(target.id);
			list.reload();

			return;
		}

		await (kind === 'delete-review' ? list.deleteReview(target.id) : list.deleteChat(target.id));

		if (pathname === target.href.split('?')[0]) navigate(pullsHref(client.base));
	}

	async function confirm(): Promise<void> {
		if (!question) return;

		const copy = QUESTION_COPY[question.kind];

		try {
			await perform(question);
			undoToast(copy.done);
		} catch (error) {
			errorToast(copy.failed, failureText(error));
		}
	}

	function ask(next: RecentQuestion): void {
		setQuestion(next);
		setOpen(true);
	}

	return { question, open, ask, setOpen, confirm };
}
