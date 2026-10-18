'use client';

import { Card, cn, SwapText } from '@recoder/ui';
import { useId, type ReactNode } from 'react';

interface SettingsGroupProps {
	title: string;
	/** Sits at the right of the title (an "Add provider" button). */
	action?: ReactNode;
	children: ReactNode;
}

/** A titled card of settings rows, split by hairlines. */
export function SettingsGroup({ title, action, children }: SettingsGroupProps) {
	const id = useId();

	return (
		<section data-ui="settings-group" aria-labelledby={id} className="settings-group">
			<div className="settings-group-head">
				<h2 id={id} className="settings-group-title">
					{title}
				</h2>
				{action}
			</div>
			<Card className="settings-list">{children}</Card>
		</section>
	);
}

interface SettingsRowProps {
	/** One line; a name too long for it ends in an ellipsis. */
	name: ReactNode;
	/** One quiet line under the name. A new line replaces the old one after it fades out, so the two never overlap. */
	description?: ReactNode;
	/** Before the name: a CLI's state glyph. */
	leading?: ReactNode;
	className?: string;
	/** The control, at the row's right end. */
	children?: ReactNode;
}

/** One setting: its name and a line on what it does, with its control at the right. */
export function SettingsRow({ name, description, leading, className, children }: SettingsRowProps) {
	return (
		<div data-ui="settings-row" className={cn('settings-row', className)}>
			{leading}
			<div className="min-w-0 flex-1">
				<p className="settings-row-name">{name}</p>
				{description ? (
					<SwapText mode="wait" className="settings-row-desc">
						{description}
					</SwapText>
				) : null}
			</div>
			{children ? <div className="settings-row-control">{children}</div> : null}
		</div>
	);
}
