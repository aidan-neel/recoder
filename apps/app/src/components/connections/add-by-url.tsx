'use client';

import { Button, Field, Input } from '@recoder/ui';
import type { FormEvent, Ref } from 'react';

import type { AddByUrl as AddByUrlState } from '@/lib/connections/use-add-by-url';

interface AddByUrlProps {
	url: AddByUrlState;
	/** The field, so the dialog can put focus on it. */
	inputRef: Ref<HTMLInputElement>;
}

/**
 * Tracks a repository from what someone pastes: `owner/name`, a link or an
 * SSH address. A refusal shows under the field; a success names the
 * repository there. The button's faces are icons only, because the line
 * under the field already says what happened.
 */
export function AddByUrl({ url, inputRef }: AddByUrlProps) {
	function submit(event: FormEvent): void {
		event.preventDefault();
		void url.submit();
	}

	return (
		<form className="add-url" noValidate onSubmit={submit}>
			<Field
				label="Add by URL"
				hint={url.added ? `Now tracking ${url.added}.` : 'A GitHub or GitLab repository.'}
				error={url.error ?? undefined}
			>
				<div className="add-url-row">
					<Input
						ref={inputRef}
						value={url.text}
						placeholder="owner/name or a repository link"
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => url.setText(event.target.value)}
					/>
					<Button type="submit" variant="outline" status={url.status} disabled={!url.canSubmit}>
						Add
					</Button>
				</div>
			</Field>
		</form>
	);
}
