'use client';

import type { AgentAuthPrompt } from '@recoder/shared';
import { Field, Input, RadioGroup, Select, StatusNotice } from '@recoder/ui';
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

import { METHOD_FORM, type ProviderFlow } from '@/lib/settings/providers/use-provider-flow';

/** "server" → "Server": the agent's prompt text, read as a label. */
function asLabel(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A label over a control that is a group of its own (option cards, a select),
 * which a `Field` label cannot point at. The control carries the same words
 * as its accessible name.
 */
function Choice({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="provider-choice">
			<span className="provider-choice-label">{label}</span>
			{children}
		</div>
	);
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
					data-autofocus=""
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
		<Choice label={label}>
			<Select
				aria-label={label}
				className="provider-select"
				value={value}
				onValueChange={onChange}
				options={options}
				disabled={readOnly}
			/>
		</Choice>
	);
}

/** Moves focus into the form when it first shows: to the first field to type in, else to the first control. */
function focusFirst(form: HTMLFormElement | null): void {
	const target =
		form?.querySelector<HTMLElement>('[data-autofocus]') ??
		form?.querySelector<HTMLElement>('[role="radio"][data-state="checked"], input, button');

	target?.focus();
}

/** The key the agent saves. The field only takes a key in; a saved one never comes back to the page. */
function KeyField({ flow }: { flow: ProviderFlow }) {
	return (
		<Field label="API key" hint="Saved by OpenCode on this machine." error={flow.error}>
			<Input
				type="password"
				autoComplete="off"
				spellCheck={false}
				data-autofocus=""
				value={flow.key}
				readOnly={flow.sending}
				onChange={(event) => flow.setKey(event.target.value)}
			/>
		</Field>
	);
}

/** What a browser sign-in does next, and why the last one did not land. */
function SignInNote({ error }: { error: string | null }) {
	return (
		<div className="provider-notes">
			<p className="provider-note">Opens the provider’s sign-in page in a new tab.</p>
			{error ? <StatusNotice variant="inline" tone="danger" title={error} /> : null}
		</div>
	);
}

/**
 * Step two: how to connect the chosen provider. A choice of methods when it
 * has several, the questions the chosen method asks (some only after an
 * earlier answer), then an API key or a note that sign-in opens a new tab.
 * While the server checks them, the fields hold still.
 */
export function MethodForm({ flow }: { flow: ProviderFlow }) {
	const form = useRef<HTMLFormElement>(null);
	const { method, methods } = flow;

	useEffect(() => {
		focusFirst(form.current);
	}, []);

	if (!method) return null;

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		flow.submit();
	}

	return (
		<form ref={form} id={METHOD_FORM} className="provider-form" onSubmit={submit}>
			{methods.length > 1 ? (
				<Choice label="Connect with">
					<RadioGroup
						aria-label="Connect with"
						value={String(method.index)}
						onValueChange={flow.setMethod}
						options={methods.map((item) => ({ value: String(item.index), label: item.label }))}
					/>
				</Choice>
			) : null}
			{flow.prompts.map((prompt) => (
				<PromptField
					key={prompt.key}
					prompt={prompt}
					value={flow.answers[prompt.key] ?? ''}
					readOnly={flow.sending}
					onChange={(value) => flow.answer(prompt.key, value)}
				/>
			))}
			{method.type === 'api' ? <KeyField flow={flow} /> : <SignInNote error={flow.error} />}
		</form>
	);
}
