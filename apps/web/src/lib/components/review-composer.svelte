<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Composer from '@sivir-ui/svelte/components/composer';

	interface Props {
		value?: string;
		inputEl?: HTMLTextAreaElement;
		placeholder: string;
		label: string;
		/** Sending the message (request in flight). */
		sending?: boolean;
		/** A reply is streaming; Send becomes Stop. */
		generating?: boolean;
		disabled?: boolean;
		maxlength?: number;
		describedBy?: string;
		invalid?: boolean;
		/** 740px main composer or the 28px-control side-panel composer. */
		size?: 'main' | 'panel';
		onSubmit: (text: string) => void | Promise<void>;
		onStop?: () => void | Promise<void>;
		onAttach?: () => void;
		attachDisabled?: boolean;
		attachLabel?: string;
		oninput?: () => void;
		/** Chips above the input (selected code, attachments). */
		context?: Snippet;
		/** Footer items after the paperclip ("Shared with Orchestrator", Resolve…). */
		leading?: Snippet;
		/** The model picker, just before Send. */
		picker?: Snippet;
	}

	let {
		value = $bindable(''),
		inputEl = $bindable(),
		placeholder,
		label,
		sending = false,
		generating = false,
		disabled = false,
		maxlength,
		describedBy,
		invalid = false,
		size = 'main',
		onSubmit,
		onStop,
		onAttach,
		attachDisabled = false,
		attachLabel = 'Attach a file',
		oninput,
		context,
		leading,
		picker
	}: Props = $props();

	function stopClick(event: MouseEvent): void {
		// While a reply is pending the button is always Stop, even with text typed.
		if (!generating) return;
		event.preventDefault();
		void onStop?.();
	}

	/** A press anywhere on the composer's surface (padding, footer gaps, chips) focuses the input. */
	function focusInput(event: PointerEvent): void {
		if (disabled || event.button !== 0 || !inputEl) return;
		const target = event.target as HTMLElement;
		if (target === inputEl || target.closest('button, a, input, textarea, select, label, [role="button"], [role="combobox"], [contenteditable="true"]')) return;
		event.preventDefault();
		if (document.activeElement === inputEl) return;
		inputEl.focus();
		inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
	}
</script>

<Composer.Root
	bind:value
	onSubmit={(text) => onSubmit(text)}
	onStop={onStop ? () => void onStop() : undefined}
	{generating}
	status={sending ? 'submitting' : 'idle'}
	{disabled}
	data-size={size}
	class="rc-composer"
	onpointerdown={focusInput}
>
	{@render context?.()}
	<Composer.Input
		bind:element={inputEl}
		rows={1}
		class="rc-composer-input"
		aria-label={label}
		aria-describedby={describedBy}
		aria-invalid={invalid ? 'true' : undefined}
		{placeholder}
		{maxlength}
		{oninput}
	/>
	<Composer.Toolbar class="rc-composer-footer" aria-label="Message options">
		{#if onAttach}
			<Button
				variant="ghost"
				size="icon"
				class="rc-attach"
				aria-label={attachLabel}
				title={attachLabel}
				disabled={disabled || attachDisabled || sending}
				onclick={onAttach}
			>
				<Paperclip size={14} aria-hidden="true" />
			</Button>
		{/if}
		{@render leading?.()}
		<span class="flex-1"></span>
		{@render picker?.()}
		<Composer.Submit class="rc-send" disabled={generating && !onStop} onclick={stopClick}>
			{#snippet children({ action })}
				{#if generating || action === 'stop'}
					<span class="rc-stop" aria-hidden="true"></span>
				{:else}
					<ArrowUp size={size === 'panel' ? 15 : 16} strokeWidth={1.75} aria-hidden="true" />
				{/if}
			{/snippet}
		</Composer.Submit>
	</Composer.Toolbar>
</Composer.Root>
