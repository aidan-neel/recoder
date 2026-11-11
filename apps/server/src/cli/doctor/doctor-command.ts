import { EXIT, loadOrNotReady, type ExitCode } from '../exit.js';
import { printResult } from '../output/print-result.js';
import { writeStdout } from '../output/streams.js';
import { withSpinner } from '../terminal/spinner.js';
import type { Terminal } from '../terminal/terminal.js';
import { doctorView } from './doctor-view.js';

const JSON_INDENT = 2;

/**
 * `recoder doctor`: checks this machine and prints what it found, as a checklist for a person or an indented JSON
 * report for a program. The checks load the agents and the settings, so a module that cannot load is itself a
 * machine that is not ready.
 */
export async function runDoctorCommand(terminal: Terminal): Promise<ExitCode> {
	const { runDoctor } = await loadOrNotReady(() => import('./doctor.js'));
	const report = await withSpinner('Checking this machine', terminal, runDoctor);

	if (terminal.audience === 'program') await writeStdout(`${JSON.stringify(report, null, JSON_INDENT)}\n`);
	else await printResult(terminal, report, doctorView);

	return report.ok ? EXIT.ok : EXIT.notReady;
}
