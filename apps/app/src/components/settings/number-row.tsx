'use client';

import { NumberField } from '@recoder/ui';

import type { LimitFieldView } from '@/lib/settings/use-number-field';

import { SettingsRow } from './settings-group';

interface NumberRowProps {
	name: string;
	detail: string;
	view: LimitFieldView;
	/** Widens the value slot so stacked rows with large counts share one edge. */
	wide?: boolean;
}

/** One whole-number setting as a row: stepping saves at once, typing saves on blur or Enter, and Escape reverts. */
export function NumberRow({ name, detail, view, wide }: NumberRowProps) {
	return (
		<SettingsRow name={name} detail={detail} error={view.error} state={view.state}>
			<NumberField
				className={wide ? 'settings-number-wide' : undefined}
				aria-label={name}
				aria-valuemin={view.min}
				aria-valuemax={view.max}
				aria-valuenow={view.valueNow ?? undefined}
				canDecrement={view.canDecrement}
				canIncrement={view.canIncrement}
				invalid={view.error !== null}
				value={view.text}
				onStep={view.step}
				onChange={(event) => view.edit(event.target.value)}
				onBlur={view.blur}
				onKeyDown={view.onKeyDown}
			/>
		</SettingsRow>
	);
}
