import {describe, expect, it} from 'vitest';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  completions,
  codeActions,
  definition,
  diagnostics,
  documentSymbols,
  formattingEdit,
  hover,
  irSourceKeyAt,
  prepareRename,
  references,
  rename,
  semanticTokens,
} from '../src/lsp/service.js';
import {ProjectIndex} from '../src/lsp/project-index.js';

const source = `let accent = "#80f";
composition Demo {
  duration: 2s;
  text title {
    text: "Hello";
    color: accent;
  }
}`;

describe('language service', () => {
  it('publishes compiler diagnostics with LSP ranges', () => {
    const items = diagnostics('composition Demo { duration: nope; }');
    expect(items.some(({code}) => code === 'FS3018' || code === 'FS3022')).toBe(true);
    expect(items[0]?.range.start.line).toBeGreaterThanOrEqual(0);
  });

  it('offers context-sensitive completions', () => {
    const compositionItems = completions('composition Demo {\n  ', 21);
    expect(compositionItems.map(({label}) => label)).toContain('duration');
    expect(compositionItems.map(({label}) => label)).toContain('text');
    const easingItems = completions('composition X { rect a { animate opacity { 0s: 0 ease ', 57);
    expect(easingItems.map(({label}) => label)).toContain('out-cubic');
  });

  it('provides hover, definition, symbols, and formatting', () => {
    const colorOffset = source.indexOf('color:') + 2;
    expect(hover(source, colorOffset)).not.toBeNull();
    expect(irSourceKeyAt(source, colorOffset)).toBe('composition/Demo/layer/title/property/color');
    expect(JSON.stringify(hover(source, colorOffset))).toContain('composition/Demo/layer/title/property/color');
    const referenceOffset = source.lastIndexOf('accent') + 2;
    expect(definition(source, 'file:///demo.frame', referenceOffset)?.range.start.line).toBe(0);
    expect(documentSymbols(source).some(({name}) => name === 'Demo')).toBe(true);
    expect(formattingEdit('composition X{duration:1s;}')?.newText).toContain('composition X {');
  });

  it('returns fallback symbols for an incomplete document', () => {
    const symbols = documentSymbols('composition Demo {\n  text title {');
    expect(symbols.map(({name}) => name)).toEqual(['Demo', 'title']);
  });

  it('provides semantic tokens and safe symbol-aware rename', () => {
    const referenceOffset = source.lastIndexOf('accent') + 2;
    const tokens = semanticTokens(source);
    expect(tokens.data.length).toBeGreaterThan(0);
    expect(tokens.data.length % 5).toBe(0);
    expect(references(source, 'file:///demo.frame', referenceOffset, true)).toHaveLength(2);
    expect(prepareRename(source, referenceOffset)).not.toBeNull();
    expect(rename(source, 'file:///demo.frame', referenceOffset, 'brand')?.changes?.['file:///demo.frame']).toHaveLength(2);
    expect(rename(source, 'file:///demo.frame', referenceOffset, 'composition')).toBeNull();
  });

  it('offers quick fixes for omitted composition metadata', () => {
    const incomplete = 'composition Demo {\n}';
    const items = diagnostics(incomplete);
    const actions = codeActions(incomplete, 'file:///demo.frame', items);
    expect(actions.map(({title}) => title)).toEqual(expect.arrayContaining([
      'Add width: 1920', 'Add height: 1080', 'Add fps: 30', 'Add duration: 5s',
    ]));
  });

  it('indexes definitions, references, symbols, and renames across modules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-lsp-'));
    const themeFile = path.join(root, 'theme.frame');
    const mainFile = path.join(root, 'main.frame');
    const theme = 'let accent = "#80f";\n';
    const main = [
      'import { accent as brand } from "./theme.frame";',
      'composition Demo { duration: 1s; background: brand; }',
    ].join('\n');
    await writeFile(themeFile, theme, 'utf8');
    await writeFile(mainFile, main, 'utf8');
    const themeUri = pathToFileURL(themeFile).href;
    const mainUri = pathToFileURL(mainFile).href;
    const index = new ProjectIndex([root]);

    const target = await index.definition(mainUri, main.lastIndexOf('brand') + 2);
    expect(target?.uri).toBe(themeUri);
    expect(await index.references(mainUri, main.lastIndexOf('brand') + 2, true)).toHaveLength(4);
    expect((await index.workspaceSymbols('acc')).map(({name}) => name)).toContain('accent');

    const globalRename = await index.rename(themeUri, theme.indexOf('accent') + 2, 'primary');
    expect(globalRename?.changes?.[themeUri]).toHaveLength(1);
    expect(globalRename?.changes?.[mainUri]).toHaveLength(1);
    const aliasRename = await index.rename(mainUri, main.lastIndexOf('brand') + 2, 'ink');
    expect(aliasRename?.changes?.[mainUri]).toHaveLength(2);
    expect(aliasRename?.changes?.[themeUri]).toBeUndefined();

    index.setDocument(themeUri, 'let accent = missing;\n');
    const projectDiagnostics = await index.diagnostics(mainUri);
    expect(projectDiagnostics.get(themeUri)?.some(({code}) => code === 'FS3018')).toBe(true);
  });
});
