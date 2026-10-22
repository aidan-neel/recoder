'use client';

import type { AgentAuthPrompt } from '@recoder/shared';
import { Field, Input, RadioGroup, Select } from '@recoder/ui';
import { useEffect, useRef, type FormEvent } from 'react';

import { shownPrompts } from '@/lib/settings/provider-options';
import type { ProviderFlow } from './use-provider-flow';

/** The id the footer's submit button points at. */
export const METHOD_FORM = 'provider-connect';

/** "server" → "Server": the agent's prompt text, read as a label. */
function asLabel(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

interface PromptFieldProps {
	prompt: AgentAuthPrompt;
	value: string;
	/** True while the answer is with the server; a text answer then holds still. */
	readOnly: boolean;
	onChange: (value: string) => void;
}

/** One question the agent asks before it signs in: a text field, or a choice from its options. */
function PromptField({ prompt, value, readOnly, onChange }: PromptFieldProps) {
	const label = asLabel(prompt.message);

	if (prompt.type === 'text') {
		return (
			<Field label={label}>
				<Input
					placeholder={prompt.placeholder ?? undefined}
					autoComplete="off"
					spellCheck={false}
					value={value}
					readOnly={readOnly}
					onChange={(event) => onChange(event.target.value)}
				/>
			</Field>
		);
	}

	const options = prompt.options.map((option) => ({
		value: option.value,
		label: option.label,
		description: option.hint ?? undefined
	}));

	return (
		<div data-ui="field">
			<span data-ui="field-label">{label}</span>
			<Select aria-label={label} value={value} onValueChange={onChange} options={options} className="w-full" />
		</div>
	);
}

/** Moves focus into the form when it first shows: the key field when there is one, else the first control. */
function focusFirst(form: HTMLFormElement | null): void {
	const target =
		form?.querySelector<HTMLElement>('[data-autofocus]') ??
		form?.querySelector<HTMLElement>('[role="radio"][data-state="checked"], input, button');

	target?.focus();
}

/**
 * Step two: how to connect the chosen provider. A choice of methods when it
 * has several, the questions the chosen method asks (some only after an
 * earlier answer), then an API key or a note that sign-in opens a new tab.
 * While the server checks them, the fields hold still.
 */
export function MethodForm({ flow }: { flow: ProviderFlow }) {
	const form = useRef<HTMLFormElement>(null);
	const { method, methods, answers, error, sending } = flow;

	useEffect(() => {
		focusFirst(form.current);
	}, []);

	if (!method) return null;

	const prompts = shownPrompts(method, answers);

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		flow.submit();
	}

	return (
		<form ref={form} id={METHOD_FORM} className="provider-form" onSubmit={submit}>
			{methods.length > 1 ? (
				<div data-ui="field">
					<span data-ui="field-label">Connect with</span>
					<RadioGroup
						aria-label="Connect with"
						value={String(method.index)}
						onValueChange={flow.setMethod}
						options={methods.map((item) => ({ value: String(item.index), label: item.label }))}
					/>
				</div>
			) : null}
			{prompts.map((prompt) => (
				<PromptField
					key={prompt.key}
					prompt={prompt}
					value={answers[prompt.key] ?? ''}
					readOnly={sending}
					onChange={(value) => flow.answer(prompt.key, value)}
				/>
			))}
			{method.type === 'api' ? (
				<Field label="API key" hint="Saved by OpenCode on this machine." error={error}>
					<Input
						type="password"
						autoComplete="off"
						spellCheck={false}
						data-autofocus=""
						value={flow.key}
						readOnly={sending}
						onChange={(event) => flow.setKey(event.target.value)}
					/>
				</Field>
			) : (
				<div className="provider-notes">
					<p className="provider-note">Opens the provider’s sign-in page in a new tab.</p>
					{error ? (
						<p role="alert" className="provider-error">
							{error}
						</p>
					) : null}
				</div>
			)}
		</form>
	);
}
