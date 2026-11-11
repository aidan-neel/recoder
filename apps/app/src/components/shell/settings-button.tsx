'use client';

import { Button, Tooltip } from '@recoder/ui';
import { Settings } from 'lucide-react';

interface SettingsButtonProps {
	/** Opens settings. Without it the gear does nothing, as in the site's demo. */
	onOpen?: () => void;
	/** Lit while settings is open. */
	active?: boolean;
}

/** The top bar's settings gear. It knows nothing of where settings lives beyond `onOpen`. */
export function SettingsButton({ onOpen, active = false }: SettingsButtonProps) {
	return (
		<Tooltip content="Settings" shortcut="mod+," side="bottom">
			<Button
				variant="ghost"
				size="icon"
				data-slot="settings-link"
				data-active={active || undefined}
				aria-label="Settings"
				aria-haspopup="dialog"
				onClick={onOpen}
			>
				<Settings aria-hidden />
			</Button>
		</Tooltip>
	);
}
