<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import { Switch } from '@sivir-ui/svelte/components/switch';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import {
		SUBAGENT_CAPS,
		TOKEN_BUDGETS,
		TOKEN_BUDGET_PLANS,
		budgetDescription,
		subagentCapFrom,
		tokenBudgetFrom,
		type SubagentCap
	} from '@recoder/shared';
	import SegmentedControl from '$lib/components/ui/segmented-control.svelte';
	import { settingsDraft } from '$lib/settings/settings-draft.svelte';

	const FIELDS = [
		{ key: 'maxFiles', name: 'Files per review', desc: 'Larger PRs are reviewed in part', max: 200 },
		{ key: 'maxDiffChars', name: 'Diff characters', desc: 'Total diff sent to reviewers', max: 1_000_000 },
		{ key: 'maxFileChars', name: 'Characters per file', desc: 'Longer files are truncated', max: 200_000 }
	] as const;

	const SUBAGENT_ITEMS = SUBAGENT_CAPS.map((cap) => ({
		value: String(cap),
		label: cap === 'uncapped' ? 'Uncapped' : cap ? `Up to ${cap}` : 'Off'
	}));

	const BUDGET_ITEMS = TOKEN_BUDGETS.map((budget) => ({ value: budget, label: TOKEN_BUDGET_PLANS[budget].label }));

	/** Custom is shown while the cap or an effort is changed by hand; picking a budget takes it away. */
	const shownBudget = $derived(settingsDraft.shownBudget);
	const budgetItems = $derived(shownBudget ? BUDGET_ITEMS : [...BUDGET_ITEMS, { value: 'custom', label: 'Custom' }]);

	/** What each cap allows; shown under the control for the current pick. */
	const SUBAGENT_DESC: Record<SubagentCap, string> = {
		0: 'Each reviewer works alone. Fewest tokens',
		3: 'Up to 3 deep dives per review',
		8: 'Up to 8 deep dives per review',
		12: 'Up to 12 deep dives per review',
		uncapped: 'One per open question. Far more tokens and time'
	};

	function setLimit(key: (typeof FIELDS)[number]['key'], max: number, raw: string): void {
		const n = Math.round(Number(raw));

		if (Number.isFinite(n) && n > 0) settingsDraft.limits = { ...settingsDraft.limits, [key]: Math.min(n, max) };
	}
</script>

<section class="settings-section" aria-labelledby="harness-reviewers">
	<Typography.H3 id="harness-reviewers" class="settings-label">Reviewers</Typography.H3>
	<Card.Root class="settings-list">
		<div class="settings-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Token budget</p>
				<p class="settings-row-desc">{budgetDescription(settingsDraft.tokenBudget, shownBudget === null)}</p>
			</div>
			<SegmentedControl
				label="Token budget"
				items={budgetItems}
				value={shownBudget ?? 'custom'}
				onValueChange={(value) => {
					const budget = tokenBudgetFrom(value);

					if (budget) settingsDraft.pickBudget(budget);
				}}
			/>
		</div>
		<div class="settings-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Subagents</p>
				<p class="settings-row-desc">{SUBAGENT_DESC[settingsDraft.subagentCap]}</p>
			</div>
			<SegmentedControl
				label="Subagents"
				items={SUBAGENT_ITEMS}
				value={String(settingsDraft.subagentCap)}
				onValueChange={(value) => (settingsDraft.subagentCap = subagentCapFrom(value))}
			/>
		</div>
		<div class="settings-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Low severity findings</p>
				<p class="settings-row-desc">
					{settingsDraft.reportLowSeverity ? 'Reviews report every severity' : 'Reviews report medium and above'}
				</p>
			</div>
			<Switch
				switched={settingsDraft.reportLowSeverity}
				onclick={() => (settingsDraft.reportLowSeverity = !settingsDraft.reportLowSeverity)}
				aria-label="Low severity findings"
			/>
		</div>
	</Card.Root>
</section>

<section class="settings-section" aria-labelledby="harness-limits">
	<Typography.H3 id="harness-limits" class="settings-label">Review limits</Typography.H3>
	<Card.Root class="settings-list">
		{#each FIELDS as field (field.key)}
			<div class="settings-row">
				<div class="min-w-0 flex-1">
					<p class="settings-row-name">{field.name}</p>
					<p class="settings-row-desc">{field.desc}</p>
				</div>
				<div class="settings-number">
					<Input
						type="number"
						min="1"
						max={field.max}
						aria-label={field.name}
						value={settingsDraft.limits[field.key]}
						onchange={(event) => setLimit(field.key, field.max, (event.currentTarget as HTMLInputElement).value)}
					/>
				</div>
			</div>
		{/each}
	</Card.Root>
</section>
