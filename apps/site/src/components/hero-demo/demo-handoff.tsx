'use client';

import { Button, InlineModal } from '@recoder/ui';
import { Copy } from 'lucide-react';
import { AnimatePresence } from 'motion/react';

import { COPY_PROMPT, HandoffBody } from '@/components/decision/handoff-body';
import { useReview } from '@/lib/review/review-store';

/**
 * The handoff inside the window instead of a modal portal, so nothing traps
 * focus on the site: the kit's in-place modal, with the app's scrim, panel,
 * placement and motion. Copy shows its copied face without touching the
 * visitor's clipboard.
 */
export function DemoHandoff({ copied }: { copied: boolean }) {
	const open = useReview((state) => state.handoffOpen);

	return (
		<AnimatePresence>
			{open ? (
				<InlineModal key="handoff">
					<HandoffBody
						copy={() => (
							<Button variant="primary" status={copied ? 'success' : 'idle'} successLabel={COPY_PROMPT.copiedLabel}>
								<Copy />
								{COPY_PROMPT.label}
							</Button>
						)}
					/>
				</InlineModal>
			) : null}
		</AnimatePresence>
	);
}
