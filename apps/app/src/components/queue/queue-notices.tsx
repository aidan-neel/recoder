'use client';

import { Button, swapMotion, useMotionVariants } from '@recoder/ui';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';

import { PageNotice } from '@/components/common/page-notice';
import { OFFLINE_TEXT } from '@/lib/api/http';
import { clockTime, joinNames } from '@/lib/queue/format';
import { useQueue } from '@/lib/queue/queue-store';
import { useAction } from '@/lib/shell/use-action';

/** Loads the queue again. A load the server still does not answer rejects, so the button shows its failure face. */
async function reload(): Promise<void> {
	if (!(await useQueue.getState().refresh())) throw new Error(OFFLINE_TEXT);
}

function SampleButton() {
	return (
		<Button asChild variant="outline">
			<Link href="/review/sample">Open the sample review</Link>
		</Button>
	);
}

/**
 * The whole page when the review server does not answer the first load.
 * `reconnecting`: the server answered and the settings load again, so Try
 * again keeps spinning until first run or the queue takes the page.
 */
export function OfflineNotice({ reconnecting }: { reconnecting: boolean }) {
	const retry = useAction();

	return (
		<PageNotice
			lead={OFFLINE_TEXT}
			rest="Start it with bun run dev, then try again. The sample review works without it."
		>
			<Button status={reconnecting ? 'pending' : retry.status} onClick={() => retry.run(reload)}>
				Try again
			</Button>
			<SampleButton />
		</PageNotice>
	);
}

/** The whole page when the server answers with no tracked repositories. */
export function EmptyNotice() {
	return (
		<PageNotice lead="No repositories tracked yet." rest="Track one in Settings and its open pull requests land here.">
			<Button asChild variant="primary">
				<Link href="/settings/connections">Open settings</Link>
			</Button>
			<SampleButton />
		</PageNotice>
	);
}

/** What the stale note says: the server is down, or some repositories' pull requests did not load. */
function staleText(stale: boolean, missing: string[], loadedAt: number | null): string | null {
	if (stale) return `${OFFLINE_TEXT}${loadedAt ? ` This list is from ${clockTime(loadedAt)}.` : ''}`;
	if (missing.length > 0) return `Couldn’t load pull requests from ${joinNames(missing)}.`;

	return null;
}

/**
 * A quiet line over the list when a refresh failed after a good load. It sits
 * in the column's top padding, so the list never moves or flickers for it.
 */
export function StaleNote() {
	const swap = useMotionVariants(swapMotion);
	const stale = useQueue((state) => state.stale);
	const missing = useQueue((state) => state.missing);
	const loadedAt = useQueue((state) => state.loadedAt);
	const retry = useAction();
	const text = staleText(stale, missing, loadedAt);

	return (
		<AnimatePresence initial={false}>
			{text ? (
				<motion.div
					key="stale"
					role="status"
					className="queue-stale"
					variants={swap}
					initial="initial"
					animate="animate"
					exit="exit"
				>
					<span className="min-w-0 truncate">{text}</span>
					<Button variant="ghost" status={retry.status} onClick={() => retry.run(reload)}>
						Try again
					</Button>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

/** Under the headline when every tracked repository has no open pull requests. */
export function NoPullsActions() {
	return (
		<div className="flex gap-2">
			<Button asChild variant="outline">
				<Link href="/settings/connections">Track another repository</Link>
			</Button>
		</div>
	);
}
