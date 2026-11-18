import {
	siC,
	siCplusplus,
	siCss,
	siDart,
	siDocker,
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
	siPython,
	siReact,
	siRuby,
	siRust,
	siSass,
	siScala,
	siSvelte,
	siSwift,
	siTerraform,
	siToml,
	siTypescript,
	siVuedotjs,
	siYaml,
	siZig,
	type SimpleIcon
} from 'simple-icons';

/** Files known by their whole name, before their extension is looked at. */
const BY_NAME: Record<string, SimpleIcon> = {
	dockerfile: siDocker,
	'package.json': siNpm,
	'.gitignore': siGit,
	'.gitattributes': siGit
};

/** A language's mark for each extension that is written in it. */
const BY_EXTENSION: Record<string, SimpleIcon> = {
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
	tf: siTerraform
};

/** The mark of the language a file at `path` is written in, or null when its name says nothing we know. */
export function fileLanguageIcon(path: string): SimpleIcon | null {
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	const dot = name.lastIndexOf('.');

	return BY_NAME[name] ?? (dot > 0 ? (BY_EXTENSION[name.slice(dot + 1)] ?? null) : null);
}
