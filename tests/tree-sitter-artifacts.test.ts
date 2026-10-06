import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const grammarRoot = path.resolve('tree-sitter-framescript');

describe('generated Tree-sitter artifacts', () => {
  it('contains the stable named nodes required by editor queries', async () => {
    const raw = await readFile(path.join(grammarRoot, 'src', 'node-types.json'), 'utf8');
    const nodes = JSON.parse(raw) as Array<{type: string; named: boolean}>;
    const names = new Set(nodes.filter(({named}) => named).map(({type}) => type));
    for (const expected of [
      'source_file', 'import_declaration', 'import_specifier', 'constant_declaration', 'composition_declaration',
      'layer_declaration', 'property_declaration', 'animation_declaration', 'keyframe',
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  it('emits a C parser using Tree-sitter language ABI 15', async () => {
    const parser = await readFile(path.join(grammarRoot, 'src', 'parser.c'), 'utf8');
    expect(parser).toContain('#define LANGUAGE_VERSION 15');
    expect(parser).toContain('tree_sitter_framescript');
  });

  it('ships structural editor queries', async () => {
    const names = ['highlights.scm', 'folds.scm', 'indents.scm', 'locals.scm', 'tags.scm'];
    const queries = await Promise.all(names.map((name) => readFile(path.join(grammarRoot, 'queries', name), 'utf8')));
    expect(queries.every((query) => query.trim().length > 0)).toBe(true);
  });
});
