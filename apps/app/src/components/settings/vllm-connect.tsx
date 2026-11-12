'use client';

import { Button, Field, Input, Modal, ModalBody, ModalClose, ModalContent, ModalFooter, ModalTitle } from '@recoder/ui';
import { useEffect, type FormEvent } from 'react';

import { useHoldModal } from '@/lib/settings/use-hold-modal';
import { useVllmConnect } from '@/lib/settings/use-vllm-connect';

/** Joins the Connect button in the footer to the form in the body. */
const FORM_ID = 'vllm-connect';

interface ConnectFormProps {
	close: () => void;
	/** Tells the modal a request is with the server, so it holds still until the answer. */
	onSending: (sending: boolean) => void;
}

/** The form and its footer. It mounts with each open, so the fields start empty. */
function ConnectForm({ close, onSending }: ConnectFormProps) {
	const flow = useVllmConnect(close);

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
			<ModalTitle>Connect a vLLM server</ModalTitle>
			<ModalBody>
				<form id={FORM_ID} className="server-form" onSubmit={submit}>
					<Field label="Server address" hint="Recoder adds /v1 for you." error={flow.error}>
						<Input
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
					form={FORM_ID}
					status={flow.status}
					successLabel="Connected"
					disabled={!flow.canSubmit && !flow.sending}
				>
					Connect
				</Button>
			</ModalFooter>
		</>
	);
}

interface VllmConnectModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/**
 * Connect a vLLM server: its address, and a key when it has one. Recoder
 * lists the server's models to check the address. While the server is being
 * asked the modal holds still, so it has no X: Cancel closes it.
 */
export function VllmConnectModal({ open, onOpenChange }: VllmConnectModalProps) {
	const hold = useHoldModal(onOpenChange);

	return (
		<Modal open={open} onOpenChange={hold.changeOpen}>
			<ModalContent size="md" showClose={false}>
				<ConnectForm close={() => onOpenChange(false)} onSending={hold.setSending} />
			</ModalContent>
		</Modal>
	);
}
