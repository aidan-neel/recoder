import { PANEL_WIDTHS, REM_PX } from './panel-width';

const PANELS = JSON.stringify(Object.values(PANEL_WIDTHS));

/**
 * Runs in `<head>` before first paint, so a saved panel width is in place
 * when the page lays out and nothing shifts once the app starts. It mirrors
 * `parseStoredWidth` and `widthToRem`: text that is not a whole number sets
 * nothing, and the CSS default stands. Storage the browser blocks throws
 * here; the catch lets the page paint with the defaults.
 */
export const PANEL_WIDTH_SCRIPT = `(function(){try{var r=document.documentElement.style;var s=${PANELS};for(var i=0;i<s.length;i++){var t=localStorage.getItem(s[i].key);if(/^\\d{1,4}$/.test(t))r.setProperty(s[i].cssVar,Math.min(s[i].max,Math.max(s[i].min,+t))/${REM_PX}+'rem');}}catch(e){}})();`;
