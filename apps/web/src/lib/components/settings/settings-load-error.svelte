<script lang="ts">
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { modelSettingsUi } from '$lib/settings/model-settings.svelte';
</script>

<Alert.Root variant="error">
	<Alert.Title>Could not load settings</Alert.Title>
	<Alert.Description>{modelSettingsUi.error}</Alert.Description>
	<Button variant="outline" class="mt-2 w-fit" onclick={() => void modelSettingsUi.load()}>Retry</Button>
</Alert.Root>
