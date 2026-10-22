'use client';

import type { AgentAuthMethod, AgentOAuthAttempt, AgentProvider } from '@recoder/shared';
import type { ButtonStatus } from '@recoder/ui';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { failureText } from '@/lib/api/http';
import { settingsApi } from '@/lib/api/settings';
import { useSettings } from '@/lib/settings/settings-store';
import { undoToast } from '@/lib/shell/notify';

import {
	answersFor,
	deviceCode,
	firstAnswers,
	methodsOf,
	missingAnswer,
	shownPrompts,
	type Answers
} from '@/lib/settings/provider-options';

/** The list of providers, then one provider's sign-in. */
type Step = 'pick' | 'connect';

/** What the body shows: the list, the connect form, or a browser sign-in under way. */
type View = 'pick' | 'connect' | 'sign-in';

/** How often a browser sign-in is checked on while it runs. */
const POLL_MS = 1500;

/** How long the button shows "Connected" before the modal closes. */
const CONNECTED_MS = 700;

/** Everything the modal shows and does, from the list to a finished sign-in. */
export interface ProviderFlow {
	view: View;
	/** 1 going deeper (list → provider → sign-in), -1 going back; steers the slide. */
	direction: 1 | -1;
	/** A sign-in under way goes back to its form; a provider picked from the list goes back to the list. */
	canGoBack: boolean;
	query: string;
	provider: AgentProvider | null;
	methods: AgentAuthMethod[];
	method: AgentAuthMethod | null;
	answers: Answers;
	key: string;
	code: string;
	attempt: AgentOAuthAttempt | null;
	/** The code to type on the provider's page, when its instructions carry one. */
	device: string | null;
	status: ButtonStatus;
	/** A key, a sign-in start or a code is with the server: the fields hold still and the modal stays open until it answers. */
	sending: boolean;
	error: string | null;
	title: string;
	submitLabel: string;
	canSubmit: boolean;
	setQuery: (query: string) => void;
	choose: (provider: AgentProvider) => void;
	back: () => void;
	setMethod: (index: string) => void;
	answer: (key: string, value: string) => void;
	setKey: (key: string) => void;
	setCode: (code: string) => void;
	submit: () => void;
}

/** The primary button's label for where the sign-in stands. */
function submitLabelFor(method: AgentAuthMethod | null, attempt: AgentOAuthAttempt | null): string {
	if (attempt?.mode === 'code') return 'Finish sign-in';

	return method?.type === 'oauth' ? 'Sign in' : 'Connect';
}

/**
 * The provider modal's state. `preset` opens straight on that provider's
 * sign-in. A browser sign-in is checked every 1.5s until it settles; leaving
 * it (Back, or closing the modal) cancels it on the server. Once connected,
 * the modal closes after the button shows it; a modal closed sooner leaves
 * no timer behind to close the next one.
 */
export function useProviderFlow(preset: AgentProvider | null, close: () => void): ProviderFlow {
	const [step, setStep] = useState<Step>(preset ? 'connect' : 'pick');
	const [direction, setDirection] = useState<1 | -1>(1);
	const [fromList, setFromList] = useState(!preset);
	const [query, setQuery] = useState('');
	const [provider, setProvider] = useState<AgentProvider | null>(preset);
	const [methodIndex, setMethodIndex] = useState(preset ? String(methodsOf(preset)[0].index) : '');
	const [answers, setAnswers] = useState<Answers>(preset ? firstAnswers(preset) : {});
	const [key, setKeyText] = useState('');
	const [code, setCodeText] = useState('');
	const [attempt, setAttempt] = useState<AgentOAuthAttempt | null>(null);
	const [status, setStatus] = useState<ButtonStatus>('idle');
	const [error, setError] = useState<string | null>(null);

	/** The attempt that finished, so leaving afterwards does not cancel it. */
	const finished = useRef<string | null>(null);

	const onConnected = useEffectEvent(close);

	useEffect(() => {
		if (status !== 'success') return;

		const timer = setTimeout(onConnected, CONNECTED_MS);

		return () => clearTimeout(timer);
	}, [status]);

	const methods = provider ? methodsOf(provider) : [];
	const method = methods.find((item) => String(item.index) === methodIndex) ?? methods[0] ?? null;
	const prompts = method ? shownPrompts(method, answers) : [];
	const missing = missingAnswer(prompts, answers);
	const sending = status === 'pending' && attempt?.mode !== 'auto';

	/** Clears a failure once the reader changes what they typed or chose. */
	function edited(): void {
		setError(null);
		setStatus((now) => (now === 'error' ? 'idle' : now));
	}

	/** The provider is connected: the new list goes to Settings, a toast says so, and the modal closes after the button shows it. */
	function connected(providers: AgentProvider[] | null): void {
		if (providers) useSettings.getState().setProviders(providers);

		setStatus('success');
		undoToast(`Connected ${provider?.name ?? 'the provider'}`);
	}

	/** A browser sign-in landed: fetch the providers it added, then finish. */
	async function signedIn(id: string): Promise<void> {
		finished.current = id;

		const providers = await settingsApi.providers().then(
			(answer) => answer.providers,
			() => null
		);

		connected(providers);
	}

	/** A sign-in failed or expired: back to the form with the reason. */
	function signInFailed(message: string): void {
		setDirection(-1);
		setAttempt(null);
		setError(message);
		setStatus('error');
	}

	/** Checks on a sign-in once. An answer that lands after the reader left the sign-in changes nothing. */
	const onPoll = useEffectEvent(async (id: string, live: () => boolean): Promise<'wait' | 'stop'> => {
		const state = await settingsApi.oauthStatus(id).catch((failure: unknown) => ({
			status: 'failed' as const,
			message: failureText(failure, 'Lost track of the sign-in.')
		}));

		if (!live()) return 'stop';
		if (state.status === 'pending') return 'wait';
		if (state.status === 'complete') await signedIn(id);
		else signInFailed(state.message);

		return 'stop';
	});

	useEffect(() => {
		if (!attempt) return;

		const id = attempt.attemptId;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let live = true;

		async function check(): Promise<void> {
			const next = await onPoll(id, () => live);

			if (live && next === 'wait') timer = setTimeout(check, POLL_MS);
		}

		if (attempt.mode === 'auto') timer = setTimeout(check, POLL_MS);

		return () => {
			live = false;
			clearTimeout(timer);

			if (finished.current !== id) void settingsApi.cancelOAuth(id).catch(() => undefined);
		};
	}, [attempt]);

	function choose(next: AgentProvider): void {
		setProvider(next);
		setFromList(true);
		setMethodIndex(String(methodsOf(next)[0].index));
		setAnswers(firstAnswers(next));
		setKeyText('');
		setCodeText('');
		setAttempt(null);
		setError(null);
		setStatus('idle');
		setDirection(1);
		setStep('connect');
	}

	function back(): void {
		if (sending) return;

		setError(null);
		setStatus('idle');
		setDirection(-1);

		if (attempt) return setAttempt(null);

		setStep('pick');
	}

	/** Sends the pasted code of a sign-in that hands one back. */
	async function sendCode(current: AgentOAuthAttempt): Promise<void> {
		setStatus('pending');
		setError(null);

		try {
			const state = await settingsApi.oauthCode(current.attemptId, code.trim());

			if (state.status === 'complete') return await signedIn(current.attemptId);

			setError(state.status === 'failed' ? state.message : 'Sign-in didn’t finish.');
		} catch (failure) {
			setError(failureText(failure, 'Sign-in failed.'));
		}

		setStatus('error');
	}

	/** Saves the key, or starts the browser sign-in and opens the provider's page in a new tab. */
	async function start(target: AgentProvider, chosen: AgentAuthMethod): Promise<void> {
		setStatus('pending');
		setError(null);

		try {
			if (chosen.type === 'api') {
				const { providers } = await settingsApi.setKey(target.id, key.trim(), answersFor(prompts, answers));

				return connected(providers);
			}

			const next = await settingsApi.startOAuth(target.id, chosen.index, answersFor(prompts, answers));

			window.open(next.url, '_blank', 'noopener');
			setDirection(1);
			setAttempt(next);
			setStatus(next.mode === 'auto' ? 'pending' : 'idle');
		} catch (failure) {
			setError(failureText(failure, 'Couldn’t connect.'));
			setStatus('error');
		}
	}

	const canSubmit = attempt
		? attempt.mode === 'code' && Boolean(code.trim())
		: method?.type === 'api'
			? Boolean(key.trim()) && !missing
			: !missing;

	function submit(): void {
		if (!provider || !method || status === 'pending' || status === 'success' || !canSubmit) return;

		void (attempt ? sendCode(attempt) : start(provider, method));
	}

	return {
		view: step === 'pick' ? 'pick' : attempt ? 'sign-in' : 'connect',
		direction,
		canGoBack: Boolean(attempt) || (step === 'connect' && fromList),
		query,
		provider,
		methods,
		method,
		answers,
		key,
		code,
		attempt,
		device: attempt ? deviceCode(attempt.instructions) : null,
		status,
		sending,
		error,
		title: step === 'connect' && provider ? `Connect ${provider.name}` : 'Add provider',
		submitLabel: submitLabelFor(method, attempt),
		canSubmit,
		setQuery,
		choose,
		back,
		setMethod: (index) => {
			setMethodIndex(index);
			edited();
		},
		answer: (field, value) => {
			setAnswers((now) => ({ ...now, [field]: value }));
			edited();
		},
		setKey: (value) => {
			setKeyText(value);
			edited();
		},
		setCode: (value) => {
			setCodeText(value);
			edited();
		},
		submit
	};
}
