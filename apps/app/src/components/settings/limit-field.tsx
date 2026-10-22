'use client';

import { Field, Input } from '@recoder/ui';
import { useRef, useState, type KeyboardEvent } from 'react';

import { parseLimit, type LimitKey } from '@/lib/settings/limits';
import { useSettings } from '@/lib/settings/settings-store';
import { useSaveState } from '@/lib/settings/use-save-state';

import { SaveStatus } from './save-status';

interface LimitFieldProps {
	field: LimitKey;
	name: string;
	hint: string;
	max: number;
	/** The saved value. */
	value: number;
}

/** A commit asked for: the text, and whether to send it again though the server refused it (Enter does, a blur does not). */
interface Commit {
	text: string;
	retry: boolean;
}

/**
 * One review limit as a number field. It saves when it loses focus or on
 * Enter; Escape puts the saved value back. A value out of range, or a save
 * the server refused, shows its reason under the field and keeps the text;
 * leaving the field does not send a refused value again until it changes.
 * Editing or Escape clears the refusal, its cross included. A commit made
 * while a save runs waits and goes out once that save settles.
 */
export function LimitField({ field, name, hint, max, value }: LimitFieldProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { state, track, clearFailure } = useSaveState();

	/** True while a save runs. */
	const saving = useRef(false);

	/** The latest commit asked for while a save ran. */
	const waiting = useRef<Commit | null>(null);

	/** The text the server refused last; cleared by any edit. */
	const refused = useRef<string | null>(null);

	async function commit({ text, retry }: Commit): Promise<void> {
		if (saving.current) {
			waiting.current = { text, retry };

			return;
		}

		if (!retry && text === refused.current) return;

		const parsed = parseLimit(text, max);

		if ('error' in parsed) return setError(parsed.error);

		if (parsed.value === useSettings.getState().models?.limits[field]) {
			setDraft((now) => (now === text ? null : now));

			return setError(null);
		}

		saving.current = true;

		const failure = await track(useSettings.getState().saveModels({ [field]: parsed.value }));

		saving.current = false;
		refused.current = failure ? text : null;
		setError(failure);

		if (!failure) setDraft((now) => (now === text ? null : now));

		const next = waiting.current;

		waiting.current = null;

		if (next) void commit(next);
	}

	function edit(text: string | null): void {
		refused.current = null;
		setDraft(text);
		setError(null);
		clearFailure();
	}

	function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
		if (event.key === 'Enter' && draft !== null) {
			event.preventDefault();
			void commit({ text: draft, retry: true });
		}

		if (event.key === 'Escape' && draft !== null) {
			event.preventDefault();
			edit(null);
		}
	}

	return (
		<div data-ui="settings-row" className="settings-row settings-limit">
			<Field label={name} hint={hint} error={error}>
				<SaveStatus state={state} />
				<Input
					inputMode="numeric"
					autoComplete="off"
					spellCheck={false}
					value={draft ?? value.toLocaleString('en-US')}
					onChange={(event) => edit(event.target.value)}
					onBlur={() => {
						if (draft !== null) void commit({ text: draft, retry: false });
					}}
					onKeyDown={onKeyDown}
					className="settings-number"
				/>
			</Field>
		</div>
	);
}
