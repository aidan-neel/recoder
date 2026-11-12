import { AsyncLocalStorage } from 'node:async_hooks';
import type { ReviewCommand } from './commands';

type ChatCommand = Extract<ReviewCommand, { kind: 'chat' }>;

const command = new AsyncLocalStorage<ChatCommand>();

export function withChatCommand<T>(input: ChatCommand, work: () => T): T {
	return command.run(input, work);
}

export function currentChatCommand(): ChatCommand | undefined {
	return command.getStore();
}
