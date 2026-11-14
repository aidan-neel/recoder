'use client';

import { Button, Field, Input } from '@recoder/ui';
import { useState, type FormEvent } from 'react';

import { failureText } from '@/lib/api/http';
import { useAction } from '@/lib/shell/use-action';

interface SetupCodeFormProps {
	/** Sends the code; rejects when the server refuses it. */
	onSubmit: (code: string) => Promise<void>;
}

/** The code a sign-in hands back, pasted here, with Submit. */
export function SetupCodeForm({ onSubmit }: SetupCodeFormProps) {
	const [code, setCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const send = useAction();

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();

		if (!code.trim()) return;

		setError(null);

		send.run(() =>
			onSubmit(code.trim()).catch((failure: unknown) => {
				setError(failureText(failure));

				throw failure;
			})
		);
	}

	return (
		<form className="setup-code" onSubmit={submit}>
			<Field label="Paste the code" error={error}>
				<Input autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />
			</Field>
			<Button type="submit" variant="outline" status={send.status}>
				Submit
			</Button>
		</form>
	);
}
