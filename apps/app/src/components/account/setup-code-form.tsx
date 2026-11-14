'use client';

import { Button, Field, Input } from '@recoder/ui';
import { useEffect, useRef, type FormEvent } from 'react';

import { useUnlockSetup } from '@/lib/account/use-unlock-setup';
import type { AuthApi } from '@/lib/api/accounts';

/** The first step of a locked setup: the code the server printed, and Continue. */
export function SetupCodeForm({ api }: { api: AuthApi }) {
	const view = useUnlockSetup(api);
	const field = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (view.refused > 0) field.current?.select();
	}, [view.refused]);

	function submit(event: FormEvent): void {
		event.preventDefault();
		view.submit();
	}

	return (
		<form className="forge-choices" noValidate onSubmit={submit}>
			<Field label="Setup code" error={view.error ?? undefined}>
				<Input
					ref={field}
					value={view.code}
					autoComplete="off"
					autoFocus
					spellCheck={false}
					readOnly={view.status === 'pending'}
					onChange={(event) => view.setCode(event.target.value)}
				/>
			</Field>
			<Button
				type="submit"
				variant="primary"
				className="forge-continue"
				status={view.status}
				disabled={!view.code.trim()}
			>
				Continue
			</Button>
		</form>
	);
}
