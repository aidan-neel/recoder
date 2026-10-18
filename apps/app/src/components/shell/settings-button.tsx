'use client';

import { Button, Tooltip } from '@recoder/ui';
import { Settings } from 'lucide-react';
import Link from 'next/link';

interface SettingsButtonProps {
	/** Where the gear leads. Without one it is a plain button, as in the site's demo, which never navigates. */
	href?: string;
	/** Lit while a settings page shows. */
	active?: boolean;
}

/** The top bar's settings gear. It knows nothing of the router beyond its link. */
export function SettingsButton({ href, active = false }: SettingsButtonProps) {
	const icon = <Settings aria-hidden />;

	return (
		<Tooltip content="Settings" shortcut="mod+," side="bottom">
			<Button asChild={!!href} variant="ghost" size="icon" data-slot="settings-link" aria-label="Settings">
				{href ? (
					<Link href={href} aria-current={active ? 'page' : undefined}>
						{icon}
					</Link>
				) : (
					icon
				)}
			</Button>
		</Tooltip>
	);
}
