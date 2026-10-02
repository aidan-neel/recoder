<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import SegmentedControl from '$lib/components/ui/segmented-control.svelte';
	import { theme, type ThemeChoice } from '$lib/settings/theme.svelte';

	const ITEMS = [
		{ value: 'system', label: 'System' },
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' }
	];
</script>

<section class="settings-section" aria-labelledby="appearance-display">
	<Typography.H3 id="appearance-display" class="settings-label">Display</Typography.H3>
	<Card.Root class="settings-list">
		<div class="settings-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Theme</p>
				<p class="settings-row-desc">System follows your device</p>
			</div>
			<SegmentedControl
				label="Theme"
				items={ITEMS}
				value={theme.choice}
				onValueChange={(value) => theme.set(value as ThemeChoice)}
			/>
		</div>
	</Card.Root>
</section>
