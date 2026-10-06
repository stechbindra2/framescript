import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {FrameScriptError} from '../src/diagnostics.js';
import {compileProject} from '../src/modules.js';
import {buildProject} from '../src/project-builder.js';

describe('cross-file modules', () => {
  it('resolves named imports and aliases through transitive module references', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-modules-'));
    await writeFile(path.join(root, 'palette.frame'), 'let violet = "#805ad5";\n', 'utf8');
    await writeFile(path.join(root, 'theme.frame'), [
      'import { violet as brand } from "./palette";',
      'let heading = brand;',
    ].join('\n'), 'utf8');
    const entry = path.join(root, 'main.frame');
    await writeFile(entry, [
      'import { heading as accent } from "./theme.frame";',
      'composition Demo {',
      '  duration: 1s;',
      '  text title { text: "Hello"; color: accent; }',
      '}',
    ].join('\n'), 'utf8');

    const result = await compileProject(entry);
    expect(result.ir.compositions[0]?.layers[0]?.props.color).toBe('#805ad5');
    expect(result.dependencyFiles).toHaveLength(2);
  });

  it('materializes imported assets relative to the declaring module', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-module-assets-'));
    await mkdir(path.join(root, 'app'));
    await mkdir(path.join(root, 'shared', 'media'), {recursive: true});
    await writeFile(path.join(root, 'shared', 'media', 'logo.svg'), '<svg/>', 'utf8');
    await writeFile(path.join(root, 'shared', 'media.frame'), 'asset logo { src: "media/logo.svg"; }', 'utf8');
    const entry = path.join(root, 'app', 'main.frame');
    await writeFile(entry, [
      'import { logo as mark } from "../shared/media.frame";',
      'composition Demo { duration: 1s; image hero { src: mark; } }',
    ].join('\n'), 'utf8');

    const built = await buildProject({sourceFile: entry, outputDirectory: path.join(root, 'app', 'out')});
    expect(built.copiedAssets).toHaveLength(1);
    expect(await readFile(built.copiedAssets[0]!, 'utf8')).toBe('<svg/>');
    expect(built.compilation.ir.compositions[0]?.layers[0]?.props.src).toMatch(/^asset:__fs_/u);
  });

  it('reports missing exports and import cycles at the importing file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-module-errors-'));
    const entry = path.join(root, 'main.frame');
    await writeFile(path.join(root, 'empty.frame'), 'let present = 1;', 'utf8');
    await writeFile(entry, 'import { missing } from "./empty.frame";\ncomposition Demo { duration: 1s; }', 'utf8');
    await expect(compileProject(entry)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({code: 'FS4003', file: entry})],
    });

    await writeFile(entry, 'import { b } from "./b.frame";\ncomposition Demo { duration: 1s; }\nlet a = 1;', 'utf8');
    await writeFile(path.join(root, 'b.frame'), 'import { a } from "./main.frame";\nlet b = 2;', 'utf8');
    await expect(compileProject(entry)).rejects.toBeInstanceOf(FrameScriptError);
    await expect(compileProject(entry)).rejects.toMatchObject({
      diagnostics: [expect.objectContaining({code: 'FS4004'})],
    });
  });
});
