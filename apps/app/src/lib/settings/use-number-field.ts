'use client';

import type { KeyboardEvent } from 'react';
import { useRef, useState } from 'react';

import { formatCount } from '../shell/format';

import { draftKeys } from './draft-keys';
import { parseWholeNumber, stepLimit } from './limits';
import { useSaveState, type SaveState } from './use-save-state';

/** Everything a whole-number setting field shows and does. */
export interface LimitFieldView {
	/** The text on screen: the draft while editing, else the saved value formatted. */
	text: string;
	/** The shown integer when `text` is a valid whole number in range, else null. */
	valueNow: number | null;
	min: number;
	max: number;
	canDecrement: boolean;
	canIncrement: boolean;
	/** Why the last commit was refused, or null. */
	error: string | null;
	state: SaveState;
	/** The field's change handler: starts a draft and clears any refusal. */
	edit: (text: string) => void;
	/** Steps the value by `-1` or `1` (`shift` uses the coarser step) and saves it. */
	step: (direction: -1 | 1, shift: boolean) => void;
	/** Commits the draft on blur; a no-op while the field shows the saved value. */
	blur: () => void;
	/** Enter commits (retrying a refusal), Escape puts the saved value back. */
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** Where a number field's saved value comes from and where a parsed one goes. */
export interface NumberFieldSource {
	/** The saved value; the field shows it formatted while there is no draft. */
	value: number;
	/** Lower bound, inclusive. */
	min?: number;
	/** Upper bound, inclusive. */
	max: number;
	/** Single increment for the stepper buttons and arrow keys. */
	step?: number;
	/** Coarser increment while Shift is held. */
	shiftStep?: number;
	/** The saved value as the store holds it now, for the commit-time check that skips an unchanged value. */
	current: () => number;
	/** Saves a parsed value; rejects with the reason it was refused. */
	save: (value: number) => Promise<unknown>;
	/** The field's text as a whole number in range, or the reason it isn't one. */
	parse: (text: string) => { value: number } | { error: string };
}

/**
 * One number setting as a stepper field. Typing saves when the field loses
 * focus or on Enter, and Escape puts the saved value back; stepping saves at
 * once. A value out of range, or a save the server refused, shows its reason
 * under the field and keeps the text; leaving the field does not send a
 * refused value again until it changes. A commit made while a save runs waits
 * and goes out once that save settles.
 */
export function useNumberField(source: NumberFieldSource): LimitFieldView {
	const { value: saved, min = 1, max, step: stepSize = 1, shiftStep = stepSize * 10, current, save, parse } = source;

	const [draft, setDraftState] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { state, track, clearFailure } = useSaveState();

	/** Mirrors `draft` synchronously so rapid stepper presses advance from the latest step. */
	const draftRef = useRef<string | null>(null);

	/** True while a save runs. */
	const saving = useRef(false);

	/** The latest commit asked for while a save ran. */
	const waiting = useRef<(() => void) | null>(null);

	/** The text the server refused last; cleared by any edit. */
	const refused = useRef<string | null>(null);

	function updateDraft(next: string | null): void {
		draftRef.current = next;
		setDraftState(next);
	}

	function settleDraft(committed: string): void {
		if (draftRef.current === committed) updateDraft(null);
	}

	/** Parses and saves `text` when it changed, settles the draft and error, then runs the commit that waited on this save. */
	async function saveText(text: string): Promise<void> {
		const parsed = parse(text);

		if ('error' in parsed) return setError(parsed.error);

		if (parsed.value === current()) {
			settleDraft(text);

			return setError(null);
		}

		saving.current = true;

		const failure = await track(save(parsed.value));

		saving.current = false;
		refused.current = failure ? text : null;
		setError(failure);

		if (!failure) settleDraft(text);

		const next = waiting.current;

		waiting.current = null;

		next?.();
	}

	/** Commits `text` on blur: queues while a save runs, and never resends a refused value. */
	async function commitOnBlur(text: string): Promise<void> {
		if (saving.current) {
			waiting.current = () => void commitOnBlur(text);

			return;
		}

		if (text === refused.current) return;

		await saveText(text);
	}

	/** Commits `text` on Enter or step: queues while a save runs, and resends even a refused value. */
	async function commitNow(text: string): Promise<void> {
		if (saving.current) {
			waiting.current = () => void commitNow(text);

			return;
		}

		await saveText(text);
	}

	function edit(text: string | null): void {
		refused.current = null;
		updateDraft(text);
		setError(null);
		clearFailure();
	}

	function step(direction: -1 | 1, shift: boolean): void {
		const base = draftRef.current !== null ? (parseWholeNumber(draftRef.current) ?? current()) : current();
		const nextValue = stepLimit(base, direction, shift ? shiftStep : stepSize, max, min);
		const nextText = formatCount(nextValue);

		edit(nextText);
		void commitNow(nextText);
	}

	function blur(): void {
		if (draftRef.current !== null) void commitOnBlur(draftRef.current);
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		draftKeys(
			event,
			draftRef.current,
			(text) => void commitNow(text),
			() => edit(null)
		);
	}

	const text = draft ?? formatCount(saved);
	const parsed = parseWholeNumber(text);
	const shownState: SaveState = state === 'success' && (draft !== null || error !== null) ? 'idle' : state;

	return {
		text,
		valueNow: parsed !== null && parsed >= min && parsed <= max ? parsed : null,
		min,
		max,
		canDecrement: parsed === null || parsed > min,
		canIncrement: parsed === null || parsed < max,
		error,
		state: shownState,
		edit,
		step,
		blur,
		onKeyDown
	};
}
