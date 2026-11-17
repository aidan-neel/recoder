/** The weights the first screens set in the interface face and in the code face. */
const UI_WEIGHTS = ['400', '500', '600'];
const CODE_WEIGHTS = ['400', '500'];

/**
 * Runs in `<head>` after the appearance script, so it reads the typeface the
 * person picked. A browser fetches a face only once text in it is laid out,
 * which here is after the app's code has loaded and rendered, so the first
 * frame painted in a fallback face and swapped. Asking for the faces now
 * fetches them alongside the code. The stylesheet is in place by then, since
 * an inline script waits for the stylesheets before it.
 */
export const FONT_SCRIPT = `(function(){try{var s=getComputedStyle(document.documentElement);var f=[[s.getPropertyValue('--font-ui'),${JSON.stringify(UI_WEIGHTS)}],[s.getPropertyValue('--font-code'),${JSON.stringify(CODE_WEIGHTS)}]];for(var i=0;i<f.length;i++)for(var j=0;j<f[i][1].length;j++)document.fonts.load(f[i][1][j]+' 1em '+f[i][0])['catch'](function(){});}catch(e){}})();`;
