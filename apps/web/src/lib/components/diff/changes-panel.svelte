<script lang="ts">
	import { parseUnifiedDiff } from '@recoder/shared';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Checkbox } from '@sivir-ui/svelte/components/checkbox';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Sheet from '@sivir-ui/svelte/components/sheet';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Textarea } from '@sivir-ui/svelte/components/textarea';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { changesStore } from '$lib/diff/changes.svelte';
	import { diffPrefs } from '$lib/diff/diff-prefs.svelte';
	import CodeDiff from './code-diff.svelte';
	import Disclosure from '../ui/disclosure.svelte';

	/**
	 * Applied fixes wait here: the developer picks the files, writes the commit
	 * message, commits, and pushes, each as its own step.
	 */
	let { branch = null }: { branch?: string | null } = $props();

	const data = $derived(changesStore.data);
	const selected = $derived(changesStore.selected);
	const canCommit = $derived(selected.length > 0 && changesStore.message.trim().length > 0 && !changesStore.busy);
	let discarding = $state<string[] | null>(null);
	const STATUS_LABEL = { added: 'Added', modified: 'Modified', deleted: 'Deleted', renamed: 'Renamed' } as const;
</script>

<Sheet.Root bind:open={changesStore.open}>
	<Sheet.Content
		side="right"
		class="changes-sheet w-[560px] max-w-[calc(100%-1rem)] [&>[data-ui=sheet-surface]]:bg-background [&>[data-ui=sheet-surface]]:p-0"
	>
		<div class="changes-panel">
			<header class="changes-head">
				<Sheet.Title class="changes-title">Changes</Sheet.Title>
				{#if branch}<span class="changes-branch font-mono" title="Pushes go to this branch">{branch}</span>{/if}
				{#if changesStore.loading}<Spinner size={13} class="ms-auto text-fg-faint" aria-label="Refreshing" />{/if}
			</header>
			<ScrollArea orientation="vertical" showCues={false} class="min-h-0 flex-1">
				<div class="changes-body">
					{#if changesStore.error}
						<Typography.Text class="text-sm text-danger" role="alert">{changesStore.error}</Typography.Text>
					{:else if data && !data.files.length && !data.commits.length}
						<Typography.Text class="changes-empty"
							>No changes. Applied fixes show up here to commit and push.</Typography.Text
						>
					{/if}

					{#if data?.files.length}
						<section class="changes-section" aria-labelledby="changes-files">
							<div class="changes-section-head">
								<Typography.H3 id="changes-files" class="changes-label">Not committed</Typography.H3>
								<Button
									variant="ghost"
									class="ms-auto"
									disabled={!!changesStore.busy}
									onclick={() => (discarding = data.files.map((file) => file.path))}>Discard all</Button
								>
							</div>
							<ul class="changes-files">
								{#each data.files as file (file.path)}
									{@const diff = parseUnifiedDiff(file.patch)[0]}
									<li class="changes-file">
										<div class="changes-file-row">
											<Checkbox
												class="changes-check"
												label={file.path}
												checked={!changesStore.excluded.includes(file.path)}
												onCheckedChange={(checked: boolean) => changesStore.toggle(file.path, checked)}
											/>
											<Badge variant="secondary" class="ms-auto shrink-0">{STATUS_LABEL[file.status]}</Badge>
											<Button
												variant="ghost"
												size="icon"
												aria-label="Discard changes to {file.path}"
												title="Discard changes"
												disabled={!!changesStore.busy}
												onclick={() => (discarding = [file.path])}><Undo2 size={14} aria-hidden="true" /></Button
											>
										</div>
										{#if diff?.hunks.length}
											<Disclosure size="sm" class="changes-diff">
												{#snippet label()}Show diff · <span class="text-success">+{diff.additions}</span>
													<span class="text-danger">−{diff.deletions}</span>{/snippet}
												<CodeDiff
													{diff}
													findings={[]}
													mode={diffPrefs.mode === 'split' ? 'unified' : diffPrefs.mode}
													cards={false}
												/>
											</Disclosure>
										{/if}
									</li>
								{/each}
							</ul>
							<div class="changes-commit">
								<Textarea
									bind:value={changesStore.message}
									autoresize
									rows={3}
									placeholder="Commit message"
									aria-label="Commit message"
									spellcheck="true"
									onkeydown={(event: KeyboardEvent) => {
										if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
											event.preventDefault();
											void changesStore.commit();
										}
									}}
								/>
								<Button
									variant="primary"
									class="self-end"
									disabled={!canCommit}
									loading={changesStore.busy === 'commit'}
									onclick={() => void changesStore.commit()}
								>
									Commit {selected.length}
									{selected.length === 1 ? 'file' : 'files'}
								</Button>
							</div>
						</section>
					{/if}

					{#if data?.commits.length}
						<section class="changes-section" aria-labelledby="changes-commits">
							<div class="changes-section-head">
								<Typography.H3 id="changes-commits" class="changes-label">Not pushed</Typography.H3>
							</div>
							<ul class="changes-commits">
								{#each data.commits as commit, i (commit.sha)}
									<li class="changes-commit-row">
										<span class="changes-sha font-mono">{commit.sha.slice(0, 7)}</span>
										<span class="changes-subject" title={commit.subject}>{commit.subject}</span>
										{#if i === 0}<Button
												variant="ghost"
												class="ms-auto shrink-0"
												disabled={!!changesStore.busy}
												loading={changesStore.busy === 'undo'}
												onclick={() => void changesStore.undoCommit()}>Undo</Button
											>{/if}
									</li>
								{/each}
							</ul>
							<Button
								variant="primary"
								class="self-end"
								title={branch ? `Push to ${branch}` : undefined}
								disabled={!!changesStore.busy}
								loading={changesStore.busy === 'push'}
								onclick={() => void changesStore.push()}
							>
								Push {data.commits.length}
								{data.commits.length === 1 ? 'commit' : 'commits'}
							</Button>
						</section>
					{/if}
				</div>
			</ScrollArea>
		</div>
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root
	bind:open={
		() => discarding !== null,
		(open) => {
			if (!open) discarding = null;
		}
	}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title
				>Discard {discarding?.length === 1
					? 'these changes'
					: `changes to ${discarding?.length ?? 0} files`}?</AlertDialog.Title
			>
			<AlertDialog.Description
				>{discarding?.length === 1 ? discarding[0] : 'Every uncommitted change'} goes back to the last commit. New files are
				deleted. This can't be undone.</AlertDialog.Description
			>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>Cancel</AlertDialog.Exit>
			<AlertDialog.Confirm
				variant="destructive"
				onclick={() => {
					const paths = discarding ?? [];

					discarding = null;
					void changesStore.discard(paths);
				}}>Discard</AlertDialog.Confirm
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
