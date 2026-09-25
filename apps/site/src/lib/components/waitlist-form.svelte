<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Typography from '@sivir-ui/svelte/components/typography';

	/**
	 * Hosted-version waitlist: a secondary button that opens into an email field
	 * in place. Posts `{ email }` to /api/waitlist, which stores it in Neon.
	 * The joined address is kept in localStorage so returning visitors see the
	 * confirmation instead of the form.
	 */
	const STORAGE_KEY = 'recoder:waitlist-email';
	let open = $state(false);
	let email = $state('');
	let status = $state<'idle' | 'pending' | 'done' | 'error'>('idle');
	let error = $state('');
	let inputEl = $state<HTMLInputElement>();
	let triggerEl = $state<HTMLButtonElement | HTMLAnchorElement>();
	const id = $props.id();

	onMount(() => {
		try {
			const joined = localStorage.getItem(STORAGE_KEY);
			if (joined) {
				email = joined;
				status = 'done';
			}
		} catch {
			// Storage blocked (private mode, disabled cookies): show the form.
		}
	});

	async function expand() {
		open = true;
		await tick();
		inputEl?.focus();
	}
	async function collapse() {
		open = false;
		status = 'idle';
		error = '';
		await tick();
		triggerEl?.focus();
	}

	async function join(event: SubmitEvent) {
		event.preventDefault();
		if (status === 'pending') return;
		const address = email.trim();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
			status = 'error';
			error = 'Enter an email address, like you@company.com.';
			inputEl?.focus();
			return;
		}
		status = 'pending';
		error = '';
		try {
			const response = await fetch('/api/waitlist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: address })
			});
			if (!response.ok) throw new Error(String(response.status));
			status = 'done';
			try {
				localStorage.setItem(STORAGE_KEY, address);
			} catch {
				// Not remembered across visits; joining still worked.
			}
		} catch {
			status = 'error';
			error = 'That didn’t go through. Check your connection and try again.';
		}
	}
</script>

{#if status === 'done'}
	<Typography.Text role="status" class="waitlist-done">
		<Check size={14} class="shrink-0 text-success" aria-hidden="true" />
		You’re on the list. We’ll email {email.trim()} when hosting opens.
	</Typography.Text>
{:else if open}
	<div class="waitlist-wrap">
		<form class="waitlist" onsubmit={join} novalidate>
			<Input
				bind:element={inputEl}
				bind:value={email}
				type="email"
				name="email"
				autocomplete="email"
				spellcheck={false}
				placeholder="you@company.com"
				aria-label="Email for the hosted waitlist"
				aria-invalid={status === 'error' ? 'true' : undefined}
				aria-describedby={status === 'error' ? `${id}-error` : undefined}
				class="waitlist-input"
				oninput={() => {
					if (status === 'error') status = 'idle';
				}}
				onkeydown={(event: KeyboardEvent) => {
					if (event.key === 'Escape' && status !== 'pending') {
						event.preventDefault();
						void collapse();
					}
				}}
			/>
			<Button type="submit" variant="outline" class="brief-action" loading={status === 'pending'} loadingLabel="Joining">Join</Button>
		</form>
		{#if status === 'error'}
			<Typography.Text id="{id}-error" role="alert" class="waitlist-error">{error}</Typography.Text>
		{/if}
	</div>
{:else}
	<Button bind:element={triggerEl} variant="outline" class="brief-action" onclick={() => void expand()}>
		Join the hosted waitlist
	</Button>
{/if}
