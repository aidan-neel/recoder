import { realpath } from 'node:fs/promises';
import { VERSION } from '../../version.js';
import { CliError, EXIT, describeError, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import { isCompiledBinary } from '../self-command.js';
import { abortOnSignal } from '../signals/abort-on-signal.js';
import { withSpinner } from '../terminal/spinner.js';
import type { Terminal } from '../terminal/terminal.js';
import { githubReleases } from './release-source.js';
import { versionOfTag } from './release-tag.js';
import { installRelease, planUpgrade, resultOfPlan, type RunningProgram, type UpgradeRequest } from './upgrade.js';
import { upgradeView } from './upgrade-view.js';

/** How long a new binary may take to print its version before it counts as broken. */
const CHECK_TIMEOUT_MS = 15_000;

/**
 * `recoder upgrade`: replaces this binary with the latest release, or with the one `--to` names. `--check` only
 * reports. A signal stops a download and leaves the program as it was.
 */
export async function runUpgradeCommand(request: UpgradeRequest, terminal: Terminal): Promise<ExitCode> {
	const program = await thisProgram(abortOnSignal());
	const plan = await withSpinner('Looking for the latest release', terminal, () => planUpgrade(request, program));
	const isInstalling = plan.isNeeded && !request.checkOnly;
	const label = `Downloading recoder ${versionOfTag(plan.tag)}`;
	const installedAt = isInstalling ? await withSpinner(label, terminal, () => installRelease(plan.tag, program)) : null;

	await printResult(terminal, resultOfPlan(plan, program, installedAt), upgradeView);

	return EXIT.ok;
}

/** This process as the upgrade sees it. The executable is resolved through any link, so the real file is replaced. */
async function thisProgram(signal: AbortSignal): Promise<RunningProgram> {
	return {
		version: VERSION,
		executable: isCompiledBinary() ? await realpath(process.execPath) : null,
		platform: process.platform,
		arch: process.arch,
		releases: githubReleases(fetch),
		check: runsAsVersion,
		signal
	};
}

/** Runs the new binary's `--version`; one that does not start, or prints another version, is not installed. */
async function runsAsVersion(candidate: string, version: string): Promise<void> {
	const printed = await printedVersion(candidate).catch((error: unknown) => {
		throw new CliError(`the new binary does not run: ${describeError(error)}. Nothing was installed.`, EXIT.failed);
	});

	if (printed !== version) {
		throw new CliError(`the new binary says it is "${printed}", not ${version}. Nothing was installed.`, EXIT.failed);
	}
}

async function printedVersion(binary: string): Promise<string> {
	const child = Bun.spawn([binary, '--version'], {
		stdio: ['ignore', 'pipe', 'ignore'],
		timeout: CHECK_TIMEOUT_MS
	});

	const [output] = await Promise.all([new Response(child.stdout).text(), child.exited]);

	return output.trim();
}
