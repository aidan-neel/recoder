/**
 * File + folder icons (Material Icon Theme) for the file tree.
 *
 * Curated static set: SVGs are inlined at build time (sync render, no pop-in,
 * negligible bundle cost). To support another type, add the `?raw` import and
 * a map entry below — icon names match `material-icon-theme/icons/*.svg`.
 */

import bunSvg from 'material-icon-theme/icons/bun.svg?raw';
import consoleSvg from 'material-icon-theme/icons/console.svg?raw';
import cssSvg from 'material-icon-theme/icons/css.svg?raw';
import dockerSvg from 'material-icon-theme/icons/docker.svg?raw';
import fileSvg from 'material-icon-theme/icons/file.svg?raw';
import gitSvg from 'material-icon-theme/icons/git.svg?raw';
import goSvg from 'material-icon-theme/icons/go.svg?raw';
import htmlSvg from 'material-icon-theme/icons/html.svg?raw';
import imageSvg from 'material-icon-theme/icons/image.svg?raw';
import javascriptSvg from 'material-icon-theme/icons/javascript.svg?raw';
import jsonSvg from 'material-icon-theme/icons/json.svg?raw';
import lockSvg from 'material-icon-theme/icons/lock.svg?raw';
import markdownSvg from 'material-icon-theme/icons/markdown.svg?raw';
import nodejsSvg from 'material-icon-theme/icons/nodejs.svg?raw';
import pythonSvg from 'material-icon-theme/icons/python.svg?raw';
import reactSvg from 'material-icon-theme/icons/react.svg?raw';
import reactTsSvg from 'material-icon-theme/icons/react_ts.svg?raw';
import rustSvg from 'material-icon-theme/icons/rust.svg?raw';
import sassSvg from 'material-icon-theme/icons/sass.svg?raw';
import svelteSvg from 'material-icon-theme/icons/svelte.svg?raw';
import tomlSvg from 'material-icon-theme/icons/toml.svg?raw';
import typescriptSvg from 'material-icon-theme/icons/typescript.svg?raw';
import viteSvg from 'material-icon-theme/icons/vite.svg?raw';
import vueSvg from 'material-icon-theme/icons/vue.svg?raw';
import yamlSvg from 'material-icon-theme/icons/yaml.svg?raw';

import folderSvg from 'material-icon-theme/icons/folder.svg?raw';
import folderOpenSvg from 'material-icon-theme/icons/folder-open.svg?raw';
import folderAppSvg from 'material-icon-theme/icons/folder-app.svg?raw';
import folderAppOpenSvg from 'material-icon-theme/icons/folder-app-open.svg?raw';
import folderClientSvg from 'material-icon-theme/icons/folder-client.svg?raw';
import folderClientOpenSvg from 'material-icon-theme/icons/folder-client-open.svg?raw';
import folderComponentsSvg from 'material-icon-theme/icons/folder-components.svg?raw';
import folderComponentsOpenSvg from 'material-icon-theme/icons/folder-components-open.svg?raw';
import folderConfigSvg from 'material-icon-theme/icons/folder-config.svg?raw';
import folderConfigOpenSvg from 'material-icon-theme/icons/folder-config-open.svg?raw';
import folderDistSvg from 'material-icon-theme/icons/folder-dist.svg?raw';
import folderDistOpenSvg from 'material-icon-theme/icons/folder-dist-open.svg?raw';
import folderDocsSvg from 'material-icon-theme/icons/folder-docs.svg?raw';
import folderDocsOpenSvg from 'material-icon-theme/icons/folder-docs-open.svg?raw';
import folderGitSvg from 'material-icon-theme/icons/folder-git.svg?raw';
import folderGitOpenSvg from 'material-icon-theme/icons/folder-git-open.svg?raw';
import folderLibSvg from 'material-icon-theme/icons/folder-lib.svg?raw';
import folderLibOpenSvg from 'material-icon-theme/icons/folder-lib-open.svg?raw';
import folderNodeSvg from 'material-icon-theme/icons/folder-node.svg?raw';
import folderNodeOpenSvg from 'material-icon-theme/icons/folder-node-open.svg?raw';
import folderPublicSvg from 'material-icon-theme/icons/folder-public.svg?raw';
import folderPublicOpenSvg from 'material-icon-theme/icons/folder-public-open.svg?raw';
import folderRoutesSvg from 'material-icon-theme/icons/folder-routes.svg?raw';
import folderRoutesOpenSvg from 'material-icon-theme/icons/folder-routes-open.svg?raw';
import folderServerSvg from 'material-icon-theme/icons/folder-server.svg?raw';
import folderServerOpenSvg from 'material-icon-theme/icons/folder-server-open.svg?raw';
import folderSrcSvg from 'material-icon-theme/icons/folder-src.svg?raw';
import folderSrcOpenSvg from 'material-icon-theme/icons/folder-src-open.svg?raw';
import folderTestSvg from 'material-icon-theme/icons/folder-test.svg?raw';
import folderTestOpenSvg from 'material-icon-theme/icons/folder-test-open.svg?raw';

const byExtension: Record<string, string> = {
	ts: typescriptSvg,
	mts: typescriptSvg,
	cts: typescriptSvg,
	tsx: reactTsSvg,
	js: javascriptSvg,
	mjs: javascriptSvg,
	cjs: javascriptSvg,
	jsx: reactSvg,
	py: pythonSvg,
	pyi: pythonSvg,
	json: jsonSvg,
	jsonc: jsonSvg,
	json5: jsonSvg,
	md: markdownSvg,
	mdx: markdownSvg,
	markdown: markdownSvg,
	css: cssSvg,
	scss: sassSvg,
	sass: sassSvg,
	less: cssSvg,
	html: htmlSvg,
	htm: htmlSvg,
	svelte: svelteSvg,
	vue: vueSvg,
	yaml: yamlSvg,
	yml: yamlSvg,
	toml: tomlSvg,
	sh: consoleSvg,
	bash: consoleSvg,
	zsh: consoleSvg,
	fish: consoleSvg,
	rs: rustSvg,
	go: goSvg,
	svg: imageSvg,
	png: imageSvg,
	jpg: imageSvg,
	jpeg: imageSvg,
	gif: imageSvg,
	webp: imageSvg,
	ico: imageSvg,
	lock: lockSvg
};

const byExactName: Record<string, string> = {
	dockerfile: dockerSvg,
	'docker-compose.yml': dockerSvg,
	'docker-compose.yaml': dockerSvg,
	'compose.yml': dockerSvg,
	'compose.yaml': dockerSvg,
	'.gitignore': gitSvg,
	'.gitattributes': gitSvg,
	'.gitmodules': gitSvg,
	'package.json': nodejsSvg,
	'package-lock.json': nodejsSvg,
	'bun.lock': bunSvg,
	'bun.lockb': bunSvg,
	'vite.config.ts': viteSvg,
	'vite.config.js': viteSvg,
	'vite.config.mts': viteSvg,
	'svelte.config.js': svelteSvg
};

/** Raw SVG markup for a file's language icon. Falls back to a generic file. */
export function getFileIcon(filename: string): string {
	const lower = filename.toLowerCase();
	const exact = byExactName[lower];
	if (exact) return exact;
	const dot = lower.lastIndexOf('.');
	if (dot !== -1) {
		const icon = byExtension[lower.slice(dot + 1)];
		if (icon) return icon;
	}
	return fileSvg;
}

interface FolderPair {
	closed: string;
	opened: string;
}

function pair(closed: string, opened: string): FolderPair {
	return { closed, opened };
}

const defaultFolder = pair(folderSvg, folderOpenSvg);

const folderPairs: Record<string, FolderPair> = {
	src: pair(folderSrcSvg, folderSrcOpenSvg),
	source: pair(folderSrcSvg, folderSrcOpenSvg),
	test: pair(folderTestSvg, folderTestOpenSvg),
	tests: pair(folderTestSvg, folderTestOpenSvg),
	__tests__: pair(folderTestSvg, folderTestOpenSvg),
	docs: pair(folderDocsSvg, folderDocsOpenSvg),
	doc: pair(folderDocsSvg, folderDocsOpenSvg),
	public: pair(folderPublicSvg, folderPublicOpenSvg),
	static: pair(folderPublicSvg, folderPublicOpenSvg),
	assets: pair(folderPublicSvg, folderPublicOpenSvg),
	components: pair(folderComponentsSvg, folderComponentsOpenSvg),
	lib: pair(folderLibSvg, folderLibOpenSvg),
	libs: pair(folderLibSvg, folderLibOpenSvg),
	routes: pair(folderRoutesSvg, folderRoutesOpenSvg),
	app: pair(folderAppSvg, folderAppOpenSvg),
	server: pair(folderServerSvg, folderServerOpenSvg),
	api: pair(folderServerSvg, folderServerOpenSvg),
	client: pair(folderClientSvg, folderClientOpenSvg),
	node_modules: pair(folderNodeSvg, folderNodeOpenSvg),
	'.git': pair(folderGitSvg, folderGitOpenSvg),
	'.github': pair(folderGitSvg, folderGitOpenSvg),
	dist: pair(folderDistSvg, folderDistOpenSvg),
	build: pair(folderDistSvg, folderDistOpenSvg),
	out: pair(folderDistSvg, folderDistOpenSvg),
	config: pair(folderConfigSvg, folderConfigOpenSvg)
};

/** Raw SVG markup for a folder icon, honoring the open state. */
export function getFolderIcon(folderName: string, opened: boolean): string {
	const folder = folderPairs[folderName.toLowerCase()] ?? defaultFolder;
	return opened ? folder.opened : folder.closed;
}
