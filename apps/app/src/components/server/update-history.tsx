'use client';

import type { LogPage, UpdateHistoryEntry } from '@recoder/shared';
import { Button, ConfirmDialog, Modal, ModalBody, ModalContent, ModalTitle, Pill, Spinner } from '@recoder/ui';
import { useEffect, useState } from 'react';

import { useApi } from '@/lib/api/client';
import { failureText } from '@/lib/api/http';
import { historyLine, useUpdateHistory } from '@/lib/update/use-update-history';

import { SettingsGroup, SettingsRow } from '@/components/settings/settings-group';

import { LogLines } from './log-lines';

/** What the updater wrote while it installed one version, read when the dialog opens. */
function HistoryLog({ entry, onClose }: { entry: UpdateHistoryEntry; onClose: () => void }) {
	const { update } = useApi();
	const [page, setPage] = useState<LogPage | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		update.historyLog(entry.id).then(setPage, (failure: unknown) => setError(failureText(failure)));
	}, [update, entry.id]);

	return (
		<Modal open onOpenChange={(open) => !open && onClose()}>
			<ModalContent size="lg">
				<ModalTitle context="Updates">{`Recoder ${entry.version}`}</ModalTitle>
				<ModalBody>
					{error ? <p role="alert">{error}</p> : null}
					{!page && !error ? <Spinner /> : null}
					{page ? <LogLines lines={[...page.lines].reverse()} label={`The update to ${entry.version}`} /> : null}
				</ModalBody>
			</ModalContent>
		</Modal>
	);
}

/** The end of a version's row: Running, Rolled back or Failed, or Roll back to it when the updater can. */
function EntryEnd({ entry, onRollback }: { entry: UpdateHistoryEntry; onRollback: () => void }) {
	switch (entry.outcome) {
		case 'running':
			return <Pill tone="ok">Running</Pill>;
		case 'rolled-back':
			return <Pill tone="medium">Rolled back</Pill>;
		case 'failed':
			return <Pill tone="danger">Failed</Pill>;
		case 'replaced':
			return entry.rollback === 'none' ? null : (
				<Button variant="ghost" onClick={onRollback}>
					Roll back
				</Button>
			);
	}
}

/** The versions this install has run, each with its log, and a way back to one the updater kept. */
export function UpdateHistory() {
	const history = useUpdateHistory();
	const [log, setLog] = useState<UpdateHistoryEntry | null>(null);
	const [back, setBack] = useState<UpdateHistoryEntry | null>(null);

	if (!history.entries || history.entries.length === 0) return null;

	return (
		<SettingsGroup title="History">
			{history.entries.map((entry) => (
				<SettingsRow key={entry.id} name={entry.version} detail={historyLine(entry)}>
					<Button variant="ghost" onClick={() => setLog(entry)}>
						Log
					</Button>
					<EntryEnd entry={entry} onRollback={() => setBack(entry)} />
				</SettingsRow>
			))}
			{log ? <HistoryLog entry={log} onClose={() => setLog(null)} /> : null}
			<ConfirmDialog
				open={back !== null}
				onOpenChange={(open) => {
					if (!open) setBack(null);
				}}
				title={`Roll back to ${back?.version ?? ''}?`}
				description={
					back?.rollback === 'restore'
						? 'Recoder restores the backup made before the next update. Anything since then is lost.'
						: 'Recoder starts the earlier version on the same data. Running reviews pause and resume.'
				}
				confirmLabel="Roll back"
				onConfirm={async () => {
					if (back) await history.rollback(back.version);
				}}
			/>
		</SettingsGroup>
	);
}
