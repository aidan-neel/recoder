import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HostConfig } from '$lib/reports/types';

/** Where the optional host list lives, outside any repo, since it names private machines. */
const CONFIG_PATH = join(homedir(), '.recoder', 'bench-hosts.json');

/** The checkout this app runs from; the local host starts benchmarks from it. */
const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..');

/** Every ssh call shares one connection per host, so polling stays cheap. */
const SSH_OPTIONS = [
	'-o',
	'BatchMode=yes',
	'-o',
	'ConnectTimeout=8',
	'-o',
	'ControlMaster=auto',
	'-o',
	`ControlPath=${join(homedir(), '.ssh', 'recoder-bench-%r@%h:%p')}`,
	'-o',
	'ControlPersist=10m'
];

function localHost(): HostConfig {
	return {
		id: 'local',
		label: 'This machine',
		ssh: null,
		repo: REPO,
		dataDir: process.env.RECODER_DATA_DIR ?? join(homedir(), '.recoder', 'data'),
		datasetsDir: join(homedir(), '.recoder', 'datasets'),
		base: 'http://localhost:3001',
		path: null
	};
}

/**
 * The machines the devtool reads and runs on: this one, plus each entry in
 * `~/.recoder/bench-hosts.json`. An entry with `"id": "local"` overrides this
 * machine's defaults.
 */
export function hosts(): HostConfig[] {
	const local = localHost();

	if (!existsSync(CONFIG_PATH)) return [local];

	const listed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Partial<HostConfig>[];
	const override = listed.find((entry) => entry.id === 'local');

	const remote = listed
		.filter((entry) => entry.id && entry.id !== 'local' && entry.ssh)
		.map((entry): HostConfig => ({
			id: entry.id!,
			label: entry.label ?? entry.id!,
			ssh: entry.ssh!,
			repo: entry.repo ?? '~/recoder',
			dataDir: entry.dataDir ?? '~/.recoder/data',
			datasetsDir: entry.datasetsDir ?? '~/.recoder/datasets',
			base: entry.base ?? 'http://localhost:3001',
			path: entry.path ?? null
		}));

	return [{ ...local, ...override, id: 'local', ssh: null }, ...remote];
}

export function host(id: string): HostConfig {
	const found = hosts().find((entry) => entry.id === id);

	if (!found) throw new Error(`Unknown host "${id}".`);

	return found;
}

/** Runs a POSIX shell script on the host and returns its stdout; a remote host runs it over ssh. */
export function shell(target: HostConfig, script: string, timeoutMs = 20_000): Promise<string> {
	const [command, args] = target.ssh ? ['ssh', [...SSH_OPTIONS, target.ssh, 'sh -s']] : ['sh', ['-s']];

	return new Promise((resolvePromise, reject) => {
		const child = execFile(
			command,
			args,
			{ timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) reject(new Error(`${target.label}: ${stderr.trim() || error.message}`));
				else resolvePromise(stdout);
			}
		);

		child.stdin?.end(script);
	});
}

export { SSH_OPTIONS };

/** Quotes a value for a POSIX shell, leaving a leading `~/` outside the quotes so the remote shell expands it. */
export function quote(value: string): string {
	if (value.startsWith('~/')) return `~/${quote(value.slice(2))}`;

	return `'${value.replaceAll("'", `'\\''`)}'`;
}
