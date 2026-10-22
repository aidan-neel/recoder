'use client';

import { Button, Field, Input } from '@recoder/ui';
import { useState, type FormEvent, type Ref } from 'react';

import { trackedKeys, useConnections } from '@/lib/connections/connections-store';
import { parseRepoInput, repoKey } from '@/lib/connections/repo-input';

import { useAddRepo } from './use-add-repo';

/**
 * Tracks a repository from what someone pastes: `owner/name`, a link to it
 * or to any page in it, or an SSH address. A typo shows under the field
 * before anything reaches the server. `inputRef` lets the dialog focus it.
 */
export function AddByUrl({ inputRef }: { inputRef: Ref<HTMLInputElement> }) {
	const gitlabHost = useConnections((state) => state.auth?.gitlab.host ?? null);
	const [text, setText] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [added, setAdded] = useState<string | null>(null);
	const [status, add] = useAddRepo();

	async function submit(event: FormEvent): Promise<void> {
		event.preventDefault();

		if (status === 'pending') return;

		const parsed = parseRepoInput(text, gitlabHost);

		if (!parsed.ok) return setError(parsed.error);

		if (trackedKeys(useConnections.getState().repos).has(repoKey(parsed.repo.url))) {
			return setError(`Already tracking ${parsed.repo.name}.`);
		}

		const result = await add(parsed.repo);

		if ('error' in result) return setError(result.error);

		setText('');
		setAdded(result.repo.name);
	}

	return (
		<form className="add-url" noValidate onSubmit={(event) => void submit(event)}>
			<Field
				label="Add by URL"
				hint={added ? `Now tracking ${added}.` : 'A GitHub or GitLab repository.'}
				error={error ?? undefined}
			>
				<div className="add-url-row">
					<Input
						ref={inputRef}
						value={text}
						placeholder="owner/name or a repository link"
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => {
							setText(event.target.value);
							setError(null);
							setAdded(null);
						}}
					/>
					<Button type="submit" variant="outline" status={status} disabled={!text.trim() && status === 'idle'}>
						Add
					</Button>
				</div>
			</Field>
		</form>
	);
}
