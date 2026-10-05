/** One diagnostic as a tool printed it, before its path is resolved against the repo. */
export interface RawDiagnostic {
	path: string;
	line: number;
	message: string;
	/** `TS2322`, `no-unused-vars`, `F401`… when the tool names one. */
	rule?: string;
	/** Type checkers' errors are `typecheck`; linters' findings and warnings are `lint`; `either` defers to the command. */
	source: 'typecheck' | 'lint' | 'either';
	raw: string;
}

const TSC_PAREN = /^(.+?)\((\d+),\d+\): (?:error|warning) (TS\d+): (.+)$/;
const TSC_PRETTY = /^(.+?):(\d+):\d+ - (?:error|warning) (TS\d+): (.+)$/;
const ESLINT_UNIX = /^(.+?):(\d+):\d+: (.+?) \[(?:Error|Warning)(?:\/(.+))?\]$/;
const ESLINT_STYLISH_FILE = /^(\S+\.[A-Za-z0-9]+)$/;
const ESLINT_STYLISH_ROW = /^\s+(\d+):\d+\s+(?:error|warning)\s+(.+?)(?:\s{2,}(\S+))?\s*$/;
const SVELTE_MACHINE = /^\d+ (ERROR|WARNING) "(.+?)" (\d+):\d+ "(.+)"$/;
const SVELTE_LOCATION = /^(\S+\.[A-Za-z0-9]+):(\d+):\d+$/;
const SVELTE_MESSAGE = /^(Error|Warn(?:ing)?): (.+?)(?: \(([\w-]+)\))?$/;
const MYPY = /^(.+?\.pyi?):(\d+): (error|warning): (.+?)(?:\s+\[([\w-]+)\])?$/;
const CARGO_HEAD = /^(error|warning)(?:\[(\w+)\])?: (.+)$/;
const CARGO_LOCATION = /^\s*--> (.+?):(\d+):\d+$/;
const GENERIC = /^(\S+\.[A-Za-z0-9]+):(\d+):\d+: (.+)$/;
const MIETTE_HEAD = /^\s*[×⚠x!]\s+(?:([\w@-]+)\(([^()]+)\): )?(.+)$/;
const MIETTE_FRAME = /^\s*(?:╭─|,-)\[(.+?):(\d+):\d+\]$/;
const RULE_CODE = /^([A-Z]{1,4}\d{2,4})\b\s*(?:\[\*\]\s*)?(.*)$/;

/** Removes terminal colour codes some tools print even when piped. */
function stripAnsi(text: string): string {
	// eslint-disable-next-line no-control-regex -- ANSI escapes start with the ESC control character
	return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

/** A one-line format (tsc, eslint unix, svelte-check machine, mypy, flake8, ruff, go vet). */
function oneLine(line: string): RawDiagnostic | null {
	const tsc = TSC_PAREN.exec(line) ?? TSC_PRETTY.exec(line);

	if (tsc) return { path: tsc[1], line: +tsc[2], rule: tsc[3], message: tsc[4], source: 'typecheck', raw: line };

	const unix = ESLINT_UNIX.exec(line);

	if (unix) return { path: unix[1], line: +unix[2], message: unix[3], rule: unix[4], source: 'lint', raw: line };

	const svelte = SVELTE_MACHINE.exec(line);

	if (svelte)
		return {
			path: svelte[2],
			line: +svelte[3],
			message: svelte[4],
			source: svelte[1] === 'ERROR' ? 'typecheck' : 'lint',
			raw: line
		};

	const mypy = MYPY.exec(line);

	if (mypy) return { path: mypy[1], line: +mypy[2], message: mypy[4], rule: mypy[5], source: 'typecheck', raw: line };

	const generic = GENERIC.exec(line);

	if (!generic) return null;

	const code = RULE_CODE.exec(generic[3]);

	return {
		path: generic[1],
		line: +generic[2],
		message: code ? code[2] || generic[3] : generic[3],
		rule: code?.[1],
		source: 'either',
		raw: line
	};
}

/** What a multi-line format has seen so far: eslint's file header, svelte-check's location, cargo's and oxlint's heading. */
interface ParseState {
	eslintFile: string | null;
	svelteLocation: { path: string; line: number; raw: string } | null;
	cargo: { message: string; rule?: string; source: RawDiagnostic['source']; raw: string } | null;
	miette: { message: string; rule?: string; raw: string } | null;
}

/** An oxlint plugin and rule as one rule id: `eslint(curly)` is `curly`, `import(x)` is `import/x`. */
function mietteRule(plugin: string | undefined, rule: string | undefined): string | undefined {
	if (!plugin || !rule) return undefined;
	if (plugin === 'eslint') return rule;

	return `${plugin === 'typescript-eslint' ? '@typescript-eslint' : plugin}/${rule}`;
}

/** The frame line of an oxlint (miette) diagnostic, which carries the location of the heading seen before it. */
function mietteFrame(line: string, state: ParseState): RawDiagnostic | null {
	const frame = state.miette ? MIETTE_FRAME.exec(line) : null;

	if (!frame || !state.miette) return null;

	const { message, rule, raw } = state.miette;

	state.miette = null;

	return { path: frame[1], line: +frame[2], message, rule, source: 'lint', raw: `${raw} ${line.trim()}` };
}

/** A line of a multi-line format; updates `state` and returns a diagnostic once one is complete. */
function multiLine(line: string, state: ParseState): RawDiagnostic | null {
	const row = state.eslintFile ? ESLINT_STYLISH_ROW.exec(line) : null;

	if (row && state.eslintFile)
		return {
			path: state.eslintFile,
			line: +row[1],
			message: row[2],
			rule: row[3],
			source: 'lint',
			raw: `${state.eslintFile} ${line.trim()}`
		};

	const svelte = state.svelteLocation ? SVELTE_MESSAGE.exec(line) : null;

	if (svelte && state.svelteLocation) {
		const { path, line: at, raw } = state.svelteLocation;

		state.svelteLocation = null;

		return {
			path,
			line: at,
			message: svelte[2],
			rule: svelte[3],
			source: svelte[1] === 'Error' ? 'typecheck' : 'lint',
			raw: `${raw} ${line}`
		};
	}

	const miette = mietteFrame(line, state);

	if (miette) return miette;

	const cargoAt = state.cargo ? CARGO_LOCATION.exec(line) : null;

	if (cargoAt && state.cargo) {
		const { message, rule, source, raw } = state.cargo;

		state.cargo = null;

		return { path: cargoAt[1], line: +cargoAt[2], message, rule, source, raw: `${raw} ${line.trim()}` };
	}

	remember(line, state);

	return null;
}

/** Notes a line that starts a multi-line diagnostic. */
function remember(line: string, state: ParseState): void {
	const location = SVELTE_LOCATION.exec(line);

	if (location) {
		state.svelteLocation = { path: location[1], line: +location[2], raw: line };

		return;
	}

	const miette = MIETTE_HEAD.exec(line);

	if (miette) {
		state.miette = { message: miette[3], rule: mietteRule(miette[1], miette[2]), raw: line.trim() };

		return;
	}

	const heading = CARGO_HEAD.exec(line);

	if (heading) {
		state.cargo = {
			message: heading[3],
			rule: heading[2],
			source: heading[1] === 'error' ? 'typecheck' : 'lint',
			raw: line
		};

		return;
	}

	if (ESLINT_STYLISH_FILE.test(line)) state.eslintFile = line;
	else if (!line.trim()) state.eslintFile = null;
}

/** Every diagnostic in one check's output, in the order printed. */
export function parseDiagnostics(output: string): RawDiagnostic[] {
	const state: ParseState = { eslintFile: null, svelteLocation: null, cargo: null, miette: null };
	const found: RawDiagnostic[] = [];

	for (const line of stripAnsi(output).replace(/\r/g, '').split('\n')) {
		const diagnostic = oneLine(line) ?? multiLine(line, state);

		if (diagnostic && diagnostic.line > 0) found.push(diagnostic);
	}

	return found;
}
