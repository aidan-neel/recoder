<script lang="ts">
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Tooltip from '@sivir-ui/svelte/components/tooltip';
	import { theme, type ThemeChoice } from '$web/settings/theme.svelte';

	const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
	const LABEL: Record<ThemeChoice, string> = {
		system: 'Theme: match system',
		light: 'Theme: light',
		dark: 'Theme: dark'
	};
</script>

<Tooltip.Root placement="bottom">
	<Tooltip.Trigger>
		<Button variant="ghost" size="icon" aria-label={LABEL[theme.choice]} onclick={() => theme.set(NEXT[theme.choice])}>
			<span class="swap icon-swap" aria-hidden="true">
				<span data-on={theme.choice === 'system'}><Monitor size={15} /></span>
				<span data-on={theme.choice === 'light'}><Sun size={15} /></span>
				<span data-on={theme.choice === 'dark'}><Moon size={15} /></span>
			</span>
		</Button>
	</Tooltip.Trigger>
	<Tooltip.Content>{LABEL[theme.choice]}</Tooltip.Content>
</Tooltip.Root>
