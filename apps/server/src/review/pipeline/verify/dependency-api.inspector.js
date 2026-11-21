import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

const input = JSON.parse(process.argv.at(-1));
const started = Date.now();
const checkout = await realpath(process.cwd());
const limits = { fileBytes: 131072, totalReadBytes: 2097152, outputBytes: 16000, packages: 3, files: 6 };
const result = { matches: [], unavailable: [], limits };
let bytesRead = 0;
let excerptBytes = 9000;

function inside(path, root) {
	return path === root || path.startsWith(root + sep);
}

function safe(path) {
	return (
		typeof path === 'string' &&
		path.length <= 512 &&
		!path.includes('\\') &&
		!path.includes('\0') &&
		!path.startsWith('/') &&
		path.split('/').every((part) => part && part !== '.' && part !== '..')
	);
}

function cut(text, bytes) {
	return Buffer.from(text)
		.subarray(0, Math.max(0, bytes))
		.toString('utf8')
		.replace(/\uFFFD$/, '');
}

/** No project code runs: only bounded regular files beneath the permitted install root are opened. */
async function read(root, path, cap = limits.fileBytes) {
	if (!safe(path) || bytesRead >= limits.totalReadBytes) return null;

	let file;

	try {
		const physical = await realpath(resolve(root, path));

		if (!inside(physical, root)) return null;
		file = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

		const info = await file.stat();

		if (!info.isFile()) return null;

		const buffer = Buffer.alloc(Math.min(cap, limits.totalReadBytes - bytesRead));
		const read = await file.read(buffer, 0, buffer.length, 0);

		bytesRead += read.bytesRead;

		const content = buffer.subarray(0, read.bytesRead);

		return {
			text: content.toString('utf8'),
			truncated: info.size > content.length,
			sha256OfReadBytes: createHash('sha256').update(content).digest('hex')
		};
	} catch {
		return null;
	} finally {
		await file?.close();
	}
}

async function names(root, path = '') {
	let dir;

	try {
		const physical = await realpath(resolve(root, path));

		if (!inside(physical, root)) return [];
		dir = await opendir(physical);

		const entries = [];

		for await (const entry of dir) {
			entries.push(entry.name);
			if (entries.length >= 128) break;
		}

		return entries.sort();
	} catch {
		return [];
	}
}

async function metadata(root, path) {
	const record = await read(root, path, 65536);

	if (!record || record.truncated) return null;

	try {
		return JSON.parse(record.text);
	} catch {
		return null;
	}
}

const keywords = [
	...new Set([
		...[...String(input.claim).matchAll(/([A-Za-z_$][\w$]{2,})\s*\(/g)].map((match) => match[1]),
		...[...String(input.claim).matchAll(/`([\w$.-]+)`/g)].flatMap((match) => match[1].split('.'))
	])
]
	.filter((word) => /^[A-Za-z_$][\w$]{2,63}$/.test(word))
	.slice(0, 16);

function excerpt(text) {
	const lines = text.split('\n');
	const selected = new Set();

	for (const term of keywords) {
		let hits = 0;

		for (let i = 0; i < lines.length && hits < 2; i++) {
			if (!lines[i].includes(term)) continue;
			for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 3); j++) selected.add(j);
			hits++;
		}
	}

	if (!selected.size) for (let i = 0; i < Math.min(18, lines.length); i++) selected.add(i);

	const textWithLines = [...selected]
		.sort((a, b) => a - b)
		.map((i) => `${i + 1}|${lines[i]}`)
		.join('\n');

	const content = cut(textWithLines, Math.min(3000, excerptBytes));

	excerptBytes -= Buffer.byteLength(content);

	return { content, excerpted: content !== textWithLines || selected.size !== lines.length };
}

async function collect(root, entries, ecosystem) {
	const files = [];
	const pending = [...entries];
	const seen = new Set();

	while (pending.length && seen.size < 48 && files.length < limits.files && excerptBytes > 0) {
		const path = pending.shift();

		if (!safe(path) || seen.has(path) || !/\.(?:[cm]?js|[cm]?ts|pyi?|go)$/.test(path)) continue;
		seen.add(path);

		const record = await read(root, path);

		if (!record) continue;

		files.push({
			path,
			sha256OfReadBytes: record.sha256OfReadBytes,
			truncated: record.truncated,
			...excerpt(record.text)
		});

		if (ecosystem === 'python') {
			for (const match of record.text.matchAll(/^\s*from\s+\.([\w.]*)\s+import\s+([\w ,]+)/gm)) {
				const modules = match[1]
					? [match[1].replace(/\./g, '/')]
					: match[2].split(',').map((name) => name.trim().split(/\s/)[0]);

				for (const module of modules.slice(0, 6))
					for (const extension of ['.pyi', '.py', '/__init__.py'])
						pending.push(join(dirname(path), module + extension));
			}

			continue;
		}

		if (ecosystem !== 'node') continue;

		const links = [...record.text.matchAll(/(?:from\s*|require\s*\(\s*)['"]([.][^'"]+)['"]/g)]
			.map((match) => relative(root, resolve(root, dirname(path), match[1])))
			.filter(safe)
			.sort((a, b) => Number(keywords.some((k) => b.includes(k))) - Number(keywords.some((k) => a.includes(k))));

		for (const link of links.slice(0, 6)) {
			const stem = link.replace(/\.[cm]?js$/, '');

			for (const option of [stem + '.d.ts', stem + '.ts', link, stem + '/index.d.ts', stem + '.js']) {
				if (await read(root, option, 1)) {
					pending.push(option);
					break;
				}
			}
		}
	}

	return files;
}

const source = safe(input.file) ? await read(checkout, input.file) : null;
const text = source?.text ?? '';
const requests = [];
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '').split('/')[0]));
const nodeSource = /\.(?:[cm]?[jt]sx?|mdx?)$/.test(input.file) ? text : '';
const pythonSource = /\.(?:pyi?|mdx?)$/.test(input.file) ? text : '';
const goSource = /\.(?:go|mdx?)$/.test(input.file) ? text : '';

for (const match of nodeSource.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) {
	const name = match[1];

	if (
		!name.startsWith('node:') &&
		!builtins.has(name.split('/')[0]) &&
		/^(@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/.test(name)
	)
		requests.push({ ecosystem: 'node', name });
}

for (const match of pythonSource.matchAll(/^\s*(?:from|import)\s+([A-Za-z_]\w*)(?:[.\w]*)/gm))
	requests.push({ ecosystem: 'python', name: match[1] });

for (const match of goSource.matchAll(/\bimport\s*(?:\(([\s\S]*?)\)|(?:[\w.]+\s+)?"([^"]+)")/g)) {
	const imports = match[2] ? [match[2]] : [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);

	for (const name of imports) requests.push({ ecosystem: 'go', name });
}

function target(value) {
	if (typeof value === 'string') return value;
	if (!value || typeof value !== 'object') return null;

	return target(value.types) ?? target(value.import) ?? target(value.default) ?? target(value.require);
}

async function node(request) {
	const name = request.name.match(/^(@[\w.-]+\/[^/]+|[^/]+)/)?.[0];
	const subpath = request.name.slice(name.length);
	let directory = dirname(resolve(checkout, input.file));

	for (let depth = 0; depth < 10 && inside(directory, checkout); depth++, directory = dirname(directory)) {
		const project = await metadata(checkout, relative(checkout, join(directory, 'package.json')));

		if (project?.name === name)
			return { unavailable: 'The import is this project, not an installed external dependency.' };

		const path = relative(checkout, join(directory, 'node_modules', name));
		let root;

		try {
			const install = await realpath(join(directory, 'node_modules'));

			root = await realpath(resolve(checkout, path));
			if (!inside(install, checkout) || !inside(root, install))
				return { unavailable: 'Package symlink escapes the installed dependency tree.' };
		} catch {
			continue;
		}

		const pkg = await metadata(checkout, path + '/package.json');

		if (!pkg) continue;
		if (pkg.name !== name || typeof pkg.version !== 'string' || !/^[\w.+-]{1,96}$/.test(pkg.version))
			return { unavailable: 'Installed package metadata has no matching name and exact version.' };

		const lock = await metadata(checkout, relative(checkout, join(directory, 'package-lock.json')));
		const pin = lock?.packages?.['node_modules/' + name]?.version;

		if (pin !== undefined && (typeof pin !== 'string' || !/^[\w.+-]{1,96}$/.test(pin)))
			return { unavailable: 'Invalid exact lock version.' };
		if (pin && pin !== pkg.version)
			return {
				unavailable: 'Installed version disagrees with package-lock.json.',
				installedVersion: pkg.version,
				pinnedVersion: pin
			};

		const exports = pkg.exports?.['.' + subpath] ?? (!subpath ? pkg.exports : null);

		const entry =
			target(exports) ??
			(!subpath ? (pkg.types ?? pkg.typings ?? pkg.main ?? 'index.d.ts') : subpath.slice(1) + '.d.ts');

		return {
			version: pkg.version,
			resolution: 'installed package.json',
			...(pin ? { pinnedVersion: pin } : {}),
			files: await collect(root, [String(entry).replace(/^\.\//, '')], 'node')
		};
	}

	return { unavailable: 'Dependency is not installed in this checkout; no global cache or network fallback was used.' };
}

function canonical(name) {
	return name.toLowerCase().replace(/[-_.]+/g, '-');
}

async function python(request) {
	const roots = ['.venv/lib', '.venv/lib64', 'venv/lib', 'venv/lib64'];

	for (const lib of roots)
		for (const version of await names(checkout, lib)) {
			if (!/^python\d+\.\d+$/.test(version)) continue;

			const site = `${lib}/${version}/site-packages`;

			const distributions = (await names(checkout, site)).filter((name) => name.endsWith('.dist-info'));

			for (const dist of distributions) {
				const meta = await read(checkout, `${site}/${dist}/METADATA`, 16384);
				const name = meta?.text.match(/^Name:\s*(.+)$/m)?.[1].trim();
				const version = meta?.text.match(/^Version:\s*([\w.+-]{1,96})\s*$/m)?.[1];
				const top = await read(checkout, `${site}/${dist}/top_level.txt`, 4096);

				if (
					!name ||
					!version ||
					!(canonical(name) === canonical(request.name) || top?.text.split(/\s+/).includes(request.name))
				)
					continue;
				if (
					distributions.filter((entry) => canonical(entry.replace(/-[^-]+\.dist-info$/, '')) === canonical(name))
						.length !== 1
				)
					return { unavailable: 'Ambiguous installed distribution versions.' };

				const requirements = await read(checkout, 'requirements.txt', 65536);

				const pin = requirements?.text
					.split('\n')
					.map((line) => line.match(/^([\w.-]+)==([\w.+-]{1,96})(?:[;\s]|$)/))
					.find((match) => match && canonical(match[1]) === canonical(name))?.[2];

				if (pin && pin !== version)
					return {
						unavailable: 'Installed distribution disagrees with requirements.txt.',
						installedVersion: version,
						pinnedVersion: pin
					};

				const install = await realpath(resolve(checkout, site));
				let root = install;
				let candidates = [request.name + '.pyi', request.name + '.py'];

				try {
					root = await realpath(resolve(install, request.name));
					if (!inside(root, install)) return { unavailable: 'Python package escapes the installed dependency tree.' };
					candidates = ['__init__.pyi', '__init__.py'];
				} catch {}

				return {
					version,
					distribution: name,
					resolution: 'installed dist-info/METADATA',
					...(pin ? { pinnedVersion: pin } : {}),
					files: await collect(root, candidates, 'python')
				};
			}
		}

	return { unavailable: 'No versioned distribution/source found in the checkout virtualenv.' };
}

async function go(request) {
	const mod = await read(checkout, 'go.mod', 65536);

	const entries = [...(mod?.text ?? '').matchAll(/^\s*(?:require\s+)?([\w./!+-]+)\s+(v[\w.+-]+)\s*(?:\/\/.*)?$/gm)]
		.filter((match) => request.name === match[1] || request.name.startsWith(match[1] + '/'))
		.sort((a, b) => b[1].length - a[1].length);

	const selected = entries[0];

	if (!selected) return { unavailable: 'Import has no exact required module version in go.mod.' };

	let [, name, version] = selected;

	const replacement = [
		...mod.text.matchAll(/^\s*(?:replace\s+)?([^\s]+)(?:\s+(v[^\s]+))?\s*=>\s*(\S+)(?:\s+(v[^\s]+))?/gm)
	].find((match) => match[1] === name && (!match[2] || match[2] === version));

	if (replacement) {
		if (!replacement[4])
			return { unavailable: 'Local/unversioned Go replacement is not versioned module-cache evidence.' };
		name = replacement[3];
		version = replacement[4];
	}

	if (!safe(name) || !/^v[\w.+-]+$/.test(version) || !process.env.GOMODCACHE)
		return { unavailable: 'No safe module cache/version.' };

	try {
		if ((await lstat(process.env.GOMODCACHE)).isSymbolicLink())
			return { unavailable: 'Module-cache root is a symlink.' };

		const cache = await realpath(process.env.GOMODCACHE);

		const path =
			name.replace(/[A-Z]/g, (char) => '!' + char.toLowerCase()) +
			'@' +
			version.replace(/[A-Z]/g, (char) => '!' + char.toLowerCase());

		const root = await realpath(resolve(cache, path));

		if (root !== resolve(cache, path)) return { unavailable: 'Pinned module cache entry is redirected by a symlink.' };

		const metadata = await read(cache, path + '/go.mod', 65536);

		if (!metadata?.text.match(/^module\s+(\S+)/m)?.[1] || metadata.text.match(/^module\s+(\S+)/m)[1] !== name)
			return { unavailable: 'Pinned module is not installed with matching module metadata.' };

		const subpath = request.name.slice(selected[1].length).replace(/^\//, '');
		const entries = (await names(root, subpath)).filter((file) => file.endsWith('.go') && !file.endsWith('_test.go'));

		return {
			version,
			module: name,
			resolution: 'go.mod exact require/replace and installed module cache',
			files: await collect(
				root,
				entries.map((file) => (subpath ? subpath + '/' + file : file)),
				'go'
			)
		};
	} catch {
		return { unavailable: 'Pinned Go module cache entry is unavailable.' };
	}
}

const seen = new Set();

const prioritized = requests.sort(
	(a, b) => Number(String(input.claim).includes(b.name)) - Number(String(input.claim).includes(a.name))
);

for (const request of prioritized) {
	if (seen.size >= limits.packages) break;
	if (request.name.length > 200 || !safe(request.name)) continue;
	if (seen.has(request.ecosystem + ':' + request.name)) continue;
	seen.add(request.ecosystem + ':' + request.name);

	try {
		const lookup = await { node, python, go }[request.ecosystem](request);

		if (lookup.files?.length) result.matches.push({ ...request, ...lookup });
		else
			result.unavailable.push({
				...request,
				...lookup,
				unavailable:
					lookup.unavailable ?? 'No readable bounded declarations/source; absence does not establish a missing API.'
			});
	} catch {
		result.unavailable.push({ ...request, unavailable: 'Installed dependency lookup failed safely.' });
	}
}

result.lookupMs = Date.now() - started;
result.bytesRead = bytesRead;

let serialized = JSON.stringify(result);

while (Buffer.byteLength(serialized) > limits.outputBytes && result.matches.length) {
	const files = result.matches.at(-1).files;
	const last = files.at(-1);

	if (Buffer.byteLength(last.content) > 256) {
		last.content = cut(last.content, Math.floor(Buffer.byteLength(last.content) / 2));
		last.excerpted = true;
	} else files.pop();
	if (!files.length) result.matches.pop();
	result.truncated = true;
	serialized = JSON.stringify(result);
}

console.log(serialized);
