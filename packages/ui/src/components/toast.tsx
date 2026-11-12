'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ToasterProps } from 'sonner';

import { whenIdle } from './content/idle';
import { attachToaster, loadSonner, onToastRequest, toastRequested, type Sonner } from './toast-queue';

export { toast } from './toast-queue';

/** The longest the toast library waits for an idle moment before it loads anyway. */
const WARM_WAIT_MS = 4000;

/** The look sonner leaves to the kit: every part of a toast takes a kit class (components.css). */
const TOAST_OPTIONS: ToasterProps['toastOptions'] = {
	unstyled: true,
	classNames: {
		toast: 'ui-toast',
		title: 'ui-toast-title',
		description: 'ui-toast-description',
		actionButton: 'ui-toast-action',
		cancelButton: 'ui-toast-action',
		icon: 'ui-toast-icon'
	}
};

/** Never asked for on the server: the stack renders nothing there. */
function notRequested(): boolean {
	return false;
}

/**
 * The toast stack, bottom right. No first paint carries it: the toast
 * library loads once the page is idle, so a toast that says the app's code
 * failed to load can still show when the server that sends that code has
 * gone, and the stack mounts on the first toast. A toast raised before the
 * library is in shows as soon as the stack is up. Toasts float like menus
 * (the menu shadow) and rise in briefly; an Undo action stays clickable while
 * a modal is open. `offset` moves the stack off the window's edges (16px by
 * default), to clear something floating in that corner.
 */
export function Toaster({ offset = 16 }: { offset?: ToasterProps['offset'] }) {
	const requested = useSyncExternalStore(onToastRequest, toastRequested, notRequested);
	const [sonner, setSonner] = useState<Sonner | null>(null);

	useEffect(() => whenIdle(() => void loadSonner(), WARM_WAIT_MS), []);

	useEffect(() => {
		if (!requested || sonner) return;

		let current = true;

		loadSonner().then((loaded) => {
			if (current && loaded) setSonner(loaded);
		});

		return () => {
			current = false;
		};
	}, [requested, sonner]);

	useEffect(() => (sonner ? attachToaster(sonner) : undefined), [sonner]);

	if (!sonner) return null;

	return (
		<sonner.Toaster
			className="ui-toaster"
			position="bottom-right"
			gap={8}
			offset={offset}
			visibleToasts={4}
			toastOptions={TOAST_OPTIONS}
		/>
	);
}
