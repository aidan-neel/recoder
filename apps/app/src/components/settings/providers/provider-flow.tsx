'use client';

import { Button, ModalBody, ModalClose, ModalFooter, ModalTitle, SwapText } from '@recoder/ui';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSettings } from '@/lib/settings/settings-store';

import { METHOD_FORM, MethodForm } from './method-form';
import { PickStep } from './pick-step';
import { SIGN_IN_FORM, SignInView } from './sign-in-view';
import { StepFrame } from './step-frame';
import { useProviderFlow, type ProviderFlow } from './use-provider-flow';

/** The body for where the flow stands. */
function FlowBody({ flow }: { flow: ProviderFlow }) {
	if (flow.view === 'pick') {
		return <PickStep query={flow.query} onQueryChange={flow.setQuery} onChoose={flow.choose} />;
	}

	if (flow.view === 'sign-in' && flow.attempt) return <SignInView flow={flow} attempt={flow.attempt} />;

	return <MethodForm flow={flow} />;
}

/** Back, Cancel, and the step's action: Connect, Sign in or Finish sign-in. */
function FlowFooter({ flow }: { flow: ProviderFlow }) {
	const form = flow.view === 'sign-in' ? SIGN_IN_FORM : METHOD_FORM;
	const pending = flow.status === 'pending';

	return (
		<ModalFooter>
			{flow.canGoBack ? (
				<Button variant="ghost" className="mr-auto" disabled={flow.sending} onClick={flow.back}>
					<ArrowLeft aria-hidden />
					Back
				</Button>
			) : null}
			<ModalClose>
				<Button variant="ghost" disabled={flow.sending}>
					Cancel
				</Button>
			</ModalClose>
			{flow.view === 'pick' ? null : (
				<Button
					variant="primary"
					type="submit"
					form={form}
					status={flow.status}
					successLabel="Connected"
					disabled={!flow.canSubmit && !pending}
				>
					{flow.submitLabel}
				</Button>
			)}
		</ModalFooter>
	);
}

interface ProviderFlowViewProps {
	/** Open straight on this provider's sign-in instead of the list. */
	providerId: string | null;
	close: () => void;
	/** Told whether a request is with the server, so the modal can hold still until it answers. */
	onSending: (sending: boolean) => void;
}

/**
 * The modal's content, mounted fresh each time it opens. It loads Settings
 * itself, so it works from first run as well as from Settings.
 */
export function ProviderFlowView({ providerId, close, onSending }: ProviderFlowViewProps) {
	const [preset] = useState(() =>
		providerId ? (useSettings.getState().providers.find((item) => item.id === providerId) ?? null) : null
	);

	const flow = useProviderFlow(preset, close);

	useEffect(() => {
		void useSettings.getState().load();
	}, []);

	useEffect(() => {
		onSending(flow.sending);

		return () => onSending(false);
	}, [flow.sending, onSending]);

	return (
		<>
			<ModalTitle>
				<SwapText>{flow.title}</SwapText>
			</ModalTitle>
			<ModalBody className="provider-body">
				<StepFrame step={flow.view} direction={flow.direction}>
					<FlowBody flow={flow} />
				</StepFrame>
			</ModalBody>
			<FlowFooter flow={flow} />
		</>
	);
}
