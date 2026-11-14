import { THEME_KEY } from '@recoder/shared';

import { PALETTE, TYPEFACE, type RootChoice } from './choices';

/** What the script needs of a choice: where it is saved, its attribute, and the picks that set the attribute. */
interface ScriptChoice {
	key: string;
	attribute: string;
	ids: string[];
}

function toScriptChoice<Id extends string>({ key, attribute, options, fallback }: RootChoice<Id>): ScriptChoice {
	return { key, attribute, ids: options.map((option) => option.id).filter((id) => id !== fallback) };
}

const CHOICES = JSON.stringify([toScriptChoice(PALETTE), toScriptChoice(TYPEFACE)]);

/**
 * Runs in `<head>` before first paint, so the page never flashes the wrong
 * theme, palette or typeface. The theme part mirrors `applyTheme` in
 * @recoder/shared; the rest mirrors `readChoice`: a saved pick that is not
 * one of the choice's own sets nothing. Storage the browser blocks throws
 * here; the catch lets the page paint with the defaults, and the stores take
 * over once the app runs.
 */
export const APPEARANCE_SCRIPT = `(function(){try{var r=document.documentElement;var c=localStorage.getItem('${THEME_KEY}')||'system';var l=c==='light'||(c!=='dark'&&matchMedia('(prefers-color-scheme: light)').matches);r.classList.toggle('dark',!l);r.style.colorScheme=l?'light':'dark';var s=${CHOICES};for(var i=0;i<s.length;i++){var v=localStorage.getItem(s[i].key);if(s[i].ids.indexOf(v)>=0)r.setAttribute(s[i].attribute,v);}}catch(e){}})();`;
