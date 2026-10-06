import {watch, type FSWatcher} from 'node:fs';
import path from 'node:path';
import type {FrameScriptPlugin} from './plugins.js';
import {buildProject, type ProjectBuildResult} from './project-builder.js';

export type WatchEvent =
  | {readonly type: 'building'; readonly reason: string}
  | {readonly type: 'success'; readonly reason: string; readonly result: ProjectBuildResult}
  | {readonly type: 'error'; readonly reason: string; readonly error: unknown};

export interface WatchProjectOptions {
  readonly sourceFile: string;
  readonly outputDirectory: string;
  readonly plugins?: readonly FrameScriptPlugin[];
  readonly debounceMs?: number;
  readonly onEvent?: (event: WatchEvent) => void;
}

export interface WatchController {
  readonly initialBuild: Promise<void>;
  close(): void;
}

export function watchProject(options: WatchProjectOptions): WatchController {
  const sourceFile = path.resolve(options.sourceFile);
  const sourceDirectory = path.dirname(sourceFile);
  const outputDirectory = path.resolve(options.outputDirectory);
  const debounceMs = options.debounceMs ?? 100;
  let watcher: FSWatcher | undefined;
  let watchedRoot: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let queuedReason: string | undefined;
  let closed = false;

  const rebuild = async (reason: string): Promise<void> => {
    if (closed) return;
    if (running) {
      queuedReason = reason;
      return;
    }
    running = true;
    options.onEvent?.({type: 'building', reason});
    try {
      const result = await buildProject({
        sourceFile,
        outputDirectory,
        ...(options.plugins ? {plugins: options.plugins} : {}),
      });
      installWatcher(commonDirectory([sourceFile, ...result.compilation.dependencyFiles]));
      options.onEvent?.({type: 'success', reason, result});
    } catch (error) {
      options.onEvent?.({type: 'error', reason, error});
    } finally {
      running = false;
      const queued = queuedReason;
      queuedReason = undefined;
      if (queued && !closed) await rebuild(queued);
    }
  };

  const schedule = (reason: string): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void rebuild(reason);
    }, debounceMs);
  };

  const installWatcher = (root: string): void => {
    if (closed || root === watchedRoot) return;
    watcher?.close();
    watchedRoot = root;
    watcher = watch(root, {recursive: true}, (_event, filename) => {
      if (!filename) return;
      const changed = path.resolve(root, String(filename));
      if (isInside(outputDirectory, changed) || isIgnored(root, changed)) return;
      schedule(path.relative(root, changed).replaceAll('\\', '/'));
    });
    watcher.on('error', (error) => options.onEvent?.({type: 'error', reason: 'watcher', error}));
  };

  const initialBuild = rebuild('initial').then(() => {
    if (closed) return;
    if (!watchedRoot) installWatcher(sourceDirectory);
  });

  return {
    initialBuild,
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}

function commonDirectory(files: readonly string[]): string {
  if (files.length === 0) return process.cwd();
  let common = path.dirname(path.resolve(files[0]!));
  for (const file of files.slice(1)) {
    const directory = path.dirname(path.resolve(file));
    while (!isInside(common, directory)) {
      const parent = path.dirname(common);
      if (parent === common) return common;
      common = parent;
    }
  }
  return common;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isIgnored(sourceRoot: string, candidate: string): boolean {
  const segments = path.relative(sourceRoot, candidate).split(path.sep);
  return segments.some((segment) => ['node_modules', '.git', 'dist', 'coverage'].includes(segment));
}
