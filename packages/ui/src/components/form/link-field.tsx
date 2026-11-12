'use client';

import { useComposedRefs } from 'radix-ui/internal';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
	type HTMLAttributes,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type Ref
} from 'react';

import { cn } from '../../lib/cn';
import { useFieldControl } from './field-context';
import { LinkCard, openLink, type CardTarget } from './link-card';
import { describeLink, type LinkDescription, type LinkFacts } from './link-describe';
import { embedOf, urlOf, type EmbedLook } from './link-dom';
import { LinkEditor, type EditorHost } from './link-editor';

interface LinkFieldProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	'onChange' | 'onInput' | 'children' | 'defaultValue' | 'dangerouslySetInnerHTML' | 'contentEditable' | 'role'
> {
	/** The text, URLs in full. */
	value: string;
	/** The text after each change the person makes. */
	onValueChange: (value: string) => void;
	placeholder?: string;
	/** Grow with the text, between `minRows` and `maxRows`, then scroll. Off, the field stays `minRows` tall. */
	autosize?: boolean;
	/** The rows the field shows when empty. Defaults to 3. */
	minRows?: number;
	/** With `autosize`, the rows it grows to before it scrolls. Unset, it grows without limit. */
	maxRows?: number;
	invalid?: boolean;
	disabled?: boolean;
	autoFocus?: boolean;
	/** The most characters the text may hold; typing and pasting stop there. */
	maxLength?: number;
	/** What the host knows about a link (a pull request's title and state), for its embed and card. */
	linkFacts?: LinkFacts;
	ref?: Ref<HTMLDivElement>;
}

/** How long the pointer rests on an embed before its card opens, and how long the card waits for the pointer to come back. */
const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 150;

/**
 * Makes the element editable as plain text. `plaintext-only` keeps the
 * browser from adding markup on any path the editor does not catch; a
 * browser that does not know the value throws, and plain `true` is just as
 * safe there because the editor makes every edit itself.
 */
function makeEditable(node: HTMLElement): void {
	try {
		node.contentEditable = 'plaintext-only';
	} catch {
		node.contentEditable = 'true';
	}
}

/** Makes the element read-only: a disabled field takes no edits and no caret. */
function makeReadOnly(node: HTMLElement): void {
	node.contentEditable = 'false';
}

/**
 * A text field that shows each `http:` and `https:` link in it as an embed: a
 * small inline chip with the forge's mark and a short label (`api #214`),
 * read from the URL alone. It is a swap for `Textarea`: the value is the same
 * plain string, URLs in full, and the props a host uses on a `Textarea` work
 * the same way, `Field` wiring included.
 *
 * Technique: an element with `contenteditable="plaintext-only"` and
 * `white-space: pre-wrap`, where each embed is a non-editable inline element
 * that carries its URL. A pure model (text and embed ranges, `link-model`) is
 * the truth and the element is a view of it (`LinkEditor`). Every edit is
 * made on the model and drawn, with the field's own undo history. A real
 * `<textarea>` with a drawn layer behind it was the other way: it keeps the
 * native caret and undo, but the caret can enter a label, an embed cannot be
 * a link to a screen reader, and the drawn chip can never be wider than its
 * stand-in text.
 *
 * A link becomes an embed when pasted, when the word it is typed in ends (a
 * space, a line break, or the caret leaving), and when the value arrives
 * from outside. Backspace right after a typed link became an embed turns it
 * back into text. Resting on an embed, or putting the caret beside it, opens
 * a card with the URL, Open and Copy; Alt+Enter opens the link beside the
 * caret, and Ctrl or Cmd with a click opens the one clicked. Nothing is ever
 * fetched for a link.
 */
export function LinkField({
	value,
	onValueChange,
	placeholder,
	autosize = false,
	minRows = 3,
	maxRows,
	invalid,
	disabled = false,
	autoFocus = false,
	maxLength,
	linkFacts,
	className,
	style,
	id,
	'aria-label': ariaLabel,
	'aria-labelledby': labelledBy,
	'aria-describedby': describedBy,
	onKeyDown,
	onMouseDown,
	onPointerOver,
	onPointerOut,
	ref,
	...props
}: LinkFieldProps) {
	const field = useFieldControl({ id, describedBy, invalid });
	const [node, setNode] = useState<HTMLDivElement | null>(null);
	const composed = useComposedRefs(ref, setNode);
	const [editor, setEditor] = useState<LinkEditor | null>(null);
	const [card, setCard] = useState<CardTarget | null>(null);
	const hover = useRef(0);
	const latest = useRef({ value, onValueChange, linkFacts, maxLength, disabled });
	const looks = useRef(new Map<string, LinkDescription>());

	useLayoutEffect(() => {
		latest.current = { value, onValueChange, linkFacts, maxLength, disabled };
	});

	const look = useCallback((url: string): EmbedLook => {
		const cached = looks.current.get(url) ?? describeLink(url);

		looks.current.set(url, cached);

		return { description: cached, fact: latest.current.linkFacts?.(cached) };
	}, []);

	useLayoutEffect(() => {
		if (!node) return;

		let current: LinkEditor | null = null;

		const host: EditorHost = {
			look,
			maxLength: () => latest.current.maxLength,
			disabled: () => latest.current.disabled,
			onChange: (text) => latest.current.onValueChange(text),
			onCaret: () => setCard((open) => caretCard(current, open, look))
		};

		current = new LinkEditor(node, latest.current.value, host);
		setEditor(current);

		const detach = current.attach();

		return () => {
			detach();
			node.replaceChildren();
			setEditor(null);
		};
	}, [node, look]);

	useLayoutEffect(() => {
		if (!node) return;

		if (disabled) makeReadOnly(node);
		else makeEditable(node);
	}, [node, disabled]);

	useLayoutEffect(() => {
		if (editor && autoFocus && !disabled) editor.focusAtEnd();
	}, [editor, autoFocus, disabled]);

	useLayoutEffect(() => {
		editor?.setValue(value);
	}, [editor, value]);

	useLayoutEffect(() => {
		editor?.refresh();
	}, [editor, linkFacts]);

	useEffect(() => () => window.clearTimeout(hover.current), []);

	/** Opens or closes the pointer's card after a short rest, so a pointer passing over an embed shows nothing. */
	const schedule = useCallback((next: CardTarget | null, delay: number) => {
		window.clearTimeout(hover.current);

		hover.current = window.setTimeout(() => {
			setCard((open) => {
				if (next && !next.element.isConnected) return open;
				if (!next && open?.via === 'caret') return open;

				return next;
			});
		}, delay);
	}, []);

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		if (event.key === 'Enter' && event.altKey && card?.via === 'caret') {
			event.preventDefault();
			openLink(card.look.description.url);

			return;
		}

		onKeyDown?.(event);

		if (!event.defaultPrevented) editor?.keyDown(event.nativeEvent);
	}

	/** A press on an embed puts the caret beside it; with Ctrl or Cmd it opens the link; a double click selects it. */
	function handleMouseDown(event: MouseEvent<HTMLDivElement>): void {
		onMouseDown?.(event);

		const embed = embedOf(event.target instanceof Node ? event.target : null);

		if (!embed || !editor || event.button !== 0) return;

		event.preventDefault();

		if (event.ctrlKey || event.metaKey) openLink(urlOf(embed) ?? '');
		else if (disabled) return;
		else if (event.detail === 2) editor.selectEmbed(embed);
		else editor.placeBeside(embed, event.clientX);
	}

	function handlePointerOver(event: PointerEvent<HTMLDivElement>): void {
		onPointerOver?.(event);

		const embed = embedOf(event.target instanceof Node ? event.target : null);
		const url = embed ? urlOf(embed) : null;

		if (embed && url && event.pointerType !== 'touch')
			schedule({ element: embed, look: look(url), via: 'pointer' }, HOVER_OPEN_MS);
	}

	function handlePointerOut(event: PointerEvent<HTMLDivElement>): void {
		onPointerOut?.(event);

		if (embedOf(event.target instanceof Node ? event.target : null)) schedule(null, HOVER_CLOSE_MS);
	}

	/** CSS custom properties for row sizing lack keys on `CSSProperties`. */
	const rows = {
		'--textarea-min-rows': minRows,
		'--textarea-max-rows': autosize && maxRows ? maxRows : undefined
	} as CSSProperties;

	return (
		<>
			<div
				ref={composed}
				id={field.id}
				role="textbox"
				aria-multiline="true"
				aria-label={ariaLabel}
				aria-labelledby={labelledBy ?? (ariaLabel ? undefined : field.labelId)}
				aria-placeholder={placeholder}
				aria-describedby={field.describedBy}
				aria-invalid={field.invalid || undefined}
				aria-disabled={disabled || undefined}
				data-ui="link-field"
				data-placeholder={placeholder}
				data-autosize={autosize ? '' : undefined}
				data-max-rows={autosize && maxRows ? '' : undefined}
				data-invalid={field.invalid ? '' : undefined}
				data-disabled={disabled ? '' : undefined}
				className={cn(className)}
				style={{ ...rows, ...style }}
				onKeyDown={handleKeyDown}
				onMouseDown={handleMouseDown}
				onPointerOver={handlePointerOver}
				onPointerOut={handlePointerOut}
				{...props}
			/>
			<LinkCard
				target={card}
				onClose={() => setCard(null)}
				onPointerEnter={() => window.clearTimeout(hover.current)}
				onPointerLeave={() => schedule(null, HOVER_CLOSE_MS)}
			/>
		</>
	);
}

/** Whether two looks carry the same facts for the same URL, so an unchanged card keeps its reference. */
function sameLook(first: EmbedLook, second: EmbedLook): boolean {
	return (
		first.description.url === second.description.url &&
		first.fact?.title === second.fact?.title &&
		first.fact?.status === second.fact?.status &&
		first.fact?.tone === second.fact?.tone
	);
}

/** Keeps a pointer-opened card up to date while its embed stays in the document; closes it once removed. */
function pointerCard(open: CardTarget, look: (url: string) => EmbedLook): CardTarget | null {
	if (!open.element.isConnected) return null;

	const nextLook = look(open.look.description.url);

	return sameLook(open.look, nextLook) ? open : { ...open, look: nextLook };
}

/**
 * The card to show after the caret moves, an edit lands, `setValue` runs or
 * `linkFacts` refreshes: the embed beside the caret (unless just edited), else
 * a still-connected pointer card with fresh facts, else none.
 */
function caretCard(
	editor: LinkEditor | null,
	open: CardTarget | null,
	look: (url: string) => EmbedLook
): CardTarget | null {
	const beside = editor && !editor.editedLast ? editor.embedBesideCaret() : null;

	if (!beside) return open?.via === 'pointer' ? pointerCard(open, look) : null;

	const nextLook = look(urlOf(beside.element) ?? '');

	if (open?.element === beside.element && open.via === 'caret' && sameLook(open.look, nextLook)) return open;

	return { element: beside.element, look: nextLook, via: 'caret' };
}
