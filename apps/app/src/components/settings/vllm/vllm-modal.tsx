'use client';

import { Button, Field, Input, ModalBody, ModalClose, ModalFooter, ModalTitle } from '@recoder/ui';
import { useEffect, useRef, type FormEvent } from 'react';

import { HoldModal } from '../hold-modal';
import { useVllmConnect } from './use-vllm-connect';

const FORM = 'vllm-connect';

interface VllmModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** The form and its footer, mounted fresh each time the modal opens. */
function ConnectForm({ close, onSending }: { close: () => void; onSending: (sending: boolean) => void }) {
	const flow = useVllmConnect(close);
	const address = useRef<HTMLInputElement>(null);

	useEffect(() => {
		address.current?.focus();
	}, []);

	useEffect(() => {
		onSending(flow.sending);

		return () => onSending(false);
	}, [flow.sending, onSending]);

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		flow.submit();
	}

	return (
		<>
			<ModalTitle>Connect vLLM server</ModalTitle>
			<ModalBody>
				<form id={FORM} className="vllm-form" onSubmit={submit}>
					<Field label="Server address" hint="Recoder adds /v1 for you." error={flow.error}>
						<Input
							ref={address}
							placeholder="http://vllm.internal:8000"
							autoComplete="off"
							spellCheck={false}
							inputMode="url"
							value={flow.address}
							readOnly={flow.sending}
							onChange={(event) => flow.setAddress(event.target.value)}
						/>
					</Field>
					<Field label="API key" hint="Only if the server was started with --api-key. Saved on this machine.">
						<Input
							type="password"
							placeholder="Optional"
							autoComplete="off"
							spellCheck={false}
							value={flow.key}
							readOnly={flow.sending}
							onChange={(event) => flow.setKey(event.target.value)}
						/>
					</Field>
				</form>
			</ModalBody>
			<ModalFooter>
				<ModalClose>
					<Button variant="ghost" disabled={flow.sending}>
						Cancel
					</Button>
				</ModalClose>
				<Button
					variant="primary"
					type="submit"
					form={FORM}
					status={flow.status}
					successLabel="Connected"
					disabled={!flow.canSubmit && flow.status !== 'pending'}
				>
					Connect
				</Button>
			</ModalFooter>
		</>
	);
}

/**
 * Connect a vLLM server: its address, and a key when it has one. Recoder lists
 * the server's models to check them, and keeps that list in step from then on.
 * While the server is being asked the modal holds still, as the provider modal does.
 */
export function VllmModal({ open, onOpenChange }: VllmModalProps) {
	return (
		<HoldModal open={open} onOpenChange={onOpenChange}>
			{(onSending) => <ConnectForm close={() => onOpenChange(false)} onSending={onSending} />}
		</HoldModal>
	);
}
