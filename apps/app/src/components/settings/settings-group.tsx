import { Card } from '@recoder/ui';
import { useId, type ReactNode } from 'react';

import type { SaveState } from '@/lib/settings/use-save-state';

import { SaveStatus } from './save-status';

interface SettingsGroupProps {
	title: string;
	/** At the right of the title: the group's own action, such as Add. */
	action?: ReactNode;
	/** A quiet line under the card: where the settings are saved, what a limit means. */
	note?: ReactNode;
	children: ReactNode;
}

/** A titled card of settings rows. */
export function SettingsGroup({ title, action, note, children }: SettingsGroupProps) {
	const titleId = useId();

	return (
		<section className="settings-group" aria-labelledby={titleId}>
			<div className="settings-group-head">
				<h2 id={titleId} className="settings-group-title">
					{title}
				</h2>
				{action}
			</div>
			<Card>{children}</Card>
			{note ? <p className="settings-group-note">{note}</p> : null}
		</section>
	);
}

interface SettingsRowProps {
	name: ReactNode;
	/** The line under the name: what the setting does, or what it is set to. */
	detail?: ReactNode;
	/** Replaces the detail while set: why the last change was refused. */
	error?: ReactNode;
	/** Shown beside the control when the row saves on change. */
	state?: SaveState;
	/** Lets a wide control drop under the text on a narrow column. */
	stacked?: boolean;
	/** The control. */
	children?: ReactNode;
}

/** One setting: its name and a line about it on the left, its control on the right. */
export function SettingsRow({ name, detail, error, state, stacked, children }: SettingsRowProps) {
	return (
		<div className="settings-row" data-stacked={stacked || undefined}>
			<div className="settings-row-text">
				<span className="settings-row-name">{name}</span>
				{error ? (
					<span className="settings-row-detail" data-tone="danger" role="alert">
						{error}
					</span>
				) : null}
				{!error && detail ? <span className="settings-row-detail">{detail}</span> : null}
			</div>
			<div className="settings-row-end">
				{state ? <SaveStatus state={state} /> : null}
				{children}
			</div>
		</div>
	);
}
