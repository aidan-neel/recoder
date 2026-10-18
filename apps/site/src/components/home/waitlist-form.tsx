'use client';

import { Button, Input, swapMotion, useMotionVariants } from '@recoder/ui';
import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';

import { waitlistEmail } from '~/lib/waitlist';

/** Where the joined address is kept, so a returning visitor sees the confirmation instead of the form. */
const STORAGE_KEY = 'recoder:waitlist-email';

const INVALID = 'Enter an email address, like you@company.com.';

/** The request never reached the site. */
const OFFLINE = 'That didn’t go through. Check your connection.';

/** The site answered but could not take the address: no database yet, or a database error. */
const UNAVAILABLE = 'We couldn’t add you right now. Try again later.';

/** The view that takes focus when it mounts: the button after Escape, the confirmation after a join. */
type FocusTarget = 'trigger' | 'done';

/** Same-tab listeners: the `storage` event only reaches other tabs. */
const listeners = new Set<() => void>();

/** The address joined on an earlier visit. Blocked storage reads as never joined. */
function readJoined(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}

/** A join, or a change of address, in this tab or another shows here too. */
function subscribe(notify: () => void): () => void {
	listeners.add(notify);
	window.addEventListener('storage', notify);

	return () => {
		listeners.delete(notify);
		window.removeEventListener('storage', notify);
	};
}

/** Keeps the joined address, or forgets it with null. When storage is blocked the confirmation lasts only this visit. */
function storeJoined(address: string | null): void {
	try {
		if (address) localStorage.setItem(STORAGE_KEY, address);
		else localStorage.removeItem(STORAGE_KEY);
	} catch {}

	for (const notify of listeners) notify();
}

/**
 * Posts the address and returns the line to show when it fails, or null once
 * it is on the list. A 400 means the server rejected the address; any other
 * answer is on our side, so it never blames the visitor's connection.
 */
async function postJoin(address: string): Promise<string | null> {
	try {
		const response = await fetch('/api/waitlist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: address })
		});

		if (response.ok) return null;

		return response.status === 400 ? INVALID : UNAVAILABLE;
	} catch {
		return OFFLINE;
	}
}

/**
 * The hosted waitlist: an outline button that opens into an email field in
 * place. It posts `{ email }` to /api/waitlist. While the request runs, Join
 * spins at the same width; a failure shows below the field without moving the
 * page, and Escape closes the field and returns focus to the button. After a
 * join, focus moves to the confirmation, which offers to change the address.
 */
export function WaitlistForm() {
	const swap = useMotionVariants(swapMotion);
	const stored = useSyncExternalStore(subscribe, readJoined, () => null);
	const [joined, setJoined] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState('');
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const input = useRef<HTMLInputElement>(null);
	const focusNext = useRef<FocusTarget | null>(null);
	const errorId = `${useId()}-error`;
	const done = joined ?? stored;

	/** A ref callback that focuses its element when it mounts as the view `focusNext` names. */
	function focusOn(target: FocusTarget) {
		return (node: HTMLElement | null) => {
			if (!node || focusNext.current !== target) return;

			focusNext.current = null;
			node.focus();
		};
	}

	function collapse(): void {
		focusNext.current = 'trigger';
		setOpen(false);
		setError(null);
	}

	/** Forgets the joined address and opens the field on it, so a typo can be fixed. */
	function changeAddress(): void {
		setEmail(done ?? '');
		setJoined(null);
		storeJoined(null);
		setOpen(true);
	}

	async function join(event: FormEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();

		if (pending) return;

		const address = waitlistEmail(email);

		if (!address) {
			setError(INVALID);
			input.current?.focus();

			return;
		}

		setPending(true);
		setError(null);

		const failure = await postJoin(address);

		setPending(false);

		if (failure) {
			setError(failure);

			return;
		}

		focusNext.current = 'done';
		storeJoined(address);
		setJoined(address);
	}

	let view: ReactNode;

	if (done) {
		view = (
			<div className="waitlist-done">
				<p ref={focusOn('done')} tabIndex={-1} role="status" className="waitlist-done-text">
					<Check aria-hidden />
					You’re on the list. We’ll email {done} when hosting opens.
				</p>
				<Button variant="ghost" className="brief-action" onClick={changeAddress}>
					Use a different address
				</Button>
			</div>
		);
	} else if (open) {
		view = (
			<div className="waitlist">
				<form className="waitlist-form" noValidate onSubmit={join}>
					<Input
						ref={input}
						autoFocus
						type="email"
						name="email"
						autoComplete="email"
						spellCheck={false}
						placeholder="you@company.com"
						aria-label="Email for the hosted waitlist"
						aria-describedby={error ? errorId : undefined}
						invalid={Boolean(error)}
						className="waitlist-input"
						value={email}
						onChange={(event) => {
							setEmail(event.target.value);
							setError(null);
						}}
						onKeyDown={(event) => {
							if (event.key !== 'Escape' || pending) return;

							event.preventDefault();
							collapse();
						}}
					/>
					<Button
						type="submit"
						variant="outline"
						className="brief-action"
						status={pending ? 'pending' : 'idle'}
						pendingLabel="Joining"
					>
						Join
					</Button>
				</form>
				{error ? (
					<p id={errorId} role="alert" className="waitlist-error">
						{error}
					</p>
				) : null}
			</div>
		);
	} else {
		view = (
			<Button ref={focusOn('trigger')} variant="outline" className="brief-action" onClick={() => setOpen(true)}>
				Join the hosted waitlist
			</Button>
		);
	}

	const shown = done ? 'done' : open ? 'form' : 'closed';

	return (
		<AnimatePresence mode="wait" initial={false}>
			<motion.div
				key={shown}
				data-view={shown}
				className="waitlist-slot"
				variants={swap}
				initial="initial"
				animate="animate"
				exit="exit"
			>
				{view}
			</motion.div>
		</AnimatePresence>
	);
}
