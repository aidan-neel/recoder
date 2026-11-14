import { expect, test } from 'bun:test';
import { languageForPath } from '../src/repo-files';

test('the language comes from the extension, or the basename when it has none', () => {
	expect(languageForPath('src/app.ts')).toBe('typescript');
	expect(languageForPath('src/App.TSX')).toBe('typescriptreact');
	expect(languageForPath('docs/README.md')).toBe('markdown');
	expect(languageForPath('Dockerfile')).toBe('dockerfile');
	expect(languageForPath('nested/dir/Gemfile')).toBe('ruby');
});

test('a path with no known extension or basename has no language', () => {
	expect(languageForPath('LICENSE')).toBeNull();
	expect(languageForPath('src/data.weirdext')).toBeNull();
	expect(languageForPath('.hidden')).toBeNull();
});
