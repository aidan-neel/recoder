'use client';

import { Input } from '@recoder/ui';

import type { LimitFieldView } from '@/lib/settings/use-number-field';

import { SettingsRow } from './settings-group';

interface NumberRowProps {
	name: string;
	detail: string;
	view: LimitFieldView;
}

/** One whole-number setting as a row: it saves on blur or Enter, and Escape puts the saved number back. */
export function NumberRow({ name, detail, view }: NumberRowProps) {
	return (
		<SettingsRow name={name} detail={detail} error={view.error} state={view.state}>
			<Input
				className="settings-number"
				inputMode="numeric"
				aria-label={name}
				invalid={view.error !== null}
				value={view.text}
				onChange={(event) => view.edit(event.target.value)}
				onBlur={view.blur}
				onKeyDown={view.onKeyDown}
			/>
		</SettingsRow>
	);
}
