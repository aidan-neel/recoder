'use client';

import type { SetupStep as Step } from '@recoder/shared';
import {
	Button,
	Checkbox,
	Field,
	Input,
	Modal,
	ModalBody,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalTitle,
	Spinner
} from '@recoder/ui';
import { useId, type FormEvent } from 'react';

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

/** The PostgreSQL move: a URL tried before anything moves, and whether the built-in data goes with it. */
function PostgresModal({ dialog }: { dialog: PostgresDialog }) {
	const copyId = useId();
	const ready = dialog.tested?.ok === true;

	function submit(event: FormEvent): void {
		event.preventDefault();
		if (ready) dialog.move();
		else dialog.test();
	}

	return (
		<Modal open={dialog.open} onOpenChange={dialog.setOpen}>
			<ModalContent size="md">
				<ModalTitle context="Set up Recoder">Use PostgreSQL</ModalTitle>
				<ModalBody>
					<form id={POSTGRES_FORM} className="setup-form" noValidate onSubmit={submit}>
						<Field
							label="Connection URL"
							hint={
								dialog.tested?.ok
									? `PostgreSQL ${dialog.tested.version ?? ''} answered.`.replace('  ', ' ')
									: 'Sealed with this server’s key before it is saved.'
							}
							error={dialog.error ?? undefined}
						>
							<Input
								type="password"
								value={dialog.url}
								placeholder="postgresql://recoder@db.example.com/recoder"
								autoComplete="off"
								spellCheck={false}
								onChange={(event) => dialog.setUrl(event.target.value)}
							/>
						</Field>
						<label className="setup-check" htmlFor={copyId}>
							<Checkbox
								id={copyId}
								checked={dialog.copy}
								onCheckedChange={(checked) => dialog.setCopy(checked === true)}
							/>
							Copy what the built-in database holds
						</label>
						<p className="setup-modal-note">Recoder restarts on PostgreSQL, which takes about a minute.</p>
					</form>
				</ModalBody>
				<ModalFooter>
					<ModalClose>
						<Button variant="ghost">Cancel</Button>
					</ModalClose>
					<Button
						variant={ready ? 'outline' : 'primary'}
						onClick={dialog.test}
						status={dialog.testStatus}
						disabled={!dialog.url.trim()}
					>
						Test
					</Button>
					{ready ? (
						<Button variant="primary" type="submit" form={POSTGRES_FORM} status={dialog.moveStatus}>
							Move to PostgreSQL
						</Button>
					) : null}
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}

/** Step six: where the data lives, the built-in database unless the person moves it to PostgreSQL. */
export function StorageStep({ step, current }: StepProps) {
	const view = useStorageStep(step.done);

	return (
		<SetupStep
			name="Storage"
			step={step}
			current={current}
			hint="Built-in database on this server"
			body={
				view.moving ? (
					<p className="setup-text setup-waiting">
						<Spinner /> Moving to PostgreSQL. Recoder restarts and comes back here.
					</p>
				) : (
					<>
						<p className="setup-text">
							Reviews, settings and sealed credentials stay in a database on this server. Use PostgreSQL to run more
							than one Recoder server on the same data.
						</p>
						<div className="setup-actions">
							<Button variant="primary" onClick={view.useBuiltin} status={view.builtinStatus}>
								Use the built-in database
							</Button>
							<Button variant="outline" onClick={() => view.postgres.setOpen(true)}>
								Use PostgreSQL
							</Button>
						</div>
						<PostgresModal dialog={view.postgres} />
					</>
				)
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
