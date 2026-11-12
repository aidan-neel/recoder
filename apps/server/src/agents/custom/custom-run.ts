import { NATIVE_TOOLS } from '../../evidence/native-tools';
import type { AgentPromptOptions, AgentReply, AgentRunOptions } from '../contract';
import { ProcessRun } from '../process-run';
import { runTurn, type CommandHost } from './custom-invoke';
import { PROTOCOL, PROTOCOL_VERSION, type TurnRequest } from './custom-protocol';

/** The tools a turn request lists: the permitted ones, as the MCP server describes them. */
function toolList(names: readonly string[]): TurnRequest['tools'] {
	return NATIVE_TOOLS.filter((tool) => names.includes(tool.name)).map(({ name, description, inputSchema }) => ({
		name,
		description,
		inputSchema
	}));
}

/**
 * A custom command as the agent: one process per prompt, each given the whole conversation so far and the
 * `session` its previous result returned. It reaches Recoder's tools over MCP at the URL in the request; the
 * review gate behind them decides what each call may do.
 */
export class CustomRun extends ProcessRun {
	private readonly transcript: TurnRequest['messages'] = [];
	private session: string | null = null;

	constructor(
		private readonly host: CommandHost,
		options: AgentRunOptions
	) {
		super(options);
	}

	async prompt(text: string, options: AgentPromptOptions): Promise<AgentReply> {
		const deadline = this.begin(options.timeoutMs);

		this.transcript.push({ role: 'user', content: text });

		try {
			const result = await runTurn(this.host, this.request(options), deadline.signal, this.options.onEvent);

			this.transcript.push({ role: 'assistant', content: result.text });
			this.session = result.session ?? this.session;

			return { text: result.text, structured: result.structured };
		} catch (error) {
			return { text: '', error: deadline.failure(error, `${this.host.command.name} failed.`) };
		}
	}

	private request(options: AgentPromptOptions): TurnRequest {
		const { lease } = this;

		return {
			protocol: PROTOCOL,
			version: PROTOCOL_VERSION,
			kind: 'turn',
			model: this.options.model,
			reasoningEffort: this.options.reasoningEffort ?? null,
			system: this.options.system,
			messages: [...this.transcript],
			session: this.session,
			tools: toolList(this.options.tools),
			mcp: lease ? { server: lease.name, url: lease.url } : null,
			schema: options.schema ?? null,
			timeoutMs: options.timeoutMs
		};
	}
}
