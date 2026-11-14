'use client';

import { ArrowUp, Square, SquareSlash } from 'lucide-react';
import { useId, useRef, type ComponentProps, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button';
import { Tooltip } from '../overlay/tooltip';
import type { ComposerCommand } from './composer-commands';
import { useComposerFiles } from './composer-files';
import { useInlineImages } from './composer-images';
import { commandOptionId, ComposerMenu, focusAtEnd, useCommandMenu, type ComposerMenuSide } from './composer-menu';
import type { LinkFacts } from './link-describe';
import { LinkField } from './link-field';
import type { InlineImage } from './link-image';
import { ImageTiles } from './image-chips';

const NO_IMAGES: readonly InlineImage[] = [];

/** The line in the composer's bar: why Enter did nothing. Only a refusal shows there, never a hint. */
export interface ComposerNote {
	text: string;
	tone: 'danger';
}

interface ComposerProps {
	/** The text, URLs in full. */
	value: string;
	onValueChange: (value: string) => void;
	/** Enter without Shift, when the "/" menu is shut. The caller decides whether that sends. */
	onSubmit: () => void;
	/** What the field is for, read out by a screen reader. */
	label: string;
	placeholder?: string;
	/** The rows the field shows when empty; 2 by default. */
	minRows?: number;
	/** The rows it grows to before it scrolls; 10 by default. */
	maxRows?: number;
	/** `lg` is a page's main field: roomier, in a larger type. */
	size?: 'md' | 'lg';
	/** `stack` puts the bar under the field; `row` puts the field and its action on one line, for a reply box. */
	layout?: 'stack' | 'row';
	autoFocus?: boolean;
	disabled?: boolean;
	invalid?: boolean;
	spellCheck?: boolean;
	/** What the field's link embeds show about a pull request. */
	linkFacts?: LinkFacts;
	/** The commands "/" offers; none leaves out the "/" button and the menu. */
	commands?: readonly ComposerCommand[];
	/** Where the "/" menu opens; over the composer by default. */
	menuSide?: ComposerMenuSide;
	/** Quiet tools at the bar's start, before the "/" button (`ComposerTool`s). */
	tools?: ReactNode;
	/** Controls at the bar's end, before the action: a model menu. */
	trailing?: ReactNode;
	/** The images attached so far: tiles over the text, and a chip in the text where each went in. */
	images?: readonly InlineImage[];
	/** Removes an image: its tile's remove button, or its chip deleted from the text. */
	onRemoveImage?: (id: string) => void;
	/** Files pasted into the field or dropped on the box; without it, files are refused as usual. */
	onFiles?: (files: File[]) => void;
	note?: ComposerNote | null;
	/** The send or stop button at the bar's end (`ComposerSend`, `ComposerStop`). */
	action: ReactNode;
	className?: string;
}

/**
 * The composer every chat shares: one ringed box with roomy text on top and
 * a bar at its foot. The bar holds quiet tools at its start, then the
 * refusal note, then the caller's trailing controls and the send or stop action. The box
 * rings brighter while the field has focus, and a click on its empty parts
 * puts the caret in the field. Enter submits, Shift+Enter starts a new line.
 * With `onFiles`, files pasted into the field or dropped on the box go to
 * the caller, and `images` shows what it kept: a row of tiles over the
 * text, and a chip in the text where each image went in. Removing either
 * removes the image (`useInlineImages`).
 * With `commands`, a slash at the start of the field, or the "/" button,
 * opens a list of them; a pick puts its prompt in the field to send. The
 * caller owns the text and the images and decides what a submit does; the
 * composer keeps only where in the text each image's chip sits.
 */
export function Composer({
	value,
	onValueChange,
	onSubmit,
	label,
	placeholder,
	minRows = 2,
	maxRows = 10,
	size = 'md',
	layout = 'stack',
	autoFocus,
	disabled,
	invalid,
	spellCheck,
	linkFacts,
	commands = [],
	menuSide = 'top',
	tools,
	trailing,
	images = NO_IMAGES,
	onRemoveImage,
	onFiles,
	note,
	action,
	className
}: ComposerProps) {
	const field = useRef<HTMLDivElement>(null);
	const { dropping, ...fileHandlers } = useComposerFiles(onFiles);
	const menuId = useId();
	const menu = useCommandMenu({ value, onValueChange, commands, field });
	const inline = useInlineImages({ value, onValueChange: menu.edit, images, onRemoveImage, field });
	const activeCommand = menu.open ? menu.matches[menu.active] : undefined;

	/** The menu takes its keys first; then Enter submits, unless Shift is held or the text is still being composed. */
	function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
		if (menu.keyDown(event)) return;
		if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;

		event.preventDefault();
		onSubmit();
	}

	/** A press on the box's own padding or the bar's empty space puts focus in the field. */
	function focusField(event: MouseEvent<HTMLDivElement>): void {
		const target = event.target;

		if (
			disabled ||
			!(target instanceof HTMLElement) ||
			!target.matches('[data-ui="composer"], [data-ui^="composer-bar"]')
		)
			return;

		event.preventDefault();
		field.current?.focus();
	}

	/** A removed tile's button leaves the page, so focus goes back to the text. */
	function removeImage(id: string): void {
		onRemoveImage?.(id);
		focusAtEnd(field);
	}

	const hasTools = tools !== undefined || commands.length > 0;

	return (
		<div
			data-ui="composer"
			data-size={size}
			data-layout={layout}
			data-disabled={disabled ? '' : undefined}
			data-invalid={invalid ? '' : undefined}
			data-dropping={dropping ? '' : undefined}
			className={cn(className)}
			onMouseDown={focusField}
			{...fileHandlers}
		>
			{commands.length > 0 ? <ComposerMenu menu={menu} id={menuId} side={menuSide} /> : null}
			<ImageTiles images={images} onRemove={onRemoveImage ? removeImage : undefined} />
			<LinkField
				ref={field}
				autosize
				minRows={minRows}
				maxRows={maxRows}
				aria-label={label}
				aria-controls={menu.open ? menuId : undefined}
				aria-activedescendant={activeCommand ? commandOptionId(menuId, activeCommand) : undefined}
				placeholder={placeholder}
				spellCheck={spellCheck}
				autoFocus={autoFocus}
				disabled={disabled}
				invalid={invalid}
				value={inline.text}
				linkFacts={linkFacts}
				images={images}
				onValueChange={inline.edit}
				onKeyDown={onKeyDown}
			/>
			<div data-ui="composer-bar">
				{hasTools ? (
					<div data-ui="composer-bar-tools">
						{tools}
						{commands.length > 0 ? (
							<ComposerTool
								label="Commands"
								shortcut="/"
								aria-haspopup="listbox"
								aria-expanded={menu.open}
								data-state={menu.open ? 'open' : 'closed'}
								disabled={disabled}
								onClick={menu.toggle}
							>
								<SquareSlash />
							</ComposerTool>
						) : null}
					</div>
				) : null}
				<p data-ui="composer-note" role="alert" title={note?.text}>
					{note?.text}
				</p>
				{trailing}
				{action}
			</div>
		</div>
	);
}

/**
 * Puts focus in the field of the composer that holds `element`, the caret at
 * the end: for a tool whose dialog would hand focus back to the tool, once
 * what it chose is in the field.
 */
export function focusComposerField(element: Element | null): void {
	const field = element?.closest('[data-ui="composer"]')?.querySelector<HTMLElement>('[data-ui="link-field"]') ?? null;

	focusAtEnd({ current: field });
}

interface ComposerToolProps extends ComponentProps<typeof Button> {
	/** The tool's name, for its tooltip and a screen reader. */
	label: string;
	/** A key named in the tooltip. */
	shortcut?: string;
}

/**
 * A quiet square icon button for the composer's bar, named by a tooltip. It
 * passes its props and ref to the button, so it can be a menu's or a
 * dialog's trigger.
 */
export function ComposerTool({ label, shortcut, className, ...props }: ComposerToolProps) {
	return (
		<Tooltip content={label} shortcut={shortcut}>
			<Button variant="ghost" size="icon" aria-label={label} data-ui="composer-tool" className={className} {...props} />
		</Tooltip>
	);
}

interface ComposerSendProps {
	/** What sending does, for a screen reader: "Send", "Start the review". */
	label?: string;
	disabled?: boolean;
	/** The send is under way: a spinner in the arrow's place, and clicks do nothing. */
	pending?: boolean;
	onClick: () => void;
}

/** The composer's send: the region's one primary button, an arrow up. */
export function ComposerSend({ label = 'Send', disabled, pending, onClick }: ComposerSendProps) {
	return (
		<Button
			variant="primary"
			size="icon"
			aria-label={label}
			data-ui="composer-send"
			disabled={disabled}
			status={pending ? 'pending' : 'idle'}
			onClick={onClick}
		>
			<ArrowUp />
		</Button>
	);
}

/** Stops the reply that is arriving; it stands where the send was. */
export function ComposerStop({ label = 'Stop', onClick }: { label?: string; onClick: () => void }) {
	return (
		<Tooltip content={label}>
			<Button variant="secondary" size="icon" aria-label={label} data-ui="composer-stop" onClick={onClick}>
				<Square className="size-3" fill="currentColor" />
			</Button>
		</Tooltip>
	);
}
