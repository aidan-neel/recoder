import { z } from 'zod';
import type { CodexConnection, CodexModel } from '@recoder/shared';
import { ChatGptAuth } from './chatgpt-auth';
import { chatGptRequest, readChatGptResponse } from './chatgpt-responses';
import { LlmError, type ChatOptions } from './llm';

const windowSchema = z.object({ used_percent: z.number().finite(), limit_window_seconds: z.number().finite().optional(), reset_at: z.number().finite().optional() });
const rateSchema = z.object({ primary_window: windowSchema.nullish(), secondary_window: windowSchema.nullish() });
const usageSchema = z.object({
	plan_type: z.string().optional(), rate_limit: rateSchema.nullish(),
	additional_rate_limits: z.array(z.object({ limit_name: z.string(), rate_limit: rateSchema.nullish() })).nullish()
});

/** Direct ChatGPT OAuth provider. `codex` remains the persisted provider ID. */
export class ChatGptProvider {
	private active = 0;
	constructor(private readonly auth = new ChatGptAuth()) {}

	async status(): Promise<CodexConnection> {
		try {
			const status = await this.auth.status();
			if (!status.authenticated) return status;
			try {
				const response = await this.auth.authorizedFetch('/wham/usage');
				await this.checkResponse(response, 'usage limits');
				const parsed = usageSchema.safeParse(await response.json());
				if (!parsed.success) throw new LlmError(502, 'ChatGPT returned invalid usage limits.');
				const usage = parsed.data;
				const snapshots = [{ limit_name: 'Codex', rate_limit: usage.rate_limit }, ...(usage.additional_rate_limits ?? [])];
				const limits = snapshots.flatMap((snapshot) => (['primary_window', 'secondary_window'] as const).flatMap((key) => {
					const window = snapshot.rate_limit?.[key];
					if (!window) return [];
					const minutes = window.limit_window_seconds && window.limit_window_seconds > 0 ? Math.ceil(window.limit_window_seconds / 60) : null;
					return [{ name: `${snapshot.limit_name} · ${minutes ? `${minutes} min` : key === 'primary_window' ? 'Primary' : 'Secondary'}`, usedPercent: window.used_percent, resetsAt: window.reset_at ?? null }];
				}));
				const current = await this.auth.status();
				return current.authenticated ? { ...current, planType: usage.plan_type ?? current.planType, limits } : current;
			} catch (error) {
				const current = await this.auth.status();
				return { ...current, error: error instanceof LlmError ? error.message : 'Could not load ChatGPT usage limits. Try refreshing.' };
			}
		} catch (error) {
			return { available: true, authenticated: false, error: error instanceof LlmError ? error.message : 'Could not load the ChatGPT connection. Try again.' };
		}
	}

	async connect(): Promise<CodexConnection> {
		if (this.active) throw new LlmError(409, 'Wait for active ChatGPT requests to finish before signing in.');
		return this.auth.connect();
	}

	async disconnect(): Promise<void> {
		if (this.active) throw new LlmError(409, 'Wait for active ChatGPT requests to finish before disconnecting.');
		this.auth.disconnect();
	}

	async models(): Promise<CodexModel[]> {
		// Version describes the catalog wire contract, not a local CLI requirement.
		const response = await this.auth.authorizedFetch('/codex/models?client_version=0.153.4');
		await this.checkResponse(response, 'models');
		const raw = await response.json().catch(() => { throw new LlmError(502, 'ChatGPT returned an invalid model catalog. Try again.'); });
		const parsed = z.object({ models: z.array(z.object({ slug: z.string().min(1), display_name: z.string().optional(), visibility: z.string().optional(), supported_reasoning_efforts: z.array(z.string()).optional(), reasoning_efforts: z.array(z.string()).optional(), efforts: z.array(z.string()).optional() })) }).safeParse(raw);
		if (!parsed.success) throw new LlmError(502, 'ChatGPT returned an invalid model catalog. Try again.');
		const effortOrder = ['minimal', 'low', 'medium', 'high'] as const;
		return parsed.data.models
			.filter((model) => !model.visibility || model.visibility === 'list')
			.map((model) => {
				const raw = model.supported_reasoning_efforts ?? model.reasoning_efforts ?? model.efforts;
				const efforts = raw ? effortOrder.filter((effort) => raw.includes(effort)) : [];
				return {
					id: model.slug,
					label: model.display_name || model.slug,
					...(efforts.length ? { efforts: [...efforts] } : {})
				};
			});
	}

	private async checkResponse(response: Response, operation: string): Promise<void> {
		if (response.ok) return;
		await response.body?.cancel();
		if (response.status === 429) throw new LlmError(429, 'ChatGPT usage limit reached. Check Usage in Connections for reset times.');
		if (response.status === 403) throw new LlmError(403, 'ChatGPT denied access. Check model access and workspace permissions.');
		throw new LlmError(response.status, `Could not load ChatGPT ${operation} (HTTP ${response.status}). ${response.status === 400 ? 'Check the selected model and reasoning effort.' : 'Try again.'}`);
	}

	async complete(opts: ChatOptions, onToken?: (text: string) => void): Promise<string> {
		this.active++;
		const signal = AbortSignal.any([AbortSignal.timeout(opts.timeoutMs ?? 90_000), ...(opts.signal ? [opts.signal] : [])]);
		try {
			signal.throwIfAborted();
			const response = await this.auth.authorizedFetch('/codex/responses', {
				method: 'POST', signal,
				headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
				body: JSON.stringify(chatGptRequest(opts))
			});
			await this.checkResponse(response, 'response');
			return await readChatGptResponse(response, opts, signal, onToken);
		} catch (error) {
			if (signal.aborted) throw new LlmError(0, opts.signal?.aborted ? 'ChatGPT request cancelled.' : 'ChatGPT request timed out. Try a smaller review scope or lower effort.');
			if (error instanceof LlmError) throw error;
			throw new LlmError(0, 'ChatGPT response failed. Check the connection and retry.');
		} finally { this.active--; }
	}

	stop(): void { this.auth.stop(); }
}

export const codex = new ChatGptProvider();
process.once('exit', () => codex.stop());
