'use client';

import type { FailureAction } from '@recoder/shared';
import { Button } from '@recoder/ui';
import { CircleAlert, RotateCcw } from 'lucide-react';
import Link from 'next/link';

import { ReplyMeta } from './chat-message';

interface ReplyFailureProps {
	/** The heading; a cause with its own name (signed out, out of usage) says so. */
	title?: string;
	reason: string;
	/** The way out the server offered: add a provider, or open settings. */
	action?: FailureAction;
	/** Some of the reply arrived before it failed. */
	partial: boolean;
	/** The developer asked again since, so the notice shrinks to one line that still says why. */
	quiet: boolean;
	/** Asks the question again; null when there is nothing to ask again yet. */
	onRetry: (() => void) | null;
}

/** The way out of a failure as a button: add a provider, or open settings. */
export function FailureLink({ action }: { action: FailureAction | undefined }) {
	if (!action) return null;

	return (
		<Button variant="outline" asChild>
			{action === 'sign-in' ? (
				<Link href="/settings/agent?add=provider">Add a provider</Link>
			) : (
				<Link href="/settings/agent">Open settings</Link>
			)}
		</Button>
	);
}

/**
 * A reply that failed, in the transcript where it should have been, the
 * same in both conversations: a notice with why it failed, Try again and
 * any way out the server offered. Once the developer asked again, it is one
 * quiet line that still says why.
 */
export function ReplyFailure({ title = 'Reply failed', reason, action, partial, quiet, onRetry }: ReplyFailureProps) {
	if (quiet) {
		return (
			<ReplyMeta title={reason} className="mt-0 font-sans text-[12px]">
				{partial ? 'Didn’t finish' : 'Not answered'}: {reason}
			</ReplyMeta>
		);
	}

	return (
		<div role="alert" data-ui="chat-notice">
			<CircleAlert size={14} className="chat-notice-icon" aria-hidden />
			<div className="min-w-0 flex-1">
				<p className="chat-notice-title">{title}</p>
				<p className="chat-notice-body">{reason}</p>
				{onRetry || action ? (
					<div className="mt-2.5 flex flex-wrap gap-2">
						{onRetry ? (
							<Button variant="outline" onClick={onRetry}>
								<RotateCcw className="size-3.5" aria-hidden />
								Try again
							</Button>
						) : null}
						<FailureLink action={action} />
					</div>
				) : null}
			</div>
		</div>
	);
}
