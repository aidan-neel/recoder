import {
	FileAudioIcon,
	FileCsvIcon,
	FileIcon as PageIcon,
	FileImageIcon,
	FileIniIcon,
	FileLockIcon,
	FilePdfIcon,
	FileSqlIcon,
	FileTxtIcon,
	FileVideoIcon,
	FileZipIcon,
	type Icon
} from '@phosphor-icons/react';
import {
	siC,
	siCplusplus,
	siCss,
	siDart,
	siDocker,
	siDotenv,
	siDotnet,
	siElixir,
	siGit,
	siGnubash,
	siGo,
	siGraphql,
	siHaskell,
	siHtml5,
	siJavascript,
	siJson,
	siKotlin,
	siLua,
	siMarkdown,
	siNpm,
	siOpenjdk,
	siPhp,
	siPrisma,
	siPython,
	siReact,
	siRuby,
	siRust,
	siSass,
	siScala,
	siSvelte,
	siSvg,
	siSwift,
	siTerraform,
	siToml,
	siTypescript,
	siVuedotjs,
	siYaml,
	siZig,
	type SimpleIcon
} from 'simple-icons';

/** How a file's type is drawn: a language's mark in its own hue (null when the hue would not read), or a glyph. */
export type FileMark = { kind: 'mark'; path: string; hue: string | null } | { kind: 'glyph'; glyph: Icon };

/** Files known by their whole name, before their extension is looked at. */
const BY_NAME: Record<string, SimpleIcon | Icon> = {
	dockerfile: siDocker,
	'package.json': siNpm,
	'package-lock.json': FileLockIcon,
	'.gitignore': siGit,
	'.gitattributes': siGit,
	'.gitmodules': siGit,
	'.env': siDotenv
};

/** A language's mark, or a glyph for a kind of file no language owns, for each extension. */
const BY_EXTENSION: Record<string, SimpleIcon | Icon> = {
	ts: siTypescript,
	mts: siTypescript,
	cts: siTypescript,
	tsx: siReact,
	jsx: siReact,
	js: siJavascript,
	mjs: siJavascript,
	cjs: siJavascript,
	py: siPython,
	pyi: siPython,
	go: siGo,
	rs: siRust,
	svelte: siSvelte,
	vue: siVuedotjs,
	css: siCss,
	scss: siSass,
	sass: siSass,
	html: siHtml5,
	md: siMarkdown,
	mdx: siMarkdown,
	json: siJson,
	jsonc: siJson,
	yaml: siYaml,
	yml: siYaml,
	toml: siToml,
	rb: siRuby,
	php: siPhp,
	swift: siSwift,
	kt: siKotlin,
	kts: siKotlin,
	java: siOpenjdk,
	c: siC,
	h: siC,
	cc: siCplusplus,
	cpp: siCplusplus,
	hpp: siCplusplus,
	cs: siDotnet,
	lua: siLua,
	sh: siGnubash,
	bash: siGnubash,
	zsh: siGnubash,
	graphql: siGraphql,
	gql: siGraphql,
	dart: siDart,
	ex: siElixir,
	exs: siElixir,
	scala: siScala,
	zig: siZig,
	hs: siHaskell,
	tf: siTerraform,
	prisma: siPrisma,
	svg: siSvg,
	env: siDotenv,
	png: FileImageIcon,
	jpg: FileImageIcon,
	jpeg: FileImageIcon,
	gif: FileImageIcon,
	webp: FileImageIcon,
	avif: FileImageIcon,
	ico: FileImageIcon,
	sql: FileSqlIcon,
	csv: FileCsvIcon,
	tsv: FileCsvIcon,
	pdf: FilePdfIcon,
	zip: FileZipIcon,
	gz: FileZipIcon,
	tgz: FileZipIcon,
	tar: FileZipIcon,
	lock: FileLockIcon,
	lockb: FileLockIcon,
	txt: FileTxtIcon,
	log: FileTxtIcon,
	ini: FileIniIcon,
	cfg: FileIniIcon,
	conf: FileIniIcon,
	mp4: FileVideoIcon,
	mov: FileVideoIcon,
	webm: FileVideoIcon,
	mp3: FileAudioIcon,
	wav: FileAudioIcon
};

/** A brand colour this dark or this light carries no hue on either theme, so its mark takes the text colour instead. */
const MIN_LUMINANCE = 0.04;
const MAX_LUMINANCE = 0.85;

/** The relative luminance of a `RRGGBB` colour, by the sRGB formula. */
function luminance(hex: string): number {
	const [r, g, b] = [0, 2, 4].map((at) => {
		const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;

		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});

	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** A mark's hue as a CSS colour, or null when it is too near black or white to tell apart from the text. */
function markHue(icon: SimpleIcon): string | null {
	const light = luminance(icon.hex);

	return light < MIN_LUMINANCE || light > MAX_LUMINANCE ? null : `#${icon.hex}`;
}

/** What a file's name says about its type: an `.env.local` is an env file, any other name by its whole name or its extension. */
function lookup(name: string): SimpleIcon | Icon | null {
	if (name.startsWith('.env.')) return siDotenv;

	const dot = name.lastIndexOf('.');

	return BY_NAME[name] ?? (dot > 0 ? (BY_EXTENSION[name.slice(dot + 1)] ?? null) : null);
}

/** How the file at `path` is drawn: its language's mark, a glyph for its kind, or a plain page for a name we do not know. */
export function fileMark(path: string): FileMark {
	const found = lookup(path.slice(path.lastIndexOf('/') + 1).toLowerCase());

	if (!found) return { kind: 'glyph', glyph: PageIcon };

	if ('path' in found) return { kind: 'mark', path: found.path, hue: markHue(found) };

	return { kind: 'glyph', glyph: found };
}
