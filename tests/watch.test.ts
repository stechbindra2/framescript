import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {watchProject, type WatchEvent} from '../src/watch.js';

describe('incremental project watch', () => {
  it('rebuilds generated IR after a source change without watching its own output', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-watch-'));
    const sourceFile = path.join(root, 'demo.frame');
    const outputDirectory = path.join(root, '.framescript', 'demo');
    await writeFile(sourceFile, 'composition Demo { fps: 30; duration: 1s; }', 'utf8');
    let successes = 0;
    let resolveSecond: (() => void) | undefined;
    const secondBuild = new Promise<void>((resolve) => { resolveSecond = resolve; });
    const events: WatchEvent[] = [];
    const controller = watchProject({
      sourceFile,
      outputDirectory,
      debounceMs: 25,
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'success') {
          successes += 1;
          if (successes === 2) resolveSecond?.();
        }
      },
    });
    try {
      await controller.initialBuild;
      await writeFile(sourceFile, 'composition Demo { fps: 30; duration: 2s; }', 'utf8');
      await Promise.race([
        secondBuild,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('watch rebuild timed out')), 5_000)),
      ]);
      const generated = await readFile(path.join(outputDirectory, 'src', 'program.generated.ts'), 'utf8');
      expect(generated).toContain('"durationInFrames": 60');
      expect(events.filter(({type}) => type === 'success')).toHaveLength(2);
    } finally {
      controller.close();
    }
  }, 10_000);

  it('rebuilds when a dependency outside the entry directory changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-watch-module-'));
    const app = path.join(root, 'app');
    await mkdir(app);
    const dependency = path.join(root, 'timing.frame');
    const sourceFile = path.join(app, 'demo.frame');
    const outputDirectory = path.join(app, '.framescript', 'demo');
    await writeFile(dependency, 'let length = 1s;', 'utf8');
    await writeFile(sourceFile, 'import { length } from "../timing.frame"; composition Demo { fps: 30; duration: length; }', 'utf8');
    let successes = 0;
    let resolveSecond: (() => void) | undefined;
    const secondBuild = new Promise<void>((resolve) => { resolveSecond = resolve; });
    const controller = watchProject({
      sourceFile,
      outputDirectory,
      debounceMs: 25,
      onEvent: (event) => {
        if (event.type === 'success' && ++successes === 2) resolveSecond?.();
      },
    });
    try {
      await controller.initialBuild;
      await writeFile(dependency, 'let length = 2s;', 'utf8');
      await Promise.race([
        secondBuild,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('dependency rebuild timed out')), 5_000)),
      ]);
      const generated = await readFile(path.join(outputDirectory, 'src', 'program.generated.ts'), 'utf8');
      expect(generated).toContain('"durationInFrames": 60');
    } finally {
      controller.close();
    }
  }, 10_000);
});
