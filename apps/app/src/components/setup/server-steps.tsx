'use client';

import type { SetupStep as Step } from '@recoder/shared';
import { Button, Field, Input, Modal, ModalBody, ModalClose, ModalContent, ModalFooter, ModalTitle } from '@recoder/ui';
import type { FormEvent } from 'react';

import { anyFailed } from '@/lib/server/checks';
import { useChecks } from '@/lib/server/use-checks';
import { useStorageStep, type PostgresDialog } from '@/lib/setup/use-storage-step';
import { useChecklist } from '@/lib/setup/checklist-store';
import { setupApi } from '@/lib/api/setup';
import { useAction } from '@/lib/shell/use-action';

import { CheckList } from '@/components/server/check-list';

import { SetupStep } from './setup-step';

interface StepProps {
	step: Step;
	current: boolean;
}

const POSTGRES_FORM = 'setup-postgres';

/** Where the offline move to PostgreSQL is written down, step by step. */
const POSTGRES_GUIDE =
	'https://github.com/aidan-neel/recoder/blob/main/docs/ha-operating.md#import-a-standalone-installation';

/** The offline move, in short, once the database has answered; the guide has the commands. */
function PostgresSteps({ version }: { version: string | undefined }) {
	return (
		<div className="setup-form">
			<p className="setup-text">
				{version ? `PostgreSQL ${version} answered.` : 'PostgreSQL answered.'} Recoder moves to it while it is stopped:
			</p>
			<ol className="setup-moves">
				<li>Stop Recoder and back up its data directory.</li>
				<li>Set RECODER_DATABASE_URL to this database and RECODER_SECRET_KEY to this server’s key.</li>
				<li>Run the import, then start Recoder again.</li>
			</ol>
			<p className="setup-modal-note">Until then, finish setup on the built-in database.</p>
		</div>
	);
}

/** PostgreSQL: a URL tried here, then the offline move, since a running install cannot switch from the browser. */
function PostgresModal({ dialog }: { dialog: PostgresDialog }) {
	const answered = dialog.tested?.ok === true;

	function submit(event: FormEvent): void {
		event.preventDefault();
		dialog.test();
	}

	return (
		<Modal open={dialog.open} onOpenChange={dialog.setOpen}>
			<ModalContent size="md">
				<ModalTitle context="Set up Recoder">PostgreSQL</ModalTitle>
				<ModalBody>
					{answered ? (
						<PostgresSteps version={dialog.tested?.version} />
					) : (
						<form id={POSTGRES_FORM} className="setup-form" noValidate onSubmit={submit}>
							<p className="setup-text">
								PostgreSQL lets more than one Recoder server run on the same data. Try the database first.
							</p>
							<Field label="Connection URL" error={dialog.error ?? undefined}>
								<Input
									type="password"
									value={dialog.url}
									placeholder="postgresql://recoder@db.example.com/recoder"
									autoComplete="off"
									spellCheck={false}
									onChange={(event) => dialog.setUrl(event.target.value)}
								/>
							</Field>
						</form>
					)}
				</ModalBody>
				<ModalFooter>
					<ModalClose>
						<Button variant="ghost">Close</Button>
					</ModalClose>
					{answered ? (
						<Button variant="primary" asChild>
							<a href={POSTGRES_GUIDE} target="_blank" rel="noreferrer">
								Open the guide
							</a>
						</Button>
					) : (
						<Button
							variant="primary"
							type="submit"
							form={POSTGRES_FORM}
							status={dialog.testStatus}
							disabled={!dialog.url.trim()}
						>
							Test
						</Button>
					)}
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}

/** Step six: where the data lives. The built-in database finishes it; PostgreSQL is an offline move for later. */
export function StorageStep({ step, current }: StepProps) {
	const view = useStorageStep();

	return (
		<SetupStep
			name="Storage"
			step={step}
			current={current}
			hint="Built-in database on this server"
			body={
				<>
					<p className="setup-text">
						Reviews, settings and sealed credentials stay in a database on this server. To run more than one Recoder
						server on the same data, move to PostgreSQL later.
					</p>
					<div className="setup-actions">
						<Button variant="primary" onClick={view.useBuiltin} status={view.builtinStatus}>
							Use the built-in database
						</Button>
						<Button variant="ghost" onClick={() => view.postgres.setOpen(true)}>
							About PostgreSQL
						</Button>
					</div>
					<PostgresModal dialog={view.postgres} />
				</>
			}
		/>
	);
}

/** The checks' list and the step's way out: Finish, once nothing failed. */
function CheckBody() {
	const checks = useChecks(true);
	const finish = useAction();
	const blocked = !checks.checks || checks.running || anyFailed(checks.checks.checks);

	return (
		<>
			<CheckList view={checks} />
			<div className="setup-actions">
				<Button
					variant="primary"
					status={finish.status}
					disabled={blocked}
					onClick={() => finish.run(async () => useChecklist.getState().take(await setupApi.finish()))}
				>
					Finish
				</Button>
				<Button variant="ghost" onClick={checks.run} disabled={checks.running}>
					Run again
				</Button>
			</div>
		</>
	);
}

/** Step seven: the server checks itself, and setup finishes once nothing failed. */
export function CheckStep({ step, current }: StepProps) {
	return (
		<SetupStep
			name="Check the server"
			step={step}
			current={current}
			hint="HTTPS, forge, model and disk"
			body={current ? <CheckBody /> : null}
		/>
	);
}
