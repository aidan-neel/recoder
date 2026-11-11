import { EXIT } from '../../../src/cli/exit';
import { LIFETIME_MS, isFakeReviewMode, runFakeBackgroundReview } from './fake-review';

const CRASH_EXIT = 7;

/**
 * The first argument may name a mode; the MCP tests pass only the background flags. `crash`: exits before taking the
 * run over. `hold`: never takes it over, as a slow start looks to the launcher. The rest are `FakeReviewMode`s.
 */
const [first, ...rest] = Bun.argv.slice(2);

setTimeout(() => process.exit(EXIT.failed), LIFETIME_MS).unref();

if (first === 'crash') process.exit(CRASH_EXIT);

if (first === 'hold') setInterval(() => {}, LIFETIME_MS);
else if (isFakeReviewMode(first)) process.exitCode = await runFakeBackgroundReview(rest, first);
else process.exitCode = await runFakeBackgroundReview(Bun.argv.slice(2), 'until-cancelled');
