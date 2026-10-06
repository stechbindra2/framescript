import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {compile} from '../src/compiler.js';
import {compileProject} from '../src/modules.js';
import {remapRuntimeError, resolveSourceLocation} from '../src/source-map.js';

describe('IR source maps', () => {
  it('maps semantic IR keys to exact source spans and remaps runtime errors', () => {
    const file = path.resolve('demo.frame');
    const result = compile([
      'composition Demo {',
      '  duration: 1s;',
      '  text title { text: "Hello"; color: "white"; }',
      '}',
    ].join('\n'), {file});
    const key = 'composition/Demo/layer/title/property/color';
    const location = resolveSourceLocation(result.sourceMap, key);
    expect(location).toMatchObject({path: 'demo.frame', start: {line: 3, column: 31}});
    expect(result.sourceMap.sources[0]?.sha256).toHaveLength(64);

    const remapped = remapRuntimeError(new Error('Renderer exploded'), key, result.sourceMap);
    expect(remapped.message).toContain('Renderer exploded');
    expect(remapped.message).toContain('demo.frame:3:31');
    expect(remapped.cause).toBeInstanceOf(Error);
  });

  it('keeps imported source paths relative and maps mangled asset IDs to their module', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-map-'));
    const shared = path.join(root, 'shared.frame');
    const entry = path.join(root, 'main.frame');
    await writeFile(shared, 'asset logo { src: "logo.svg"; }', 'utf8');
    await writeFile(entry, [
      'import { logo as mark } from "./shared.frame";',
      'composition Demo { duration: 1s; image hero { src: mark; } }',
    ].join('\n'), 'utf8');
    const result = await compileProject(entry);
    const assetKey = Object.keys(result.sourceMap.mappings).find((key) => key.startsWith('asset/'))!;
    const location = resolveSourceLocation(result.sourceMap, assetKey);
    expect(location?.path).toBe('shared.frame');
    expect(result.sourceMap.sources.map(({path: sourcePath}) => sourcePath).sort()).toEqual(['main.frame', 'shared.frame']);
    expect(JSON.stringify(result.sourceMap)).not.toContain(root);
  });
});
