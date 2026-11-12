/**
 * A script for the server's HTML that runs before first paint and copies a
 * stored value onto `<html>`, so a skeleton the server drew already has the
 * shape the page will. It parses the JSON kept under `key` into `v` (null
 * when nothing is kept), and when `check`, an expression on `v`, holds, it
 * runs `apply` with `s` set to `<html>`'s style. Storage that is blocked, a
 * value that is not JSON, one that fails the check, or any other throw sets
 * nothing, so the CSS variables keep their fallbacks.
 */
export function storedStyleScript(key: string, check: string, apply: string): string {
	return `(function(){try{var v=JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'null');if(!(${check}))return;var s=document.documentElement.style;${apply}}catch(e){}})();`;
}

/** An expression that holds when `value` is a whole number from `min` to `max` (no upper bound without one). */
export function wholeIn(value: string, min: number, max?: number): string {
	const below = max === undefined ? '' : `&&${value}<=${max}`;

	return `typeof ${value}==='number'&&${value}%1===0&&${value}>=${min}${below}`;
}
