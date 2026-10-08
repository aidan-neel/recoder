import type { BenchmarkProcess, HostConfig, ServerProcess } from '$lib/reports/types';
import { shell } from './hosts';

/**
 * Lists benchmark and server processes with their working directory, stdout
 * and listening ports. Runs under plain `sh` on Linux and macOS: /proc where
 * it exists, lsof otherwise. It only reads; it never signals a process.
 */
const PROBE = String.raw`
cwd_of() { if [ -e /proc/$1/cwd ]; then readlink /proc/$1/cwd; else lsof -a -p $1 -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; fi; }
out_of() { if [ -e /proc/$1/fd/1 ]; then readlink /proc/$1/fd/1; else lsof -a -p $1 -d 1 -Fn 2>/dev/null | sed -n 's/^n//p'; fi; }
ports_of() {
	if command -v ss >/dev/null 2>&1; then ss -ltnpH 2>/dev/null | grep "pid=$1," | awk '{print $4}' | sed 's/.*://';
	else lsof -nP -a -p $1 -iTCP -sTCP:LISTEN -Fn 2>/dev/null | sed -n 's/^n.*://p'; fi
}
for pid in $(pgrep -f 'src/eval/benchmark.ts'); do
	printf 'B\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$(ps -o etime= -p $pid | tr -d ' ')" "$(cwd_of $pid)" "$(out_of $pid)" "$(ps -o args= -p $pid)"
done
for pid in $(pgrep -f 'src/index.ts'); do
	for port in $(ports_of $pid); do printf 'S\t%s\t%s\t%s\n' "$pid" "$port" "$(cwd_of $pid)"; done
done
`;

/** `[[dd-]hh:]mm:ss` as seconds. */
function elapsedSeconds(etime: string): number {
	const [days, clock] = etime.includes('-') ? etime.split('-') : ['0', etime];
	const parts = clock!.split(':').map(Number);

	while (parts.length < 3) parts.unshift(0);

	return Number(days) * 86_400 + parts[0]! * 3_600 + parts[1]! * 60 + parts[2]!;
}

/** True for `bun src/eval/benchmark.ts …`, not a shell or launcher that only mentions it. */
function isBenchmark(args: string[]): boolean {
	return /(^|\/)bun$/.test(args[0] ?? '') && args.some((arg) => arg.endsWith('src/eval/benchmark.ts'));
}

export interface Probe {
	benchmarks: BenchmarkProcess[];
	servers: ServerProcess[];
}

/** The host's running benchmarks and Recoder servers. */
export async function probe(target: HostConfig): Promise<Probe> {
	const now = Date.now();
	const lines = (await shell(target, PROBE)).split('\n').filter(Boolean);
	const benchmarks: BenchmarkProcess[] = [];
	const servers = new Map<string, ServerProcess>();

	for (const line of lines) {
		const [kind, pid, ...rest] = line.split('\t');

		if (kind === 'B') {
			const [etime, cwd, log, command] = rest;
			const args = (command ?? '').trim().split(/\s+/);

			if (!isBenchmark(args)) continue;

			benchmarks.push({
				pid: Number(pid),
				startedAt: new Date(now - elapsedSeconds(etime ?? '0') * 1000).toISOString(),
				cwd: cwd ?? '',
				args,
				log: log && log.startsWith('/') && !log.startsWith('/dev/') ? log : null
			});
		} else if (kind === 'S') {
			const [port, cwd] = rest;

			if (!cwd?.endsWith('/apps/server') || !Number(port)) continue;

			servers.set(`${pid}:${port}`, { pid: Number(pid), port: Number(port), cwd });
		}
	}

	return { benchmarks, servers: [...servers.values()].sort((a, b) => a.port - b.port) };
}

/** A benchmark process's flag value, as `--name value`. */
export function flag(args: string[], name: string): string | undefined {
	const at = args.indexOf(`--${name}`);

	return at >= 0 ? args[at + 1] : undefined;
}
