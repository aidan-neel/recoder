'use client';

import { ArrowUpRight } from 'lucide-react';
import { useMemo, type MouseEvent, type PointerEventHandler } from 'react';

import { Button } from '../button';
import { CopyButton } from '../display/copy-button';
import { Keycap } from '../keycap';
import { Popover, PopoverAnchor, PopoverContent } from '../overlay/popover';
import type { EmbedLook } from './link-dom';

/** The embed a card is about: the element it hangs from, what it shows, and whether the pointer or the caret opened it. */
export interface CardTarget {
	element: HTMLElement;
	look: EmbedLook;
	via: 'pointer' | 'caret';
}

interface LinkCardProps {
	target: CardTarget | null;
	onClose: () => void;
	onPointerEnter: PointerEventHandler<HTMLDivElement>;
	onPointerLeave: PointerEventHandler<HTMLDivElement>;
}

/** Opens a link in a new tab, with no way back to this page and no referrer. */
export function openLink(url: string): void {
	window.open(url, '_blank', 'noopener,noreferrer');
}

/** Focus stays in the field: a press on the card must not take it, or the caret would leave the text. */
function keepFocus(event: MouseEvent): void {
	event.preventDefault();
}

/** The card never takes focus, on opening or closing. */
function stayPut(event: Event): void {
	event.preventDefault();
}

/**
 * The card under an embed while the pointer rests on it or the caret sits
 * beside it: the title and state the host knows, the full URL, and Open and
 * Copy. It never takes focus, so typing goes on in the field.
 */
export function LinkCard({ target, onClose, onPointerEnter, onPointerLeave }: LinkCardProps) {
	const element = target?.element ?? null;
	const anchor = useMemo(() => ({ current: element }), [element]);

	const fact = target?.look.fact;
	const url = target?.look.description.url ?? '';

	return (
		<Popover open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
			<PopoverAnchor virtualRef={anchor} />
			<PopoverContent
				side="bottom"
				align="start"
				sideOffset={6}
				className="link-card"
				onOpenAutoFocus={stayPut}
				onCloseAutoFocus={stayPut}
				onPointerEnter={onPointerEnter}
				onPointerLeave={onPointerLeave}
			>
				<div data-ui="link-card" onMouseDown={keepFocus}>
					{fact?.title ? <p data-ui="link-card-title">{fact.title}</p> : null}
					{fact?.status ? (
						<p data-ui="link-card-status">
							{fact.tone ? <span data-ui="link-embed-dot" data-tone={fact.tone} aria-hidden /> : null}
							{fact.status}
						</p>
					) : null}
					<p data-ui="link-card-url">{url}</p>
					<div data-ui="link-card-actions">
						<Button variant="ghost" size="sm" onClick={() => openLink(url)}>
							<ArrowUpRight />
							Open
							{target?.via === 'caret' ? (
								<span data-ui="link-card-keys">
									<Keycap k="Alt" />
									<Keycap k="Enter" />
								</span>
							) : null}
						</Button>
						<CopyButton value={url} size="sm" />
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
