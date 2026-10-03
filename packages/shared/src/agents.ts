/** A coding-agent CLI Recoder knows about, installed or not. */
export interface AgentStatus {
	id: string;
	name: string;
	installed: boolean;
	version: string | null;
	/** Where the binary was found. */
	path: string | null;
	/** Why the agent can't be used (failed to start, too old…); null when it's fine. */
	error: string | null;
	/** The shell command that installs it, shown while it's missing. */
	install: string;
	/** Signed in to its vendor account; null for agents that sign in per provider, like OpenCode. */
	signedIn: boolean | null;
	/** The CLI's own sign-in command, for agents tied to one vendor account. */
	login: string | null;
	/** Connects model providers itself, so Settings shows its Providers section. */
	providers: boolean;
}

/** One way to sign in to a provider, as the agent describes it. */
export interface AgentAuthMethod {
	/** Index the agent expects back. */
	index: number;
	type: 'oauth' | 'api';
	label: string;
	prompts: AgentAuthPrompt[];
}

/** A field the agent asks for before signing in (account ID, instance URL…). */
export type AgentAuthPrompt =
	| { type: 'text'; key: string; message: string; placeholder: string | null; when: AgentPromptCondition | null }
	| {
			type: 'select';
			key: string;
			message: string;
			options: { label: string; value: string; hint: string | null }[];
			when: AgentPromptCondition | null;
	  };

export interface AgentPromptCondition {
	key: string;
	op: 'eq' | 'neq';
	value: string;
}

/** A model provider the agent knows about. Keys never leave the server. */
export interface AgentProvider {
	id: string;
	name: string;
	modelCount: number;
	connected: boolean;
	/**
	 * How the agent reaches it: a saved key, an OAuth sign-in, the agent's
	 * config file, an environment variable, or built in (OpenCode Zen's free models).
	 */
	via: 'key' | 'oauth' | 'config' | 'env' | 'builtin' | null;
	/** Only saved keys and sign-ins can be removed from Recoder. */
	removable: boolean;
	methods: AgentAuthMethod[];
}

/** A sign-in in progress. `auto` finishes in the browser; `code` needs the code pasted back. */
export interface AgentOAuthAttempt {
	attemptId: string;
	url: string;
	mode: 'auto' | 'code';
	instructions: string;
}

export type AgentOAuthStatus = { status: 'pending' } | { status: 'complete' } | { status: 'failed'; message: string };
