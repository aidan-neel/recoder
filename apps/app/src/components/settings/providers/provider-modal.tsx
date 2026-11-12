'use client';

import { Button, Modal, ModalBody, ModalClose, ModalContent, ModalFooter, ModalTitle, SwapText } from '@recoder/ui';
import { ArrowLeft } from 'lucide-react';

import type { ProviderFlow } from '@/lib/settings/providers/use-provider-flow';
import type { ProviderHost } from '@/lib/settings/use-agent-section';
import { useProviderFlowView } from '@/lib/settings/providers/use-provider-modal';
import { useHoldModal } from '@/lib/settings/use-hold-modal';

import { MethodForm } from './method-form';
import { PickStep } from './pick-step';
import { ProviderSteps } from './provider-steps';
import { SignInView } from './sign-in-view';

/** The body for where the flow stands. */
function FlowBody({ flow }: { flow: ProviderFlow }) {
	if (flow.view === 'pick') {
		return <PickStep query={flow.query} onQueryChange={flow.setQuery} onChoose={flow.choose} />;
	}

	if (flow.view === 'sign-in' && flow.attempt) return <SignInView flow={flow} attempt={flow.attempt} />;

	return <MethodForm flow={flow} />;
}

/** Back, Cancel, and the step's action: Connect, Sign in or Finish sign-in. The list has no action of its own. */
function FlowFooter({ flow }: { flow: ProviderFlow }) {
	return (
		<ModalFooter>
			{flow.canGoBack ? (
				<Button variant="ghost" className="provider-back" disabled={flow.sending} onClick={flow.back}>
					<ArrowLeft aria-hidden />
					Back
				</Button>
			) : null}
			<ModalClose>
				<Button variant="ghost" disabled={flow.sending}>
					Cancel
				</Button>
			</ModalClose>
			{flow.formId ? (
				<Button
					variant="primary"
					type="submit"
					form={flow.formId}
					status={flow.status}
					successLabel="Connected"
					disabled={!flow.canSubmit && flow.status !== 'pending'}
				>
					{flow.submitLabel}
				</Button>
			) : null}
		</ModalFooter>
	);
}

interface FlowPanelProps {
	/** Open straight on this provider's sign-in instead of the list; null for the list. */
	providerId: string | null;
	close: () => void;
	/** Told whether a request is with the server, so the dialog can hold still until it answers. */
	onSending: (sending: boolean) => void;
}

/** The dialog's content, mounted fresh each time it opens: the title, the step on screen, and the footer. */
function FlowPanel({ providerId, close, onSending }: FlowPanelProps) {
	const { flow } = useProviderFlowView({ providerId, close, onSending });

	return (
		<>
			<ModalTitle>
				<SwapText>{flow.title}</SwapText>
			</ModalTitle>
			<ModalBody>
				<ProviderSteps step={flow.view} direction={flow.direction}>
					<FlowBody flow={flow} />
				</ProviderSteps>
			</ModalBody>
			<FlowFooter flow={flow} />
		</>
	);
}

/**
 * Adds a model provider to the agent: pick one, then sign in or paste a key.
 * It takes a provider host (`open`, `providerId`, `onOpenChange`) and loads
 * Settings itself, so it works from first run as well as from Settings;
 * `providerId` opens straight on that provider's sign-in. Closing it cancels
 * a sign-in that is still running. While a key or a code is with the server
 * it stays open (Escape, a click outside and Cancel wait for the answer), so
 * it has no X that would look live but do nothing; Cancel closes it.
 */
export function ProviderModal({ open, providerId, onOpenChange }: ProviderHost) {
	const hold = useHoldModal(onOpenChange);

	return (
		<Modal open={open} onOpenChange={hold.changeOpen}>
			<ModalContent size="md" showClose={false}>
				<FlowPanel providerId={providerId} close={() => onOpenChange(false)} onSending={hold.setSending} />
			</ModalContent>
		</Modal>
	);
}
