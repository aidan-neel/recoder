import { parseReviewArgs } from '../../../src/cli/args/review-args';
import { EXIT, type ExitCode } from '../../../src/cli/exit';
import { runProgram } from '../../../src/cli/program';
import { runReviewCommand } from '../../../src/cli/runs/review-command';
import { LIFETIME_MS, exitCodeOf, runFakeBackgroundReview } from './fake-review';

/**
 * `recoder review` as the command line runs it, so `--detach` is the real launcher. The launcher starts this same
 * file as its background process, and that side runs a gated fake review instead of the pipeline.
 */
setTimeout(() => process.exit(EXIT.failed), LIFETIME_MS).unref();

await runProgram(Bun.argv.slice(2), runRecoderReview);

async function runRecoderReview(argv: string[]): Promise<ExitCode> {
	const flags = argv.slice(1);
	const request = parseReviewArgs(flags, process.cwd());

	if (request.launch.kind === 'background') return runFakeBackgroundReview(flags, 'gate');

	return runReviewCommand(request).catch(exitCodeOf);
}
