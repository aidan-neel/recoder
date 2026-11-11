import { EXIT } from '../../../src/cli/exit';
import { abortOnSignal } from '../../../src/cli/signals/abort-on-signal';

const KEEP_ALIVE_MS = 60_000;

const signal = abortOnSignal();

await import('../../../src/cli/run/run-review');

const keepAlive = setInterval(() => {}, KEEP_ALIVE_MS);
const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));

console.log('ready');
await aborted;
console.log('aborted');

if (Bun.argv[2] === 'hold') await new Promise(() => {});

clearInterval(keepAlive);
process.exitCode = EXIT.cancelled;
