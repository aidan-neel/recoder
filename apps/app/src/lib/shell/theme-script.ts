import { THEME_KEY } from '@recoder/shared';

/**
 * Runs in `<head>` before first paint, so the page never flashes the wrong
 * theme. Mirrors `applyTheme` in @recoder/shared.
 */
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem('${THEME_KEY}')||'system';var l=c==='light'||(c!=='dark'&&matchMedia('(prefers-color-scheme: light)').matches);var r=document.documentElement;r.classList.toggle('dark',!l);r.style.colorScheme=l?'light':'dark';}catch(e){}})();`;
