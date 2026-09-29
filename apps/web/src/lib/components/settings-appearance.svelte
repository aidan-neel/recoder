<script lang="ts">
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
</script>

<section class="settings-section" aria-labelledby="appearance-display">
	<Typography.H3 id="appearance-display" class="settings-label">Display</Typography.H3>
	<Card.Root class="settings-list">
		<div class="settings-row">
			<div class="min-w-0 flex-1">
				<p class="settings-row-name">Theme</p>
				<p class="settings-row-desc">Recoder uses a dark theme</p>
			</div>
			<span class="text-[12.5px] text-fg-subtle">Dark</span>
		</div>
	</Card.Root>
</section>
