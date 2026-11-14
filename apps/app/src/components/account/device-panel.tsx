'use client';

import { Button, CopyButton, Spinner, StatusGlyph } from '@recoder/ui';

import { forgeLabel } from '@/lib/connections/forges';
import type { ActiveSignIn, DeviceSignInView } from '@/lib/account/use-device-sign-in';

/** The code to type on the forge, large, with its copy button and the forge's page one press away. */
function Code({ code, uri, forge }: { code: string; uri: string; forge: string }) {
	return (
		<>
			<div className="device-code">
				<span className="device-code-text" aria-label={`Your code is ${code}`}>
					{code}
				</span>
				<CopyButton value={code} label="Copy code" />
			</div>
			<Button variant="primary" className="device-open" asChild>
				<a href={uri} target="_blank" rel="noopener noreferrer">
					Open {forge}
				</a>
			</Button>
		</>
	);
}

/** Where an attempt that is waiting stands. */
function Waiting({ forge }: { forge: string }) {
	return (
		<p className="device-wait" role="status">
			<Spinner />
			Waiting for {forge}
		</p>
	);
}

/** The reason a sign-in ended, when the server gave one. */
function Reason({ state }: { state: ActiveSignIn }) {
	if (state.phase !== 'failed') return null;

	return (
		<p className="device-reason" role="alert">
			{state.reason}
		</p>
	);
}

interface DevicePanelProps {
	state: ActiveSignIn;
	view: DeviceSignInView;
}

/**
 * The body of a device sign-in, on the screen and in the link dialog: the
 * code with its copy button and the forge's page while the person answers
 * there, then how it ended. An ended attempt offers a new one and the way
 * back to the forges; a signed-in one says who.
 */
export function DevicePanel({ state, view }: DevicePanelProps) {
	const forge = forgeLabel(state.input.provider);

	if (state.phase === 'pending') {
		return (
			<div className="device">
				<Code code={state.code.userCode} uri={state.code.verificationUri} forge={forge} />
				<Waiting forge={forge} />
				<Button variant="ghost" onClick={view.reset}>
					Back
				</Button>
			</div>
		);
	}

	if (state.phase === 'starting') {
		return (
			<div className="device">
				<Waiting forge={forge} />
			</div>
		);
	}

	if (state.phase === 'signed-in') {
		return (
			<div className="device">
				<p className="device-done" role="status">
					<StatusGlyph kind="ok" label="Signed in" />
					{forge} is connected
				</p>
			</div>
		);
	}

	return (
		<div className="device">
			<Reason state={state} />
			<Button variant="primary" onClick={() => view.start(state.input)}>
				Start again
			</Button>
			<Button variant="ghost" onClick={view.reset}>
				Back
			</Button>
		</div>
	);
}
