/** Attributes as a selector names them: `[name]` or `[name="value"]`, the only selectors the boot script uses. */
const SELECTOR = /^\[([\w-]+)(?:="([^"]*)")?\]$/;

/**
 * Just enough of a DOM node for the boot script's tab drawing: attributes,
 * children, text, cloning and attribute selectors. A node named `#text` is
 * a text node and `#fragment` a document fragment.
 */
export class FakeNode {
	readonly attributes = new Map<string, string>();
	children: FakeNode[] = [];
	parent: FakeNode | null = null;
	value = '';

	constructor(
		readonly name: string,
		attributes: Record<string, string> = {},
		children: (FakeNode | string)[] = []
	) {
		for (const [key, value] of Object.entries(attributes)) this.attributes.set(key, value);
		for (const child of children) this.appendChild(typeof child === 'string' ? text(child) : child);
	}

	get firstChild(): FakeNode | null {
		return this.children[0] ?? null;
	}

	get firstElementChild(): FakeNode | null {
		return this.children.find((child) => child.name !== '#text') ?? null;
	}

	get nodeValue(): string {
		return this.value;
	}

	set nodeValue(value: string) {
		this.value = value;
	}

	get textContent(): string {
		return this.name === '#text' ? this.value : this.children.map((child) => child.textContent).join('');
	}

	set textContent(value: string) {
		this.children = [];
		this.appendChild(text(value));
	}

	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, String(value));
	}

	appendChild(node: FakeNode): FakeNode {
		const nodes = node.name === '#fragment' ? node.children.splice(0) : [node];

		for (const child of nodes) {
			child.parent = this;
			this.children.push(child);
		}

		return node;
	}

	insertBefore(node: FakeNode, before: FakeNode | null): FakeNode {
		const at = before ? this.children.indexOf(before) : this.children.length;

		node.parent = this;
		this.children.splice(at, 0, node);

		return node;
	}

	remove(): void {
		if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
	}

	cloneNode(deep: boolean): FakeNode {
		const copy = new FakeNode(this.name, Object.fromEntries(this.attributes));

		copy.value = this.value;

		if (deep) for (const child of this.children) copy.appendChild(child.cloneNode(true));

		return copy;
	}

	querySelector(selector: string): FakeNode | null {
		const [, name, value] = SELECTOR.exec(selector) ?? [];

		for (const child of this.children) {
			const own = child.attributes.get(name ?? '');

			if (own !== undefined && (value === undefined || own === value)) return child;

			const deeper = child.querySelector(selector);

			if (deeper) return deeper;
		}

		return null;
	}
}

function text(value: string): FakeNode {
	const node = new FakeNode('#text');

	node.value = value;

	return node;
}

/** An element with a `data-ui` hook. */
function ui(name: string, children: (FakeNode | string)[] = [], attributes: Record<string, string> = {}): FakeNode {
	return new FakeNode('span', { 'data-ui': name, ...attributes }, children);
}

/** A strip piece as `Grow` lays it out. */
function grow(child: FakeNode): FakeNode {
	return ui('grow', [ui('grow-body', [child])]);
}

/** A review tab as `TopTab` and `ReviewTabLabel` draw the boot bar's prototype, finished or running. */
function protoTab(running: boolean): FakeNode {
	const count = running ? [] : [ui('tab-count', ['1', ui('sr-only', [' open'])], { 'data-variant': 'badge' })];

	const link = new FakeNode('a', { 'data-ui': 'top-tab-link', href: '/review/' }, [
		ui('tab-glyph'),
		ui('tab-repo'),
		ui('tab-number', ['#0']),
		ui('tab-title', ['-']),
		...count
	]);

	return new FakeNode('div', { 'data-ui': 'top-tab', 'data-state': 'inactive', 'data-tab': '' }, [
		link,
		new FakeNode('button', { 'data-slot': 'tab-close' })
	]);
}

/** The boot bar's hidden pieces (`BootPieces` in boot-bar.tsx), in the shape the strip's components draw them. */
export function bootPieces(): FakeNode {
	const proto = (name: string, child: FakeNode) => new FakeNode('span', { 'data-boot-proto': name }, [child]);

	return new FakeNode('div', { 'data-boot-protos': '' }, [
		proto('separator', grow(ui('top-tab-separator'))),
		proto('done', grow(protoTab(false))),
		proto('running', grow(protoTab(true))),
		proto('room', grow(ui('tab-room'))),
		proto('pill', ui('nav-pill')),
		proto('more', grow(new FakeNode('button', { 'data-slot': 'tab-more' }, ['More', ui('tab-count', ['0'])])))
	]);
}

/**
 * The drawn strip, one line per piece: `|` for the separator, a tab as its
 * pill mark, names and count (`*api #2 Fix ·3!` for the page's tab with
 * three open decisions, one high), `[ ]` for the room a review page keeps
 * for its tab before it opens, then `More 2` (`More 2*` when it holds the
 * page's tab).
 */
export function describeStrip(box: FakeNode): string[] {
	return box.children.flatMap((piece) => {
		const tab = piece.querySelector('[data-ui="top-tab"]');
		const more = piece.querySelector('[data-slot="tab-more"]');

		if (piece.querySelector('[data-ui="top-tab-separator"]')) return ['|'];
		if (piece.querySelector('[data-ui="tab-room"]')) return ['[ ]'];
		if (more)
			return [
				`More ${more.querySelector('[data-ui="tab-count"]')?.textContent}${more.getAttribute('data-holds-active') === null ? '' : '*'}`
			];
		if (!tab) return [];

		const part = (name: string) => tab.querySelector(`[data-ui="${name}"]`);
		const count = part('tab-count');
		const pill = tab.firstChild?.getAttribute('data-ui') === 'nav-pill' && tab.getAttribute('data-state') === 'active';
		const names = [part('tab-repo')?.textContent, part('tab-number')?.textContent, part('tab-title')?.textContent];

		const badge = count
			? ` ·${count.firstChild?.nodeValue}${count.getAttribute('data-tone') === 'high' ? '!' : ''}`
			: '';

		return [`${pill ? '*' : ''}${names.filter(Boolean).join(' ')}${badge}`];
	});
}
