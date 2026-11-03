'use client';

import { DEFAULT_MENTION_HANDLE } from '@recoder/shared';
import { Field, Input } from '@recoder/ui';
import { useState } from 'react';

import { useAutoReview } from '@/lib/settings/auto-review-store';
import { handleError } from '@/lib/settings/auto-review-text';
import { draftKeys } from '@/lib/settings/draft-keys';
import { useSaveState } from '@/lib/settings/use-save-state';

import { SaveStatus } from '../save-status';

/**
 * The word that summons Recoder in a comment. It saves when it loses focus
 * or on Enter; Escape puts the saved handle back. A handle that can't be
 * used, or one the server refused, shows why under the field and keeps the
 * text until it is edited.
 */
export function MentionHandleRow({ disabled }: { disabled: boolean }) {
	const saved = useAutoReview((state) => state.payload?.settings.mentionHandle ?? DEFAULT_MENTION_HANDLE);
	const [draft, setDraft] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const { state, track, clearFailure } = useSaveState();

	async function commit(text: string): Promise<void> {
		const invalid = handleError(text);

		if (invalid) return setError(invalid);

		const handle = text.trim();

		if (handle === saved) {
			setDraft(null);

			return setError(null);
		}

		const failure = await track(useAutoReview.getState().save({ mentionHandle: handle }));

		setError(failure);

		if (!failure) setDraft((now) => (now === text ? null : now));
	}

	function edit(text: string | null): void {
		setDraft(text);
		setError(null);
		clearFailure();
	}

	return (
		<div data-ui="settings-row" className="settings-row settings-limit">
			<Field label="Mention handle" hint="The word that summons Recoder in a comment" error={error}>
				<SaveStatus state={state} />
				<Input
					autoComplete="off"
					spellCheck={false}
					disabled={disabled}
					value={draft ?? saved}
					onChange={(event) => edit(event.target.value)}
					onBlur={() => {
						if (draft !== null) void commit(draft);
					}}
					onKeyDown={(event) =>
						draftKeys(
							event,
							draft,
							(text) => void commit(text),
							() => edit(null)
						)
					}
					className="settings-handle"
				/>
			</Field>
		</div>
	);
}
