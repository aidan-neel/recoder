<script lang="ts">
	import { onMount } from 'svelte';
	import Check from '@lucide/svelte/icons/check';
	import * as Command from '@sivir-ui/svelte/components/command';
	import * as Select from '@sivir-ui/svelte/components/select';
	import type { ReasoningEffort } from '@recoder/shared';
	import Skeleton from '$lib/components/ui/skeleton.svelte';
	import {
		effortLabel,
		formatContextWindow,
		modelSettingsUi,
		resolveEffort,
		type ModelChoice,
		type ModelOption
	} from '$lib/settings/model-settings.svelte';

	interface Props {
		/** Current selection; null while settings load or when nothing is configured. */
		value: ModelChoice | null;
		onSelect: (choice: ModelChoice) => void;
		/** The role this pick is for, as the dialog's scope hint ("Review"). */
		role: string;
		/** Trigger text when `value` is null (e.g. "Same as Review"). */
		placeholder?: string;
		/** Offers `placeholder` as the first option, to go back to following another pick. */
		onFollow?: () => void;
	}

	let { value, onSelect, role, placeholder = 'Choose a model', onFollow }: Props = $props();

	let open = $state(false);
	let query = $state('');

	/** The label only animates when the developer changes it, never when it first loads. */
	let picked = $state(false);

	/**
	 * Mounting hundreds of rows at once stalls the dialog's open. The first
	 * frame mounts the rows around the current model, so the dialog paints
	 * fully formed; the rest fill outward, a chunk each way per frame, behind
	 * same-height skeletons that stay offscreen.
	 */
	const BEFORE = 16;
	const AFTER = 24;
	const CHUNK = 20;

	/** Frames the window has grown this open. */
	let grown = $state(0);

	onMount(() => {
		void modelSettingsUi.ensure();
	});

	const models = $derived(modelSettingsUi.models);
	const model = $derived<ModelOption | undefined>(models.find((item) => item.id === value?.modelId));
	const effort = $derived(resolveEffort(model, value?.effort));
	const q = $derived(query.trim().toLowerCase());
	const terms = $derived(q.split(/\s+/).filter(Boolean));
	const multiAgent = $derived(new Set(models.map((option) => option.agent)).size > 1);

	/**
	 * Models by provider (and agent, when more than one runs models and it is not the provider itself, as with
	 * Claude Code), A to Z, with each group's first row index.
	 */
	const groups = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local Map in $derived.by, not reactive state
		const byHeading = new Map<string, ModelOption[]>();

		for (const option of models) {
			const heading =
				multiAgent && option.agent !== option.provider ? `${option.agent} · ${option.provider}` : option.provider;

			byHeading.set(heading, [...(byHeading.get(heading) ?? []), option]);
		}

		let start = 0;

		return [...byHeading.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([heading, options]) => {
				const group = { heading, options, start };

				start += options.length;

				return group;
			});
	});

	const currentIndex = $derived(
		groups.flatMap((group) => group.options).findIndex((option) => option.id === model?.id)
	);
	const anchor = $derived(Math.max(0, currentIndex - BEFORE));
	const lo = $derived(Math.max(0, anchor - grown * CHUNK));
	const hi = $derived(Math.min(models.length, anchor + BEFORE + AFTER + grown * CHUNK));

	const hits = $derived(
		new Set(
			models
				.filter((option) => matches(`${option.displayName} ${option.provider} ${option.agent} ${option.id}`))
				.map((option) => option.id)
		)
	);

	const followHit = $derived(matches(placeholder));

	/**
	 * Rows stay mounted while searching, since remounting hundreds of them per
	 * keystroke is slow. A hit is named after the query, so Sivir's own matcher
	 * keeps it; a miss gets a name nothing matches, and Sivir hides it.
	 */
	const MISS = '\u0000';

	/** Every word of the query appears somewhere, in any order ("openrouter kimi"). */
	function matches(text: string): boolean {
		const haystack = text.toLowerCase();

		return terms.every((term) => haystack.includes(term));
	}

	$effect(() => {
		if (open) query = '';
	});

	$effect(() => {
		if (open) return fillOutward();
	});

	/**
	 * Grows the window one chunk per frame, each step just after a paint.
	 * Sivir's highlight re-measures a frame after every list change, so a step
	 * inside the frame callback would push it back a frame every time, and the
	 * current row would only light up once the list finished filling.
	 */
	function fillOutward(): () => void {
		let frame = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const next = () => {
			frame = requestAnimationFrame(() => (timer = setTimeout(grow)));
		};

		const grow = () => {
			grown += 1;
			if (lo > 0 || hi < models.length) next();
		};

		next();

		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	}

	/** A group's rows outside the window, as the skeleton runs before and after its mounted rows. */
	function pending(start: number, length: number): { before: number; after: number } {
		const end = start + length;

		return {
			before: Math.max(0, Math.min(end, lo) - start),
			after: Math.max(0, end - Math.max(start, hi))
		};
	}

	/**
	 * Opening lands on the current model rather than the top of a long list,
	 * before the first paint. Sivir's command tracks its active row from
	 * hover, so the row is hovered once its listeners are attached.
	 */
	function landOnCurrent(node: HTMLElement): void {
		queueMicrotask(() => {
			const row = node.querySelector('[data-current]')?.closest<HTMLElement>('[role="option"]');

			row?.dispatchEvent(new MouseEvent('mouseenter'));
			row?.scrollIntoView({ block: 'center' });
		});
	}

	/**
	 * Sivir orders arrow keys by the order rows mounted, which the outward
	 * fill scrambles, so the arrows walk the rows in the order they're shown.
	 */
	function arrowKeys(node: HTMLElement): () => void {
		const onKeydown = (event: KeyboardEvent) => {
			if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

			const rows = [
				...(node.closest('.model-dialog')?.querySelectorAll<HTMLElement>('[role="option"]:not([hidden])') ?? [])
			];

			if (rows.length === 0) return;
			event.preventDefault();
			event.stopPropagation();

			const at = rows.findIndex((row) => row.getAttribute('aria-selected') === 'true');

			const next = {
				ArrowDown: (at + 1) % rows.length,
				ArrowUp: at <= 0 ? rows.length - 1 : at - 1,
				Home: 0,
				End: rows.length - 1
			}[event.key]!;

			rows[next].dispatchEvent(new MouseEvent('mouseenter'));
			rows[next].scrollIntoView({ block: 'nearest' });
		};

		node.addEventListener('keydown', onKeydown, true);

		return () => node.removeEventListener('keydown', onKeydown, true);
	}

	/**
	 * Sivir's search input owns its handlers and filters by item name, so the
	 * query is mirrored here and matched in `hits` instead. A search mounts
	 * every row at once: each late row resets Sivir's filtered results.
	 */
	function mirrorQuery(node: HTMLElement): () => void {
		const onInput = (event: Event) => {
			query = (event.target as HTMLInputElement).value;
			grown = models.length;
		};

		node.addEventListener('input', onInput);

		return () => node.removeEventListener('input', onInput);
	}

	/**
	 * Lands on the current model, and starts the next open from the window
	 * again once the content unmounts, after its exit, so a closing list
	 * never shrinks.
	 */
	function openWindow(node: HTMLElement): () => void {
		landOnCurrent(node.closest<HTMLElement>('.model-dialog') ?? node);

		return () => (grown = 0);
	}

	/** Switching to a model that lacks the current effort resets to its default. */
	function pickModel(next: ModelOption): void {
		picked = true;
		onSelect({ modelId: next.id, effort: resolveEffort(next, effort) });
	}

	function pickEffort(next: string): void {
		if (model && next !== effort) onSelect({ modelId: model.id, effort: next as ReasoningEffort });
	}
</script>

<div class="model-picker">
	<Command.Root bind:open>
		<Command.Trigger
			variant="quiet"
			class="quiet-trigger"
			disabled={models.length === 0}
			aria-label="{role} model: {model?.displayName ?? placeholder}"
		>
			{#key model?.id}
				<span class="quiet-trigger-label" data-picked={picked || undefined}>
					{#if model}
						{model.displayName}
					{:else if !modelSettingsUi.config && !modelSettingsUi.error}
						<Skeleton class="model-trigger-skeleton" />
					{:else}
						<span class="text-fg-subtle">{placeholder}</span>
					{/if}
				</span>
			{/key}
		</Command.Trigger>
		<Command.Content class="model-dialog" label="Choose the {role} model">
			<div class="palette-search" {@attach mirrorQuery} {@attach arrowKeys}>
				<Command.Search placeholder="Search {models.length} models" />
				<span class="palette-scope">{role} model</span>
			</div>
			<Command.Results>
				<span hidden {@attach openWindow}></span>
				{#if onFollow}
					<Command.Item value={followHit ? q : MISS} callback={onFollow}>
						{@render check(!value)}
						<span class="min-w-0 flex-1 truncate">{placeholder}</span>
					</Command.Item>
				{/if}
				{#each groups as { heading, options, start } (heading)}
					<Command.Group {heading}>
						{#if options.some((option) => hits.has(option.id))}
							<p class="palette-label" aria-hidden="true">{heading}</p>
						{/if}
						{@const { before, after } = pending(start, options.length)}
						{@render skeletonRows(before)}
						{#each options.slice(before, options.length - after) as option (option.id)}
							<Command.Item value={hits.has(option.id) ? q : MISS} callback={() => pickModel(option)}>
								{@render check(option.id === model?.id)}
								<span class="min-w-0 flex-1 truncate">{option.displayName}</span>
								{#if option.contextWindow}
									<span class="palette-meta font-mono">{formatContextWindow(option.contextWindow)}</span>
								{/if}
							</Command.Item>
						{/each}
						{@render skeletonRows(after)}
					</Command.Group>
				{/each}
			</Command.Results>
			<footer class="palette-footer">
				<span><kbd class="keycap">↑↓</kbd> navigate</span>
				<span><kbd class="keycap">↵</kbd> choose</span>
				<span><kbd class="keycap">esc</kbd> close</span>
			</footer>
		</Command.Content>
	</Command.Root>

	{#if model?.efforts && effort}
		<Select.Root value={effort} onValueChange={pickEffort}>
			<Select.Trigger variant="quiet" class="quiet-trigger effort-trigger" aria-label="{role} reasoning effort">
				{effortLabel(effort)}
			</Select.Trigger>
			<Select.Content class="effort-menu">
				{#each model.efforts as option (option.id)}
					<Select.Item value={option.id} label={option.label} class="effort-option">
						<span class="flex min-w-0 flex-1 flex-col gap-px text-left">
							<span class="text-[13px]">{option.label}</span>
							<span class="text-[11.5px] text-fg-faint">{option.description}</span>
						</span>
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	{/if}
</div>

{#snippet check(on: boolean)}
	<span class="flex w-3 shrink-0 justify-center text-fg-muted" data-current={on || undefined} aria-hidden="true">
		{#if on}<Check size={13} />{/if}
	</span>
{/snippet}

{#snippet skeletonRows(rows: number)}
	{#if rows > 0}
		<span class="model-rows-pending" style:--rows={rows} aria-hidden="true">
			{#each { length: Math.min(rows, 14) } as _, bar (bar)}
				<Skeleton class="model-row-skeleton" />
			{/each}
		</span>
	{/if}
{/snippet}
