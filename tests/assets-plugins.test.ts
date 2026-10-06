import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {materializeAssets} from '../src/assets.js';
import {compile} from '../src/compiler.js';
import type {FrameScriptPlugin} from '../src/plugins.js';

const particles = {
  apiVersion: 1,
  name: 'test-particles',
  version: '1.0.0',
  layers: {
    particles: {
      properties: {
        count: {type: 'number', required: true},
        tint: {type: 'color', animatable: true},
      },
    },
  },
} as const satisfies FrameScriptPlugin;

describe('asset pipeline and plugins', () => {
  it('hashes and materializes declared local assets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-assets-'));
    await writeFile(path.join(root, 'logo.svg'), '<svg/>', 'utf8');
    const result = compile(`
      asset logo { src: \"logo.svg\"; }
      composition Demo {
        duration: 1s;
        image mark { src: logo; }
      }
    `);
    const output = path.join(root, 'public');
    const materialized = await materializeAssets(result.ir, {sourceDirectory: root, publicDirectory: output});
    const asset = materialized.ir.assets[0]!;
    expect(asset.hash).toHaveLength(64);
    expect(asset.publicPath).toMatch(/^assets\/logo\.[a-f0-9]{16}\.svg$/u);
    expect(await readFile(materialized.copiedFiles[0]!, 'utf8')).toBe('<svg/>');
    expect(materialized.ir.compositions[0]?.layers[0]?.props.src).toBe('asset:logo');
  });

  it('rejects local assets that escape the project root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-root-'));
    const result = compile('asset bad { src: \"../secret.bin\"; } composition Demo { duration: 1s; }');
    await expect(materializeAssets(result.ir, {sourceDirectory: root, publicDirectory: path.join(root, 'public')}))
      .rejects.toThrow(/outside the source directory/u);
  });

  it('validates plugin layer schemas without weakening core validation', () => {
    const result = compile(`
      composition Demo {
        duration: 2s;
        particles stars {
          count: 100;
          tint: \"#fff\";
          animate tint { 0s: \"#fff\"; 2s: \"#80f\"; }
        }
      }
    `, {plugins: [particles]});
    expect(result.ir.compositions[0]?.layers[0]).toMatchObject({type: 'particles', plugin: 'test-particles'});
    expect(() => compile('composition Demo { duration: 1s; particles x { tint: \"red\"; } }', {plugins: [particles]}))
      .toThrow(/Semantic analysis failed/u);
  });
});
