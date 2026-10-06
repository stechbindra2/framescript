import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {compile} from '../src/compiler.js';
import {generateRemotionProject} from '../src/targets/remotion.js';
import type {FrameScriptPlugin} from '../src/plugins.js';

describe('Remotion target', () => {
  it('emits a standalone project with pinned renderer packages', async () => {
    const result = compile(`
      composition Demo {
        width: 640; height: 360; fps: 30; duration: 1s;
        text title { text: "Hello"; color: "white"; }
      }
    `);
    const output = await mkdtemp(path.join(tmpdir(), 'framescript-'));
    const generated = await generateRemotionProject(result.ir, {outputDirectory: output, sourceMap: result.sourceMap});
    expect(generated.files).toContain('src/program.generated.ts');
    expect(generated.files).toContain('framescript.map.json');
    expect(generated.files).toContain('src/FrameScriptRuntimeBoundary.tsx');
    const packageJson = JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies.remotion).toMatch(/^4\.0\./u);
    const program = await readFile(path.join(output, 'src/program.generated.ts'), 'utf8');
    expect(program).toContain('"id": "Demo"');
    const sourceMap = await readFile(path.join(output, 'framescript.map.json'), 'utf8');
    expect(sourceMap).toContain('framescript-source-map');
    const boundary = await readFile(path.join(output, 'src', 'FrameScriptRuntimeBoundary.tsx'), 'utf8');
    expect(boundary).toContain('FrameScriptRuntimeError');
  });

  it('statically wires typed plugin renderers and exact dependencies', async () => {
    const plugin = {
      apiVersion: 1,
      name: 'charts',
      version: '1.0.0',
      layers: {chart: {properties: {data: {type: 'array', required: true}}}},
      remotion: {
        chart: {
          packageName: '@example/framescript-charts',
          packageVersion: '2.3.4',
          exportName: 'ChartLayer',
        },
      },
    } as const satisfies FrameScriptPlugin;
    const result = compile('composition Demo { duration: 1s; chart sales { data: [1, 2, 3]; } }', {plugins: [plugin]});
    const output = await mkdtemp(path.join(tmpdir(), 'framescript-plugin-'));
    await generateRemotionProject(result.ir, {outputDirectory: output, plugins: [plugin]});
    const packageJson = JSON.parse(await readFile(path.join(output, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies['@example/framescript-charts']).toBe('2.3.4');
    const runtime = await readFile(path.join(output, 'src', 'FrameScriptComposition.tsx'), 'utf8');
    expect(runtime).toContain("import {ChartLayer as FrameScriptPlugin0} from \"@example/framescript-charts\"");
    expect(runtime).toContain('"chart": FrameScriptPlugin0');
  });

  it('emits deterministic scheduled audio ducking', async () => {
    const result = compile(`
      asset music { src: "music.wav"; type: "audio"; probe: false; }
      asset voice { src: "voice.wav"; type: "audio"; probe: false; }
      composition Demo {
        duration: 3s;
        audio score { src: music; duckUnder: "narration"; duckAmount: 0.2; duckAttack: 5f; duckRelease: 10f; }
        audio narration { src: voice; from: 1s; duration: 1s; }
      }
    `);
    const output = await mkdtemp(path.join(tmpdir(), 'framescript-ducking-'));
    await generateRemotionProject(result.ir, {outputDirectory: output, sourceMap: result.sourceMap});
    const runtime = await readFile(path.join(output, 'src', 'FrameScriptComposition.tsx'), 'utf8');
    expect(runtime).toContain('const duckVolume');
    expect(runtime).toContain('fadeVolume(frame, layer.duration, props) * duckVolume');
  });
});
