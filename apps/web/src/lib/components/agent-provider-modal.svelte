<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { CopyButton } from '@sivir-ui/svelte/components/copy-button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { Label } from '@sivir-ui/svelte/components/label';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import * as RadioGroup from '@sivir-ui/svelte/components/radio-group';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Select from '@sivir-ui/svelte/components/select';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { toast } from '@sivir-ui/svelte/components/toast';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { cubicOut } from 'svelte/easing';
	import type { TransitionConfig } from 'svelte/transition';
	import type { AgentAuthMethod, AgentAuthPrompt, AgentOAuthAttempt, AgentProvider } from '@recoder/shared';
	import { agent } from '$lib/agent.svelte';
	import { serverApi } from '$lib/server-api';

	interface Props {
		open: boolean;
		/** Open straight on this provider's sign-in instead of the list. */
		providerId?: string | null;
	}

	let { open = $bindable(), providerId = null }: Props = $props();

	/** Shown first, in this order, while nothing is typed. */
	const POPULAR = [
		'opencode',
		'opencode-go',
		'anthropic',
		'openai',
		'github-copilot',
		'openrouter',
		'google',
		'xai',
		'deepseek'
	];
	/** Providers without listed methods take an API key. */
	const KEY_ONLY: AgentAuthMethod = { index: -1, type: 'api', label: 'API key', prompts: [] };

	let step = $state<'pick' | 'connect'>('pick');
	/** 1 going deeper (list → provider), -1 going back; steers the slide. */
	let direction = $state(1);
	let provider = $state<AgentProvider | null>(null);
	let query = $state('');
	let methodIndex = $state('0');
	let inputs = $state<Record<string, string>>({});
	let key = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let attempt = $state<AgentOAuthAttempt | null>(null);
	let code = $state('');
	let poll: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		if (!open) return;
		reset();

		const preset = providerId ? agent.providers?.find((p) => p.id === providerId) : null;

		if (preset) choose(preset, false);
		else step = 'pick';

		return stopPolling;
	});

	function reset(): void {
		stopPolling();
		query = '';
		provider = null;
		error = null;
		busy = false;
		attempt = null;
		code = '';
		key = '';
		inputs = {};
	}

	const methods = $derived(provider ? (provider.methods.length ? provider.methods : [KEY_ONLY]) : []);
	const method = $derived(methods.find((m) => String(m.index) === methodIndex) ?? methods[0]);
	/** Prompts whose condition holds for the answers so far. */
	const prompts = $derived((method?.prompts ?? []).filter((p) => visible(p, inputs)));
	const missing = $derived(
		prompts.some((p) => p.type === 'text' && !p.message.includes('optional') && !inputs[p.key]?.trim())
	);

	function visible(prompt: AgentAuthPrompt, answers: Record<string, string>): boolean {
		if (!prompt.when) return true;

		const value = answers[prompt.when.key] ?? '';

		return prompt.when.op === 'eq' ? value === prompt.when.value : value !== prompt.when.value;
	}

	let fromList = $state(false);
	function choose(next: AgentProvider, viaList = true): void {
		provider = next;
		fromList = viaList;

		const first = next.methods[0] ?? KEY_ONLY;

		methodIndex = String(first.index);

		inputs = Object.fromEntries(
			next.methods
				.flatMap((m) => m.prompts)
				.flatMap((p) => (p.type === 'select' && p.options[0] ? [[p.key, p.options[0].value]] : []))
		);

		key = '';
		error = null;
		direction = 1;
		step = 'connect';
	}

	function back(): void {
		stopPolling();
		if (attempt) void serverApi.agentCancelOAuth(attempt.attemptId).catch(() => {});
		attempt = null;
		error = null;
		direction = -1;
		step = 'pick';
	}

	/* ── Step motion ─────────────────────────────────────────── */

	const reduce = typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	/** Steps crossfade with a short slide in the direction of travel; the dialog's height follows. */
	function swap(_node: Element, { into }: { into: boolean }): TransitionConfig {
		const shift = 16 * direction * (into ? 1 : -1);

		return {
			duration: reduce ? 0 : into ? 200 : 120,
			delay: reduce || !into ? 0 : 40,
			easing: cubicOut,
			css: (t, u) => `opacity:${t};transform:translateX(${u * shift}px);filter:blur(${u * 2}px)`
		};
	}
	let stepHeight = $state<number | null>(null);

	/* ── Provider list ───────────────────────────────────────── */

	const q = $derived(query.trim().toLowerCase());
	const all = $derived(agent.providers ?? []);
	const popular = $derived(POPULAR.flatMap((id) => all.filter((p) => p.id === id)));
	const shown = $derived(
		q
			? all.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q))
			: all.filter((p) => !POPULAR.includes(p.id))
	);

	/* ── Connect ─────────────────────────────────────────────── */

	function answers(): Record<string, string> {
		const visibleKeys = new Set(prompts.map((p) => p.key));

		return Object.fromEntries(
			Object.entries(inputs)
				.filter(([k, v]) => visibleKeys.has(k) && v.trim())
				.map(([k, v]) => [k, v.trim()])
		);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!provider || !method || busy) return;
		if (attempt?.mode === 'code') return void sendCode();
		error = null;
		busy = true;

		try {
			if (method.type === 'api') {
				await agent.changed((await serverApi.agentSetKey(provider.id, key.trim(), answers())).providers);
				done();
			} else {
				attempt = await serverApi.agentStartOAuth(provider.id, method.index, answers());
				window.open(attempt.url, '_blank', 'noopener');
				if (attempt.mode === 'auto') schedulePoll();
				busy = false;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not connect.';
			busy = false;
		}
	}

	async function sendCode(): Promise<void> {
		if (!attempt || !code.trim()) return;
		busy = true;
		error = null;

		try {
			const state = await serverApi.agentOAuthCode(attempt.attemptId, code.trim());

			if (state.status === 'complete') return void (await finish());
			error = state.status === 'failed' ? state.message : 'Sign-in did not finish.';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Sign-in failed.';
		}

		busy = false;
	}

	function schedulePoll(): void {
		stopPolling();

		poll = setTimeout(async () => {
			if (!attempt) return;

			try {
				const state = await serverApi.agentOAuthStatus(attempt.attemptId);

				if (state.status === 'complete') return void (await finish());

				if (state.status === 'failed') {
					error = state.message;
					attempt = null;

					return;
				}
			} catch (e) {
				error = e instanceof Error ? e.message : 'Lost track of the sign-in.';
				attempt = null;

				return;
			}

			schedulePoll();
		}, 1500);
	}

	function stopPolling(): void {
		if (poll) clearTimeout(poll);
		poll = null;
	}

	async function finish(): Promise<void> {
		busy = true;
		await agent.changed().catch(() => {});
		done();
	}

	function done(): void {
		const name = provider?.name;

		busy = false;
		open = false;
		toast.success(`Connected ${name}`);
	}

	/** "Enter code: AULF-57S8B" → the code, so it can be shown large and copied. */
	const deviceCode = $derived(attempt?.instructions.match(/code[:\s]+([A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+)/i)?.[1] ?? null);
	const title = $derived(step === 'pick' ? 'Add provider' : `Connect ${provider?.name ?? ''}`);
	const submitLabel = $derived(
		attempt?.mode === 'code' ? 'Finish sign-in' : method?.type === 'oauth' ? 'Sign in' : 'Connect'
	);
	const canSubmit = $derived(
		attempt ? attempt.mode === 'code' && !!code.trim() : method?.type === 'api' ? !!key.trim() && !missing : !missing
	);
</script>

<Modal.Root bind:open>
	<Modal.Content size="md" class="agent-provider-modal">
		<Modal.Header>
			<Modal.Title>{title}</Modal.Title>
		</Modal.Header>
		<Modal.Body>
			<div class="agent-steps" style:height={stepHeight === null ? undefined : `${stepHeight}px`}>
				<div class="agent-steps-track" bind:clientHeight={stepHeight}>
					{#if step === 'pick'}
						<div class="agent-step flex flex-col gap-3" in:swap={{ into: true }} out:swap={{ into: false }}>
							<Input placeholder="Search providers" aria-label="Search providers" bind:value={query} autofocus>
								{#snippet leading()}<Search size={15} aria-hidden="true" />{/snippet}
							</Input>
							<ScrollArea aria-label="Providers" class="h-[min(52dvh,440px)]" showCues={false}>
								<div class="agent-pick-list">
									{#if !q && popular.length}
										<Typography.Metadata class="agent-pick-group">Popular</Typography.Metadata>
										{#each popular as item (item.id)}
											{@render pickRow(item)}
										{/each}
										<Typography.Metadata class="agent-pick-group">All providers</Typography.Metadata>
									{/if}
									{#each shown as item (item.id)}
										{@render pickRow(item)}
									{:else}
										<p class="settings-empty px-2 py-3">No providers match “{query.trim()}”.</p>
									{/each}
								</div>
							</ScrollArea>
						</div>
					{:else if provider && method}
						<form
							id="agent-connect"
							class="agent-step grid gap-4"
							onsubmit={submit}
							in:swap={{ into: true }}
							out:swap={{ into: false }}
						>
							{#if attempt}
								<div class="agent-signin" aria-live="polite">
									{#if deviceCode}
										<p class="m-0 text-[13px] text-fg-muted">Enter this code on the sign-in page.</p>
										<div class="agent-device-code">
											<span>{deviceCode}</span>
											<CopyButton text={deviceCode} aria-label="Copy code" />
										</div>
									{:else}
										<p class="m-0 text-[13px] text-fg-muted">{attempt.instructions}</p>
									{/if}
									<Button variant="outline" href={attempt.url} target="_blank" rel="noopener" class="w-fit">
										Open sign-in page <ArrowUpRight size={14} aria-hidden="true" />
									</Button>
									{#if attempt.mode === 'code'}
										<Input
											label="Code from the provider"
											autocomplete="off"
											spellcheck={false}
											bind:value={code}
											autofocus
										/>
									{:else}
										<p class="agent-waiting"><Spinner size={13} /> Waiting for you to finish in the browser</p>
									{/if}
								</div>
							{:else}
								{#if methods.length > 1}
									<div class="grid gap-2">
										<Label>Connect with</Label>
										<RadioGroup.Root bind:value={methodIndex} class="agent-methods">
											{#each methods as m (m.index)}
												<RadioGroup.Item value={String(m.index)} label={m.label} />
											{/each}
										</RadioGroup.Root>
									</div>
								{/if}
								{#each prompts as prompt (prompt.key)}
									{#if prompt.type === 'select'}
										<div class="grid gap-1.5">
											<Label>{prompt.message}</Label>
											<Select.Root bind:value={inputs[prompt.key]}>
												<Select.Trigger class="w-full justify-between"><Select.Value /></Select.Trigger>
												<Select.Content>
													{#each prompt.options as option (option.value)}
														<Select.Item value={option.value} label={option.label}>
															<span class="flex min-w-0 flex-1 items-baseline justify-between gap-3">
																<span>{option.label}</span>
																{#if option.hint}<span class="text-[11.5px] text-fg-faint">{option.hint}</span>{/if}
															</span>
														</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
										</div>
									{:else}
										<Input
											label={prompt.message}
											placeholder={prompt.placeholder ?? undefined}
											autocomplete="off"
											spellcheck={false}
											bind:value={inputs[prompt.key]}
										/>
									{/if}
								{/each}
								{#if method.type === 'api'}
									<Input
										type="password"
										label="API key"
										autocomplete="off"
										spellcheck={false}
										bind:value={key}
										autofocus
									/>
									<Typography.Text variant="supporting" class="text-[12.5px]"
										>Saved by OpenCode on this machine.</Typography.Text
									>
								{:else}
									<Typography.Text variant="supporting" class="text-[12.5px]"
										>Opens the provider’s sign-in page in a new tab.</Typography.Text
									>
								{/if}
							{/if}
							{#if error}<p class="m-0 text-[12.5px] text-danger" role="alert">{error}</p>{/if}
						</form>
					{/if}
				</div>
			</div>
		</Modal.Body>
		<Modal.Footer>
			{#if step === 'connect' && fromList}
				<Button variant="ghost" class="modal-footer-start" onclick={back}
					><ArrowLeft size={14} aria-hidden="true" /> Back</Button
				>
			{/if}
			<Modal.Close>Cancel</Modal.Close>
			{#if step === 'connect' && !(attempt && attempt.mode === 'auto')}
				<Button type="submit" form="agent-connect" loading={busy} disabled={!canSubmit}>{submitLabel}</Button>
			{/if}
		</Modal.Footer>
	</Modal.Content>
</Modal.Root>

{#snippet pickRow(item: AgentProvider)}
	<Button variant="ghost" class="agent-pick-row" onclick={() => choose(item)}>
		<span class="min-w-0 flex-1 truncate text-left">{item.name}</span>
		{#if item.connected}
			<span class="agent-pick-meta text-ok"><Check size={13} aria-hidden="true" /> Connected</span>
		{:else if item.modelCount}
			<span class="agent-pick-meta">{item.modelCount} {item.modelCount === 1 ? 'model' : 'models'}</span>
		{/if}
		<ChevronRight size={14} aria-hidden="true" class="shrink-0 text-fg-faint" />
	</Button>
{/snippet}
