<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Composer from '@sivir-ui/svelte/components/composer';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';

	interface Props {
		value?: string;
		inputEl?: HTMLTextAreaElement;
		placeholder: string;
		label: string;
		/** Sending the message (request in flight). */
		sending?: boolean;
		/** A reply is streaming; Send becomes Stop. */
		generating?: boolean;
		/** The review is working or a reply is arriving: a ring spins around Send; Send still sends. */
		busy?: boolean;
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
		/** Bar items after the + button ("Shared with Orchestrator", sources). */
		leading?: Snippet;
		/** Bar items on the right (model, effort). */
		trailing?: Snippet;
	}

	let {
		value = $bindable(''),
		inputEl = $bindable(),
		placeholder,
		label,
		sending = false,
		generating = false,
		busy = false,
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
		trailing
	}: Props = $props();

	/** While a reply is pending the button is always Stop, even with text typed. */
	function stopClick(event: MouseEvent): void {
		if (!generating) return;
		event.preventDefault();
		void onStop?.();
	}

	/** A press anywhere on the composer's surface (padding, footer gaps, chips) focuses the input. */
	function focusInput(event: PointerEvent): void {
		if (disabled || event.button !== 0 || !inputEl) return;

		const target = event.target as HTMLElement;

		if (
			target === inputEl ||
			target.closest(
				'button, a, input, textarea, select, label, [role="button"], [role="combobox"], [contenteditable="true"]'
			)
		)
			return;
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
	<div class="rc-composer-box">
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
		<Composer.Toolbar class="rc-composer-bar" aria-label="Message options">
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
					<Plus size={16} strokeWidth={1.75} aria-hidden="true" />
				</Button>
			{/if}
			{@render leading?.()}
			<span class="flex-1"></span>
			{@render trailing?.()}
			<span class="rc-send-wrap">
				<Composer.Submit class="rc-send" disabled={generating && !onStop} onclick={stopClick}>
					{#snippet children({ action })}
						{#if sending && !generating}
							<Spinner size={14} aria-hidden="true" />
						{:else if generating || action === 'stop'}
							<span class="rc-stop" aria-hidden="true"></span>
						{:else}
							<ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
						{/if}
					{/snippet}
				</Composer.Submit>
				{#if (busy || generating) && !sending}
					<Spinner size={36} class="rc-send-ring" aria-label="Working" />
				{/if}
			</span>
		</Composer.Toolbar>
	</div>
</Composer.Root>
