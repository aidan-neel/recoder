import type { TokenUsage } from '@recoder/shared';
import { LlmError } from '../../../models/llm/errors';
import type { SessionHandlers } from '../opencode-events';

/** How long a device-code or browser sign-in may take before it counts as expired. */
export const OAUTH_TIMEOUT_MS = 10 * 60_000;

/** How long registering Recoder's tools with OpenCode may take. */
export const MCP_TIMEOUT_MS = 10_000;

/** A session to create: everything OpenCode needs to know before the first prompt. */
export interface NewSession {
	directory: string;
	model: string;
	system: string;
	variant?: string;
	/** Tool name patterns the session may call besides OpenCode's own, which stay off. */
	allow: string[];
	signal: AbortSignal;
}

/** One prompt to a session made by {@link OpenCodeApi.createSession}. */
export interface Prompt {
	session: string;
	directory: string;
	text: string;
	model: string;
	system: string;
	variant?: string;
	/** The exact tool names the model may call on this prompt. */
	tools: string[];
	/** Asks OpenCode to force a JSON answer of this shape; only sent when the server can. */
	schema?: Record<string, unknown>;
	timeoutMs: number;
	signal: AbortSignal;
}

/** What a finished prompt produced, whichever server version answered. */
export interface Reply {
	/** The id of the model's last message, which a kept session rolls back to. */
	id?: string;
	/** The text parts of the final message, in order. */
	texts: string[];
	structured?: unknown;
	tokens?: TokenUsage;
	error?: LlmError;
}

/** A sign-in the user finishes in the browser. `finish` resolves once OpenCode holds the login. */
export interface OAuthStart {
	url: string;
	mode: 'auto' | 'code';
	instructions: string;
	finish(code?: string): Promise<boolean>;
}

/** Where a version keeps its event stream, and how it reads an event of one session. */
export interface SessionEvents {
	path(directory: string): string;
	router(handlers: SessionHandlers): (event: unknown, session: string | null) => void;
}

/**
 * The routes and shapes of one OpenCode major version. Everything else in
 * Recoder talks to this and never to a path: `opencode serve` 1.x answers at the
 * root, 2.x under `/api` with another model of sessions, prompts and sign-in.
 */
export interface OpenCodeApi {
	/** Whether a prompt can force a JSON-schema answer; when not, the model is asked for plain JSON. */
	readonly structuredOutput: boolean;
	readonly events: SessionEvents;

	/** Every provider OpenCode knows, as `{ all: [...] }`. */
	providers(): Promise<unknown>;
	/** The providers with a login and their models, as `{ providers: [...] }`. */
	connected(): Promise<unknown>;
	/** Each provider's sign-in methods, as a record by provider id. */
	authMethods(): Promise<unknown>;
	setKey(providerId: string, key: string, inputs: Record<string, string>): Promise<void>;
	removeLogin(providerId: string): Promise<void>;
	startOAuth(providerId: string, method: number, inputs: Record<string, string>): Promise<OAuthStart>;

	createSession(request: NewSession): Promise<string>;
	prompt(request: Prompt): Promise<Reply>;
	abort(directory: string, session: string): Promise<void>;
	deleteSession(directory: string, session: string): Promise<void>;
	/** Drops the messages after `lastMessageId`; throws when this version cannot. */
	rollBack(directory: string, session: string, lastMessageId: string | null, held: boolean): Promise<void>;
	addMcp(directory: string, name: string, url: string, signal: AbortSignal): Promise<void>;
}

/** `openrouter/qwen/qwen3` → provider `openrouter`, model `qwen/qwen3`. */
export function splitModel(model: string): { providerID: string; modelID: string } {
	const slash = model.indexOf('/');

	if (slash <= 0) throw new LlmError(400, `"${model}" is not an OpenCode model.`);

	return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}
