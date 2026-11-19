'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';

/** How long a stretch of new text takes to fade in, in ms: Capy's fade. */
export const FADE_MS = 160;

/** The steps a fade takes, each a highlight whose colour is a little more opaque than the last. */
const STEPS = 24;

/** A stretch that lands mid-word within this share of the last fade joins it rather than starting its own. */
const JOIN_SHARE = 0.25;

/** Text this short that is already there when a reply starts streaming fades in too, rather than standing at once. */
const SHORT_START = 64;

/** How many fade steps have been named, so each highlight gets a name of its own. */
let named = 0;

/** Tags whose own whitespace is layout, not text: a text node of only whitespace in or beside one is skipped. */
const STRUCTURE = new Set(['UL', 'OL', 'DL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR']);

const BLOCKS = new Set([
	'BLOCKQUOTE',
	'DIV',
	'DL',
	'OL',
	'UL',
	'P',
	'PRE',
	'TABLE',
	'LI',
	'HR',
	'H1',
	'H2',
	'H3',
	'H4'
]);

/** A stretch of the text, by offset into it, fading in from `started`. */
interface Fade {
	start: number;
	end: number;
	started: number;
	/** The step it shows now; -1 before its first frame. */
	step: number;
	ranges: { range: Range; steps: Highlight[] }[];
}

/** A text node and where its text sits in the whole. */
interface Piece {
	node: Text;
	start: number;
	end: number;
}

/** Whether a text node counts as text that fades: not code, a control or an icon, and not whitespace between blocks. */
function acceptText(node: Node): number {
	const parent = node.parentElement;

	if (!parent || parent.closest('pre, code, button, svg')) return NodeFilter.FILTER_REJECT;

	const blank = /^[\t\n\f\r ]+$/.test(node.nodeValue ?? '');

	const between =
		STRUCTURE.has(parent.tagName) ||
		BLOCKS.has(node.previousSibling?.nodeName ?? '') ||
		BLOCKS.has(node.nextSibling?.nodeName ?? '');

	return blank && between ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
}

/** The text nodes under `root` that fade, with their offsets, and the whole text they make. */
function readText(root: HTMLElement): { pieces: Piece[]; text: string } {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: acceptText });
	const pieces: Piece[] = [];
	let text = '';

	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const start = text.length;

		text += node.data;
		pieces.push({ node, start, end: text.length });
	}

	return { pieces, text };
}

/** How opaque a step is, in percent: a strong ease-out, so new text is readable almost at once. */
function stepShare(step: number): number {
	return (1 - (1 - step / STEPS) ** 2.4) * 100;
}

/**
 * Fades in the text that streams into `ref`, Capy's way: each stretch that arrives fades from transparent to its own
 * colour over 160ms, drawn with CSS custom highlights so no word is wrapped or moved. A stretch that lands mid-word
 * just after the last joins its fade. Text already there when the component mounts, code, and reduced motion stand
 * at once; a browser without custom highlights shows the text as it comes.
 */
export function useStreamFade(ref: RefObject<HTMLElement | null>, text: string, streaming: boolean): void {
	const update = useRef<((streaming: boolean) => void) | null>(null);

	useLayoutEffect(() => {
		const root = ref.current;

		if (!root || typeof Highlight === 'undefined' || !CSS.highlights) return;

		const reduced = matchMedia('(prefers-reduced-motion: reduce)');
		const byColor = new Map<string, Highlight[]>();
		const names: string[] = [];
		let last: { text: string; streaming: boolean } | null = null;
		let fades: Fade[] = [];
		let frame = 0;
		let sheet: HTMLStyleElement | null = null;

		function clear(): void {
			cancelAnimationFrame(frame);
			frame = 0;
			fades = [];
			names.forEach((name) => CSS.highlights.delete(name));
			names.length = 0;
			byColor.clear();
			sheet?.remove();
			sheet = null;
		}

		function release(fade: Fade): void {
			fade.ranges.forEach(({ range, steps }) => steps[fade.step]?.delete(range));
		}

		function tick(now: number): void {
			frame = 0;

			if (reduced.matches) return clear();

			fades = fades.filter((fade) => {
				const step = Math.min(STEPS, Math.floor(((now - fade.started) / FADE_MS) * STEPS));

				if (step !== fade.step) {
					release(fade);
					fade.step = step;
					fade.ranges.forEach(({ range, steps }) => steps[step]?.add(range));
				}

				return step < STEPS;
			});

			if (fades.length > 0) frame = requestAnimationFrame(tick);
			else clear();
		}

		/** The highlights that step `color` from transparent to whole, made the first time a colour fades. */
		function stepsFor(color: string, rules: CSSStyleSheet): Highlight[] {
			const known = byColor.get(color);

			if (known) return known;

			const steps = Array.from({ length: STEPS }, (_, step) => {
				const name = `stream-fade-${named++}`;
				const highlight = new Highlight();

				rules.insertRule(
					`::highlight(${CSS.escape(name)}) { color: color-mix(in srgb, ${color} ${stepShare(step)}%, transparent) }`,
					rules.cssRules.length
				);

				CSS.highlights.set(name, highlight);
				names.push(name);

				return highlight;
			});

			byColor.set(color, steps);

			return steps;
		}

		/** Starts a fade for what arrived since the last call and redraws every running fade over the text as it is. */
		function follow(nowStreaming: boolean): void {
			if (reduced.matches || !root) {
				last = null;

				return clear();
			}

			const { pieces, text: whole } = readText(root);
			const before = last;
			const from = before?.text.length ?? (nowStreaming && whole.length <= SHORT_START ? 0 : whole.length);
			const extended = before === null || whole.startsWith(before.text);

			last = { text: whole, streaming: nowStreaming };

			if (before && !extended) {
				let common = 0;

				while (common < before.text.length && before.text[common] === whole[common]) common += 1;

				fades = fades.filter((fade) => {
					fade.end = Math.min(fade.end, common);

					if (fade.start < fade.end) return true;

					release(fade);

					return false;
				});
			}

			if ((nowStreaming || before?.streaming) && extended && whole.length > from) {
				const now = performance.now();
				const tail = fades.at(-1);
				const midWord = /\S/.test(whole[from - 1] ?? ' ') && /\S/.test(whole[from] ?? ' ');

				if (tail && tail.end === from && midWord && now - tail.started < FADE_MS * JOIN_SHARE) tail.end = whole.length;
				else fades.push({ start: from, end: whole.length, started: now, step: -1, ranges: [] });
			}

			if (fades.length === 0) return clear();

			cancelAnimationFrame(frame);
			sheet ??= document.head.appendChild(document.createElement('style'));

			const rules = sheet.sheet;

			if (!rules) return clear();

			const colors = new Map<Element, string>();

			for (const { node, start, end } of pieces) {
				const parent = node.parentElement;

				if (parent && !colors.has(parent) && fades.some((fade) => end > fade.start && start < fade.end)) {
					colors.set(parent, getComputedStyle(parent).color);
				}
			}

			for (const fade of fades) {
				release(fade);
				fade.step = -1;
				fade.ranges = [];

				for (const { node, start, end } of pieces) {
					const color = node.parentElement ? colors.get(node.parentElement) : undefined;

					if (end <= fade.start || start >= fade.end || color === undefined) continue;

					const range = new Range();

					range.setStart(node, Math.max(0, fade.start - start));
					range.setEnd(node, Math.min(end, fade.end) - start);
					fade.ranges.push({ range, steps: stepsFor(color, rules) });
				}
			}

			tick(performance.now());
		}

		const stop = () => {
			if (reduced.matches) clear();
		};

		update.current = follow;
		reduced.addEventListener('change', stop);

		return () => {
			update.current = null;
			reduced.removeEventListener('change', stop);
			clear();
		};
	}, [ref]);

	useLayoutEffect(() => {
		update.current?.(streaming);
	}, [text, streaming]);
}
