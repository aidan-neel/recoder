import { Button, ConfirmDialog } from '@recoder/ui';
import { useState } from 'react';

import { restartsServer } from '@/lib/update/update-line';
import type { UpdateStrip } from '@/lib/update/use-update-strip';

type ReadyStrip = Extract<UpdateStrip, { view: 'ready' }>;

/** The strip's button: Check when current, Update when one waits, and Retry or Reload where the line asks. */
export function UpdateAction({ strip }: { strip: ReadyStrip }) {
	const { line, busy, actions } = strip;

	switch (line.kind) {
		case 'managed':
			return null;
		case 'progress':
			return (
				<Button variant="primary" status="pending" disabled>
					Update
				</Button>
			);
		case 'available':
			return <UpdateButton strip={strip} disabled={line.blockedReason !== null} />;
		case 'failed':
			return (
				<Button variant="outline" onClick={() => actions.retry(line.retry)}>
					Retry
				</Button>
			);
		case 'updated':
			return line.canReload ? (
				<Button variant="quiet" onClick={() => window.location.reload()}>
					Reload
				</Button>
			) : (
				<Button variant="quiet" onClick={actions.check}>
					Check
				</Button>
			);
		case 'current':
		case 'checking':
			return (
				<Button variant="quiet" status={busy ? 'pending' : 'idle'} onClick={actions.check}>
					Check
				</Button>
			);
	}
}

/** The primary Update button. It asks once first, and says what the update will do. */
function UpdateButton({ strip, disabled }: { strip: ReadyStrip; disabled: boolean }) {
	const [asking, setAsking] = useState(false);
	const restarts = restartsServer(strip.status.available);

	return (
		<>
			<Button variant="primary" disabled={disabled} onClick={() => setAsking(true)}>
				Update
			</Button>
			<ConfirmDialog
				open={asking}
				onOpenChange={setAsking}
				title="Update Recoder?"
				description={
					restarts
						? 'Running reviews pause while the server restarts, then resume.'
						: 'The web app updates. Running reviews keep going.'
				}
				confirmLabel="Update"
				onConfirm={strip.actions.apply}
			/>
		</>
	);
}
