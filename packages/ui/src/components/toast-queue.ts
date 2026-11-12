import type { ReactNode } from 'react';
import type { ExternalToast } from 'sonner';

/** The toast library, loaded once the page is idle (or by an earlier toast), so no first paint pays for it. */
export type Sonner = typeof import('sonner');

/** A toast's id: the one passed in `data.id`, or one the kit makes. */
type ToastId = string | number;

/** Raises a toast and returns its id at once, before the toast library has loaded. */
type Show = (message: ReactNode, data?: ExternalToast) => ToastId;

/** Calls made before a Toaster could take them, in order. */
const waiting: ((sonner: Sonner) => void)[] = [];

/** Toasters waiting to hear that the first toast was asked for. */
const listeners = new Set<() => void>();

/** The library, while a mounted Toaster is listening to it. */
let live: Sonner | null = null;

/** True once a toast was asked for, so the Toaster loads the library. */
let requested = false;

/** The library's import, shared by every caller until it settles. */
let loading: Promise<Sonner | null> | null = null;

/** Makes the kit's toast ids. */
let made = 0;

/** Tells the Toasters that the request flag changed. */
function announce(next: boolean): void {
	requested = next;

	for (const listener of listeners) listener();
}

/** Runs a call on the library now, or queues it for the Toaster and asks it to load. */
function send(run: (sonner: Sonner) => void): void {
	if (live) return run(live);

	waiting.push(run);

	if (!requested) announce(true);
}

/** One of the toast kinds as a function that queues until the Toaster is up. */
function shower(kind: 'message' | 'success' | 'error' | 'info'): Show {
	return (message, data) => {
		const id = data?.id ?? `ui-toast-${++made}`;

		send(({ toast }) => {
			const raise = kind === 'message' ? toast : toast[kind];

			raise(message, { ...data, id });
		});

		return id;
	};
}

/**
 * Raises a toast in the kit's Toaster. The calls match sonner's: `toast()`,
 * `toast.success()`, `toast.error()`, `toast.info()` and `toast.dismiss()`.
 * Calls made before the library and its Toaster are ready wait and run in
 * order, and each returns its id at once.
 */
export const toast = Object.assign(shower('message'), {
	success: shower('success'),
	error: shower('error'),
	info: shower('info'),
	/** Takes a toast away, or every toast with no id. Before any toast was raised there is nothing to take. */
	dismiss(id?: ToastId): void {
		if (!live && !requested) return;

		send((sonner) => {
			sonner.toast.dismiss(id);
		});
	}
});

/** Listens for the first toast request. Returns the cleanup. */
export function onToastRequest(listener: () => void): () => void {
	listeners.add(listener);

	return () => listeners.delete(listener);
}

/** True once a toast was asked for. */
export function toastRequested(): boolean {
	return requested;
}

/**
 * Loads the toast library once: the Toaster warms it while the page is idle,
 * and the first toast asks for it if that has not happened yet. A failed load
 * (a lost chunk) resolves null and clears the request, so the next toast
 * tries again; waiting calls keep their place.
 */
export function loadSonner(): Promise<Sonner | null> {
	loading ??= import('sonner').catch(() => {
		loading = null;
		announce(false);

		return null;
	});

	return loading;
}

/**
 * Hands the library to the toast calls once a Toaster listens to it, and runs
 * the calls that waited. Call it after the library's Toaster has mounted, so
 * it is subscribed. Returns the cleanup for when the Toaster goes.
 */
export function attachToaster(sonner: Sonner): () => void {
	live = sonner;

	for (const run of waiting.splice(0)) run(sonner);

	return () => {
		if (live === sonner) live = null;
	};
}
