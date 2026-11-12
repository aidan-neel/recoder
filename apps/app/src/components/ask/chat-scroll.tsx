'use client';

import { Button, menuMotion, ScrollArea, Tooltip, useMotionVariants } from '@recoder/ui';
import { ArrowDown } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import type { useStickToBottom } from '@/lib/ask/stick-to-bottom';

interface ChatScrollProps {
	/** The pinning state from `useStickToBottom`, owned by the parent so sending can jump to the end. */
	stick: ReturnType<typeof useStickToBottom>;
	label: string;
	children: ReactNode;
}

/** Marks the transcript busy until the returned release runs. */
const HoldBusy = createContext<(() => () => void) | null>(null);

/**
 * True while the column that holds the transcript draws its opening frame,
 * where its content is not yet shown. The scroll area and its entries then
 * render a frame later, in the space the transcript's box already holds, so
 * the commit that opens the column stays light.
 */
export const TranscriptHold = createContext(false);

/**
 * Keeps the transcript `aria-busy` while a reply is still arriving, through
 * the end of its steady reveal, so a screen reader reads it once, whole.
 */
export function useHoldBusy(arriving: boolean): void {
	const hold = useContext(HoldBusy);

	useEffect(() => (arriving && hold ? hold() : undefined), [arriving, hold]);
}

/**
 * True while the transcript is held back (`TranscriptHold`). Its caller
 * passes the opposite to `useStickToBottom` as `mounted`, so the pinning
 * attaches once the scroll area is in.
 */
export function useTranscriptHeld(): boolean {
	return useContext(TranscriptHold);
}

/**
 * A transcript that scrolls, follows streaming text at its end and offers a
 * jump back down when the reader has scrolled up. Under a `TranscriptHold` it
 * keeps only its box, which takes the same space, until the hold ends.
 */
export function ChatScroll({ stick, label, children }: ChatScrollProps) {
	const held = useTranscriptHeld();

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			{held ? null : (
				<Transcript stick={stick} label={label}>
					{children}
				</Transcript>
			)}
		</div>
	);
}

/** The scroll area, its log and the jump to the latest message. */
function Transcript({ stick, label, children }: ChatScrollProps) {
	const jump = useMotionVariants(menuMotion);
	const { attachViewport, attachContent, atBottom, toBottom } = stick;
	const [holds, setHolds] = useState(0);

	const hold = useCallback(() => {
		setHolds((count) => count + 1);

		return () => setHolds((count) => count - 1);
	}, []);

	return (
		<>
			<ScrollArea className="chat-scroll flex-1" viewportRef={attachViewport}>
				<div
					ref={attachContent}
					role="log"
					aria-label={label}
					aria-busy={holds > 0 || undefined}
					className="flex flex-1 flex-col gap-5 px-3 pt-4 pb-5"
				>
					<HoldBusy value={hold}>{children}</HoldBusy>
				</div>
			</ScrollArea>
			<AnimatePresence initial={false}>
				{atBottom ? null : (
					<motion.div
						key="jump"
						variants={jump}
						initial="closed"
						animate="open"
						exit="closed"
						className="absolute bottom-3 left-1/2 -translate-x-1/2"
					>
						<Tooltip content="Jump to latest">
							<Button
								variant="secondary"
								size="icon"
								className="chat-jump rounded-full"
								aria-label="Jump to latest"
								onClick={() => toBottom(true)}
							>
								<ArrowDown aria-hidden />
							</Button>
						</Tooltip>
					</motion.div>
				)}
			</AnimatePresence>
		</>
	);
}
