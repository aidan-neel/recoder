'use client';

import {
	Button,
	Field,
	Input,
	Modal,
	ModalBody,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalTitle,
	type ButtonStatus
} from '@recoder/ui';
import { useEffect, useEffectEvent, useId, useState, type FormEvent } from 'react';

import type { Forge } from '@/lib/api/connections';
import { ApiError, failureText } from '@/lib/api/http';
import { useConnections } from '@/lib/connections/connections-store';
import { FORGES, type ForgeInfo } from '@/lib/connections/forges';

/** How long "Done" shows on the button before the dialog closes. */
const SUCCESS_MS = 700;

/** Where the server keeps a token (`apps/server/src/forge/tokens.ts`). */
const STORED = 'Saved to tokens.json in the server’s data folder.';

interface TokenModalProps {
	forge: Forge;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Which field a rejection belongs to, and what it says. */
interface Rejection {
	field: 'token' | 'host';
	text: string;
}

function rejection(error: unknown): Rejection {
	const field = error instanceof ApiError && error.kind === 'host' ? 'host' : 'token';

	return { field, text: failureText(error, 'The forge rejected that token.') };
}

interface TokenFormProps {
	forge: ForgeInfo;
	status: ButtonStatus;
	onStatus: (status: ButtonStatus) => void;
}

/**
 * The form. The server checks the token with the forge before it keeps it;
 * a rejection lands under the field it is about. While the check runs the
 * fields are read-only and Cancel waits.
 */
function TokenForm({ forge, status, onStatus }: TokenFormProps) {
	const formId = useId();
	const savedHost = useConnections((state) => state.auth?.gitlab.host ?? '');
	const [token, setToken] = useState('');
	const [host, setHost] = useState(savedHost);
	const [error, setError] = useState<Rejection | null>(null);
	const pending = status === 'pending';
	const gitlab = forge.id === 'gitlab';

	async function submit(event: FormEvent): Promise<void> {
		event.preventDefault();

		if (!token.trim() || status !== 'idle') return;

		onStatus('pending');
		setError(null);

		try {
			await useConnections.getState().saveToken(forge.id, token.trim(), gitlab ? host.trim() : undefined);
			onStatus('success');
		} catch (failure) {
			onStatus('idle');
			setError(rejection(failure));
		}
	}

	return (
		<>
			<ModalTitle>Connect {forge.label}</ModalTitle>
			<ModalBody>
				<form id={formId} className="token-form" onSubmit={(event) => void submit(event)}>
					{gitlab ? (
						<Field
							label="GitLab URL"
							hint="Leave blank for gitlab.com."
							error={error?.field === 'host' ? error.text : undefined}
						>
							<Input
								value={host}
								placeholder="gitlab.com"
								autoComplete="off"
								spellCheck={false}
								readOnly={pending}
								onChange={(event) => {
									setHost(event.target.value);
									setError(null);
								}}
							/>
						</Field>
					) : null}
					<Field
						label="Personal access token"
						className="token-field"
						hint={`${forge.scope} ${STORED}`}
						error={error?.field === 'token' ? error.text : undefined}
					>
						<Input
							type="password"
							value={token}
							placeholder={forge.placeholder}
							autoComplete="off"
							spellCheck={false}
							readOnly={pending}
							onChange={(event) => {
								setToken(event.target.value);
								setError(null);
							}}
						/>
					</Field>
				</form>
			</ModalBody>
			<ModalFooter>
				<ModalClose>
					<Button variant="ghost" disabled={pending}>
						Cancel
					</Button>
				</ModalClose>
				<Button
					type="submit"
					form={formId}
					variant="primary"
					status={status}
					disabled={!token.trim() && status === 'idle'}
				>
					Connect
				</Button>
			</ModalFooter>
		</>
	);
}

/**
 * Connect GitHub or GitLab with a personal access token. It stays open while
 * the check runs (Escape, a click outside and Cancel wait for the answer), so
 * it has no X that would look live but do nothing; Cancel closes it. It
 * closes a beat after the check face. Mount one per opening, so no timer from
 * an earlier opening can close it.
 */
export function TokenModal({ forge, open, onOpenChange }: TokenModalProps) {
	const info = FORGES.find((item) => item.id === forge) ?? FORGES[0];
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const close = useEffectEvent(() => onOpenChange(false));

	useEffect(() => {
		if (status !== 'success') return;

		const timer = setTimeout(close, SUCCESS_MS);

		return () => clearTimeout(timer);
	}, [status]);

	return (
		<Modal
			open={open}
			onOpenChange={(next) => {
				if (next || status !== 'pending') onOpenChange(next);
			}}
		>
			<ModalContent size="sm" showClose={false}>
				<TokenForm forge={info} status={status} onStatus={setStatus} />
			</ModalContent>
		</Modal>
	);
}
