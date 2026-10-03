<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { SUBAGENT_CAPS, type SubagentCap } from '@recoder/shared';
	import SegmentedControl from '$lib/components/ui/segmented-control.svelte';
	import { settingsDraft } from '$lib/settings/settings-draft.svelte';

	const FIELDS = [
		{ key: 'maxFiles', name: 'Files per review', desc: 'Larger PRs are reviewed in part', max: 200 },
		{ key: 'maxDiffChars', name: 'Diff characters', desc: 'Total diff sent to reviewers', max: 1_000_000 },
		{ key: 'maxFileChars', name: 'Characters per file', desc: 'Longer files are truncated', max: 200_000 }
	] as const;

	const SUBAGENT_ITEMS = SUBAGENT_CAPS.map((cap) => ({ value: String(cap), label: cap ? `Up to ${cap}` : 'Off' }));

	/** What each cap allows; shown under the control for the current pick. */
	const SUBAGENT_DESC: Record<SubagentCap, string> = {
		0: 'Each reviewer works alone. Fewest tokens',
		2: 'Reviewers can hand up to 2 deep questions to subagents',
		4: 'Up to 4 subagents per review. Most tokens'
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
				<p class="settings-row-name">Subagents</p>
				<p class="settings-row-desc">{SUBAGENT_DESC[settingsDraft.subagentCap]}</p>
			</div>
			<SegmentedControl
				label="Subagents"
				items={SUBAGENT_ITEMS}
				value={String(settingsDraft.subagentCap)}
				onValueChange={(value) => (settingsDraft.subagentCap = Number(value) as SubagentCap)}
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
