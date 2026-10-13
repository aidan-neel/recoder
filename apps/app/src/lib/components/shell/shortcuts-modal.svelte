<script lang="ts">
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import Keycap from '../ui/keycap.svelte';
	import { shell } from '$lib/shell/shell.svelte';

	const GROUPS: { title: string; keys: [string[], string][] }[] = [
		{
			title: 'Reviewing',
			keys: [
				[['Enter'], 'Start with the riskiest'],
				[['a'], 'Accept: it ships as is'],
				[['s'], 'Send back to the agent'],
				[['x'], 'Not an issue: never raise it again'],
				[['u'], 'Undo the last decision'],
				[['h'], 'Hand off what you sent back'],
				[['f'], 'Open the file'],
				[['o'], 'Back to the overview']
			]
		},
		{
			title: 'Moving',
			keys: [
				[['j', 'k'], 'Next and previous'],
				[['ArrowDown', 'ArrowUp'], 'Next and previous'],
				[['r'], 'Review the selected pull request']
			]
		},
		{
			title: 'Anywhere',
			keys: [
				[['mod+k'], 'Search'],
				[['?'], 'These shortcuts']
			]
		}
	];
</script>

<Modal.Root bind:open={shell.shortcutsOpen}>
	<Modal.Content size="md" class="shortcuts" aria-label="Keyboard shortcuts">
		<Modal.Header>
			<Modal.Title>Keyboard shortcuts</Modal.Title>
		</Modal.Header>
		<Modal.Body class="shortcuts-body">
			{#each GROUPS as group (group.title)}
				<section class="shortcuts-group" aria-label={group.title}>
					<h3 class="shortcuts-title">{group.title}</h3>
					<dl class="shortcuts-list">
						{#each group.keys as [keys, label] (label + keys.join())}
							<div class="shortcuts-row">
								<dt>{label}</dt>
								<dd>
									{#each keys as key (key)}<Keycap {key} />{/each}
								</dd>
							</div>
						{/each}
					</dl>
				</section>
			{/each}
		</Modal.Body>
	</Modal.Content>
</Modal.Root>
