'use client';

import { Button, Field, Input, Modal, ModalBody, ModalClose, ModalContent, ModalFooter, ModalTitle } from '@recoder/ui';
import { useId, type FormEvent } from 'react';

import type { Forge } from '@/lib/api/connections';
import type { TokenDialog } from '@/lib/connections/use-token-dialog';
import { useTokenModal, type TokenModalView } from '@/lib/connections/use-token-modal';

/** The GitLab URL field, for a self-managed GitLab. It starts from the saved host. */
function HostField({ view }: { view: TokenModalView }) {
	return (
		<Field
			label="GitLab URL"
			hint="Leave blank for gitlab.com."
			error={view.error?.field === 'host' ? view.error.text : undefined}
		>
			<Input
				value={view.host}
				placeholder="gitlab.com"
				autoComplete="off"
				spellCheck={false}
				readOnly={view.pending}
				onChange={(event) => view.setHost(event.target.value)}
			/>
		</Field>
	);
}

/** The token field. It always starts empty: a saved token is never sent back to the page. */
function TokenField({ view }: { view: TokenModalView }) {
	return (
		<Field
			label="Personal access token"
			hint={view.tokenHint}
			error={view.error?.field === 'token' ? view.error.text : undefined}
		>
			<Input
				type="password"
				value={view.token}
				placeholder={view.info.placeholder}
				autoComplete="off"
				spellCheck={false}
				readOnly={view.pending}
				onChange={(event) => view.setToken(event.target.value)}
			/>
		</Field>
	);
}

interface TokenPanelProps {
	forge: Forge;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * One opening of the dialog. It has no X: while the server checks the token
 * the dialog stays open, and an X that did nothing would look broken. Cancel
 * closes it.
 */
function TokenPanel({ forge, open, onOpenChange }: TokenPanelProps) {
	const view = useTokenModal(forge, onOpenChange);
	const formId = useId();

	function submit(event: FormEvent): void {
		event.preventDefault();
		view.submit();
	}

	return (
		<Modal open={open} onOpenChange={view.changeOpen}>
			<ModalContent size="sm" showClose={false}>
				<ModalTitle>Connect {view.info.label}</ModalTitle>
				<ModalBody>
					<form id={formId} className="token-form" noValidate onSubmit={submit}>
						{view.info.id === 'gitlab' ? <HostField view={view} /> : null}
						<TokenField view={view} />
					</form>
				</ModalBody>
				<ModalFooter>
					<ModalClose>
						<Button variant="ghost" disabled={view.pending}>
							Cancel
						</Button>
					</ModalClose>
					<Button type="submit" form={formId} variant="primary" status={view.status} disabled={!view.canSubmit}>
						Connect
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}

/**
 * Connects GitHub or GitLab with a personal access token. Pass it the object
 * `useTokenDialog()` returns; each opening mounts a fresh dialog, so no check
 * or timer from an earlier opening reaches the next.
 */
export function TokenModal({ dialog }: { dialog: TokenDialog }) {
	return <TokenPanel key={dialog.opening} forge={dialog.forge} open={dialog.open} onOpenChange={dialog.setOpen} />;
}
