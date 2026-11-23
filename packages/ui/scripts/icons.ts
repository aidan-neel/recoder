import { FILLED, GLYPHS } from '../src/components/icon-glyphs';

/**
 * The one Material Symbols face the kit draws. Rounded matches the kit's soft corners and Inter's open forms; weight 500
 * keeps strokes as heavy as Inter's medium labels; optical size 20 is the master drawn for 12 to 20px icons.
 */
const FACE = { family: 'rounded', weight: 500, opticalSize: 20 };

const OUT = new URL('../src/components/icon-glyphs.ts', import.meta.url);

/** A symbol's single SVG path, from Google's static Material Symbols files, outlined or filled. */
async function pathOf(name: string, filled: boolean): Promise<string> {
	const axes = `${FACE.weight === 400 ? '' : `wght${FACE.weight}`}${filled ? 'fill1' : ''}` || 'default';
	const url = `https://fonts.gstatic.com/s/i/short-term/release/materialsymbols${FACE.family}/${name}/${axes}/${FACE.opticalSize}px.svg`;
	const response = await fetch(url);

	if (!response.ok) throw new Error(`${name}: ${response.status} from ${url}`);

	const paths = [...(await response.text()).matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);

	if (paths.length !== 1) throw new Error(`${name}: expected one path, found ${paths.length}`);

	return paths[0];
}

/** The `name: 'path',` lines of one map, sorted by name. */
async function entriesOf(names: Set<string>, filled: boolean): Promise<string> {
	const sorted = [...names].sort();
	const paths = await Promise.all(sorted.map((name) => pathOf(name, filled)));

	return sorted.map((name, index) => `\t${name}: '${paths[index]}'`).join(',\n');
}

/**
 * Rewrites icon-glyphs.ts with the symbols it already has plus the ones named on the command line. `name:fill` also
 * adds the filled face. Delete a line from the file to drop a symbol.
 */
async function main() {
	const asked = process.argv.slice(2);
	const outlined = new Set([...Object.keys(GLYPHS), ...asked.map((arg) => arg.replace(/:fill$/, ''))]);

	const filled = new Set([
		...Object.keys(FILLED),
		...asked.filter((arg) => arg.endsWith(':fill')).map((arg) => arg.replace(/:fill$/, ''))
	]);

	const face = `Material Symbols ${FACE.family[0].toUpperCase()}${FACE.family.slice(1)}, weight ${FACE.weight}, optical size ${FACE.opticalSize}`;

	await Bun.write(
		OUT,
		`/**
 * The UI symbols the kit draws (${face}), inlined as SVG paths so the apps carry them and never load an icon font.
 * Written by \`bun run icons\` in packages/ui; never edit it by hand.
 */
export const GLYPHS = {
${await entriesOf(outlined, false)}
};

/** Filled faces, for the symbols that mark an active state by filling in. */
export const FILLED: Partial<Record<keyof typeof GLYPHS, string>> = {
${await entriesOf(filled, true)}
};
`
	);

	await Bun.$`prettier --write ${Bun.fileURLToPath(OUT)}`.quiet();
}

await main();
