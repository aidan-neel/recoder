<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { REASONING_EFFORTS, effortLabel, type ReasoningEffort } from '@recoder/shared';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { Label } from '@sivir-ui/svelte/components/label';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import ChartPanel from '$lib/components/charts/chart-panel.svelte';
	import PrPicks from '$lib/components/run/pr-picks.svelte';
	import OptionSelect from '$lib/components/ui/option-select.svelte';
	import { settled } from '$lib/live/settled.svelte';
	import Skeleton from '$web/components/ui/skeleton.svelte';

	let { data, form } = $props();

	const DEFAULT_JUDGE = 'opencode:openai/gpt-6-luna';

	let base = $state('');
	let picked = $state<string[]>([]);
	let model = $state('');
	let effort = $state('');
	let judge = $state('');
	let judgeEffort = $state('medium');
	let starting = $state(false);

	/** The host and dataset the picks were made for; a failed start reloads the data but keeps them. */
	let pickedFor = '';

	/** The host the judge default was picked for; the pick waits for that host's models. */
	let judgedFor = '';

	const setup = settled(
		() => data.setup,
		() => data.host
	);

	$effect.pre(() => {
		const key = `${data.host}/${data.dataset}`;

		if (key === pickedFor) return;

		pickedFor = key;
		base = data.base;
		picked = [];
	});

	$effect.pre(() => {
		const offered = setup.current?.models;

		if (!offered || judgedFor === data.host) return;

		judgedFor = data.host;
		judge = offered.some((entry) => entry.id === DEFAULT_JUDGE) ? DEFAULT_JUDGE : 'review';
	});

	const running = $derived(setup.current?.servers ?? []);
	const models = $derived(setup.current?.models ?? []);
	const servers = $derived([...new Set([new URL(data.base).port, ...running.map(String)])]);

	const busy = $derived(
		setup.current?.busy.find((run) => new URL(run.base).port === new URL(base || data.base).port) ?? null
	);

	const reviewer = $derived(models.find((entry) => entry.id === model) ?? null);
	const judgeModel = $derived(models.find((entry) => entry.id === judge) ?? null);

	const modelOptions = $derived(
		models.map((entry) => ({ value: entry.id, label: entry.label, detail: entry.source ?? undefined }))
	);

	function effortOptions(efforts: ReasoningEffort[] | undefined, none: string) {
		return [{ value: '', label: none }, ...(efforts ?? []).map((value) => ({ value, label: effortLabel(value) }))];
	}

	function open(host: string, dataset: string | null): void {
		void goto(`/new?host=${encodeURIComponent(host)}${dataset ? `&dataset=${encodeURIComponent(dataset)}` : ''}`);
	}
</script>

<ScrollArea class="h-full min-h-0" aria-label="New run" showCues={false}>
	<div class="bench-page">
		<div class="bench-head">
			<h1 class="bench-title">New run</h1>
		</div>

		<form
			method="POST"
			class="bench-section"
			use:enhance={() => {
				starting = true;

				return async ({ update }) => {
					await update({ reset: false });
					starting = false;
				};
			}}
		>
			<input type="hidden" name="host" value={data.host} />
			<input type="hidden" name="base" value={base} />
			<input type="hidden" name="dataset" value={data.dataset ?? ''} />
			<input type="hidden" name="only" value={picked.join(',')} />
			<input type="hidden" name="model" value={model} />
			<input type="hidden" name="effort" value={effort} />
			<input type="hidden" name="judge" value={judge} />
			<input type="hidden" name="judgeEffort" value={judgeEffort} />

			<ChartPanel title="Where">
				<div class="form-grid">
					<div class="form-field">
						<Label>Host</Label>
						<OptionSelect
							value={data.host}
							label="Host"
							options={data.hosts.map((item) => ({ value: item.id, label: item.label }))}
							onValueChange={(value) => open(value, null)}
						/>
					</div>
					<div class="form-field">
						<Label>Server</Label>
						{#if setup.current}
							<OptionSelect
								bind:value={base}
								label="Server"
								options={servers.map((port) => ({
									value: `http://localhost:${port}`,
									label: `localhost:${port}`,
									detail: running.includes(Number(port)) ? 'running' : 'not running'
								}))}
							/>
						{:else}
							<Skeleton class="field-skeleton" />
						{/if}
					</div>
					<div class="form-field">
						<Label>Dataset</Label>
						<OptionSelect
							value={data.dataset ?? ''}
							label="Dataset"
							options={data.datasets.map((name) => ({ value: name, label: name }))}
							onValueChange={(value) => open(data.host, value)}
						/>
					</div>
				</div>
			</ChartPanel>

			{#if data.dataset}
				<ChartPanel title="PRs">
					<PrPicks prs={data.prs} bind:picked />
				</ChartPanel>
			{:else}
				<Alert.Root variant="warning">
					<Alert.Description>This host has no dataset with labels.</Alert.Description>
				</Alert.Root>
			{/if}

			<ChartPanel title="Models">
				{#if setup.error}
					<Alert.Root variant="error" class="mb-4">
						<Alert.Description>The host did not answer: {setup.error}</Alert.Description>
					</Alert.Root>
				{:else if !setup.current}
					<div class="form-grid">
						{#each ['Reviewer', 'Reviewer effort', 'Judge', 'Judge effort'] as name (name)}
							<div class="form-field">
								<Label>{name}</Label>
								<Skeleton class="field-skeleton" />
							</div>
						{/each}
					</div>
				{:else if !running.length}
					<Alert.Root variant="warning" class="mb-4">
						<Alert.Description
							>No Recoder server is running on this host. Start one before you start a run.</Alert.Description
						>
					</Alert.Root>
				{:else if setup.current.modelError}
					<Alert.Root variant="error" class="mb-4">
						<Alert.Description>The server did not list its models: {setup.current.modelError}</Alert.Description>
					</Alert.Root>
				{/if}
				{#if setup.current}
					<div class="form-grid">
						<div class="form-field">
							<Label>Reviewer</Label>
							<OptionSelect
								bind:value={model}
								label="Reviewer"
								options={[{ value: '', label: "Keep the server's picks" }, ...modelOptions]}
							/>
						</div>
						<div class="form-field">
							<Label>Reviewer effort</Label>
							<OptionSelect
								bind:value={effort}
								label="Reviewer effort"
								options={effortOptions(reviewer?.efforts, model ? 'Model default' : "Keep the server's pick")}
							/>
						</div>
						<div class="form-field">
							<Label>Judge</Label>
							<OptionSelect
								bind:value={judge}
								label="Judge"
								options={[
									{ value: 'review', label: 'The review model' },
									{ value: 'second', label: 'The second review pick' },
									...modelOptions
								]}
							/>
						</div>
						<div class="form-field">
							<Label>Judge effort</Label>
							<OptionSelect
								bind:value={judgeEffort}
								label="Judge effort"
								options={effortOptions(judgeModel?.efforts ?? [...REASONING_EFFORTS], 'Model default')}
							/>
						</div>
					</div>
				{/if}
				{#if busy}
					<Alert.Root variant="warning" class="mt-4">
						<Alert.Description>
							Run {busy.pid} is using this server. A new reviewer would also apply to the reviews it has not started, so keep
							the server's picks or pick another server.
						</Alert.Description>
					</Alert.Root>
				{/if}
			</ChartPanel>

			<ChartPanel title="Run">
				<div class="form-grid">
					<Input name="runs" type="number" label="Runs a PR" value="1" min="1" max="50" required />
					<Input name="concurrency" type="number" label="Reviews at once" value="3" min="1" max="20" required />
					<Input name="timeout" type="number" label="Timeout, minutes" value="90" min="1" max="600" required />
					<Input name="tag" label="Log name" value={data.tag} pattern="[\w.-]+" required />
				</div>
			</ChartPanel>

			{#if form?.error}
				<Alert.Root variant="error">
					<Alert.Description>{form.error}</Alert.Description>
				</Alert.Root>
			{/if}

			<div class="form-actions">
				<Button
					type="submit"
					loading={starting}
					loadingLabel="Starting"
					disabled={!data.dataset || !running.length || Boolean(busy && model)}>Start run</Button
				>
			</div>
		</form>
	</div>
</ScrollArea>
