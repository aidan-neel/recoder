'use client';

import { Button, Tooltip } from '@recoder/ui';
import { Settings } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, type MouseEvent } from 'react';

import { opensInPlace } from '@/lib/shell/routes';
import { INTENT_MS, prepareSettings } from '@/lib/shell/settings-warm';
import { useShell } from '@/lib/shell/shell-store';

interface SettingsButtonProps {
	/** Where the gear leads. Without one it is a plain button, as in the site's demo, which never navigates. */
	href?: string;
	/** Lit while a settings page shows. */
	active?: boolean;
}

/**
 * Reads settings page `href`'s data ahead once the pointer or focus has
 * rested on the gear for {@link INTENT_MS}, so a click paints the page whole
 * in one swap. Returns the handlers that plan and drop the read.
 */
function useRestPrepare(href: string | undefined): { plan: () => void; drop: () => void } {
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

	const drop = () => clearTimeout(timer.current);

	const plan = () => {
		drop();

		if (href) timer.current = setTimeout(() => void prepareSettings(href), INTENT_MS);
	};

	useEffect(() => () => clearTimeout(timer.current), []);

	return { plan, drop };
}

/**
 * The top bar's settings gear. A plain click goes through the shell store,
 * as `mod+,` does, so the page on screen stays while the section's data is
 * read; a modified click keeps the link's own behavior. It leaves
 * prefetching the page to the shell, as the tabs do.
 */
export function SettingsButton({ href, active = false }: SettingsButtonProps) {
	const icon = <Settings aria-hidden />;
	const rest = useRestPrepare(href);

	const go = (event: MouseEvent<HTMLAnchorElement>) => {
		if (!href || !opensInPlace(event)) return;

		event.preventDefault();
		rest.drop();
		useShell.getState().navigate(href);
	};

	return (
		<Tooltip content="Settings" shortcut="mod+," side="bottom">
			<Button asChild={!!href} variant="ghost" size="icon" data-slot="settings-link" aria-label="Settings">
				{href ? (
					<Link
						href={href}
						prefetch={false}
						aria-current={active ? 'page' : undefined}
						onClick={go}
						onPointerEnter={rest.plan}
						onPointerLeave={rest.drop}
						onFocus={rest.plan}
						onBlur={rest.drop}
					>
						{icon}
					</Link>
				) : (
					icon
				)}
			</Button>
		</Tooltip>
	);
}
