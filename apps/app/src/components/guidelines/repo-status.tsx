'use client';

import type { RepoGuidelines } from '@recoder/shared';
import { Pill, swapMotion, Tooltip, useMotionVariants } from '@recoder/ui';
import { ArrowUpRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

/** Where the active file was read: branch and short commit. */
function activeSource(data: RepoGuidelines): string {
	const sha = data.sha ? ` at ${data.sha.slice(0, 7)}` : '';

	return `${data.path} on ${data.ref}${sha}`;
}

/**
 * The file's state beside its row: "Active · main" when the default branch
 * has it, "Pending in #12" (a link to the pull request) when a change waits
 * for review. A pill that appears after a save fades in; none animate on
 * first paint.
 */
export function RepoStatus({ data }: { data: RepoGuidelines }) {
	const swap = useMotionVariants(swapMotion);

	return (
		<div className="guidelines-status">
			<AnimatePresence initial={false} mode="popLayout">
				{data.content === null ? null : (
					<motion.span key="active" variants={swap} initial="initial" animate="animate" exit="exit">
						<Tooltip content={activeSource(data)}>
							<span className="flex">
								<Pill tone="ok">Active · {data.ref}</Pill>
							</span>
						</Tooltip>
					</motion.span>
				)}
				{data.pending ? (
					<motion.a
						key="pending"
						href={data.pending.url}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={`Pending in #${data.pending.number}, opens in a new tab`}
						className="guidelines-pill-link"
						variants={swap}
						initial="initial"
						animate="animate"
						exit="exit"
					>
						<Pill tone="medium">
							Pending in #{data.pending.number}
							<ArrowUpRight aria-hidden />
						</Pill>
					</motion.a>
				) : null}
			</AnimatePresence>
		</div>
	);
}
