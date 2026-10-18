'use client';

import { Button, Tooltip } from '@recoder/ui';
import { X } from 'lucide-react';
import { useMemo, useRef, type KeyboardEvent } from 'react';

import { PanelHeader } from '@/components/common/panel-header';
import { useAskFocusRequests } from '@/lib/ask/focus-request';
import { askItemOf } from '@/lib/ask/item';
import { surfaceOf, useReview } from '@/lib/review/review-store';

import { ItemConversation } from './item-conversation';
import { ReviewConversation } from './review-conversation';

function close(): void {
	useReview.getState().setAskOpen(false);
}

/**
 * Escape inside the panel, unless something in it took the key first: in a
 * field with text it steps out to the panel, keeping the draft; anywhere else
 * it closes the column.
 */
function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
	if (event.key !== 'Escape' || event.defaultPrevented) return;

	const target = event.target;

	event.preventDefault();

	if (target instanceof HTMLTextAreaElement && target.value.trim()) event.currentTarget.focus({ preventScroll: true });
	else close();
}

/**
 * The ask column's content. With a decision or receipt selected, it asks the
 * reviewer about that item; with the overview or a file, it is the
 * conversation with Orchestrator. The sample has no Orchestrator, so there
 * it asks for a decision instead. The column moves focus in and out; a
 * focus request (the palette's Ask Orchestrator) puts it in the composer
 * while the column is already open.
 */
export function AskPanel() {
	const review = useReview((state) => state.review);
	const sample = useReview((state) => state.sample);
	const selection = useReview((state) => state.selection);
	const surface = useReview((state) => surfaceOf(state));
	const item = useMemo(() => askItemOf(surface, selection), [surface, selection]);
	const title = item || sample ? 'Ask the reviewer' : 'Ask Orchestrator';
	const panel = useRef<HTMLElement>(null);

	useAskFocusRequests(panel);

	if (!review) return null;

	return (
		<section ref={panel} tabIndex={-1} aria-label={title} data-ask-panel data-ui="ask-panel" onKeyDown={onKeyDown}>
			<PanelHeader className="pr-2">
				<h2 className="text-[13.5px] leading-5 font-medium text-fg">{title}</h2>
				<Tooltip content="Close" shortcut="Escape">
					<Button variant="ghost" size="icon" className="ml-auto" aria-label="Close" onClick={close}>
						<X aria-hidden />
					</Button>
				</Tooltip>
			</PanelHeader>
			{item || sample ? <ItemConversation reviewId={review.id} item={item} /> : <ReviewConversation review={review} />}
		</section>
	);
}
