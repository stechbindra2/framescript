import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import type {IRAsset, IRFont, TimelineIR} from './ir.js';

export interface MaterializeAssetsOptions {
  readonly sourceDirectory: string;
  readonly publicDirectory: string;
  readonly allowOutsideSourceDirectory?: boolean;
}

export interface MaterializedAssets {
  readonly ir: TimelineIR;
  readonly copiedFiles: readonly string[];
}

export async function materializeAssets(
  ir: TimelineIR,
  options: MaterializeAssetsOptions,
): Promise<MaterializedAssets> {
  const sourceRoot = path.resolve(options.sourceDirectory);
  const publicRoot = path.resolve(options.publicDirectory);
  const copiedFiles: string[] = [];
  await mkdir(path.join(publicRoot, 'assets'), {recursive: true});

  const assets: IRAsset[] = [];
  for (const asset of ir.assets) {
    if (isRemote(asset.source)) {
      const {sourceDirectory: _sourceDirectory, ...portableAsset} = asset;
      assets.push(portableAsset);
      continue;
    }
    const materialized = await materializeFile(asset.id, asset.source, asset.sourceDirectory ?? sourceRoot, sourceRoot, publicRoot, options.allowOutsideSourceDirectory === true);
    copiedFiles.push(materialized.absoluteDestination);
    const {sourceDirectory: _sourceDirectory, ...portableAsset} = asset;
    assets.push({...portableAsset, hash: materialized.hash, bytes: materialized.bytes, publicPath: materialized.publicPath});
  }

  const fonts: IRFont[] = [];
  for (const font of ir.fonts) {
    if (font.source.startsWith('asset:') || isRemote(font.source)) {
      const {sourceDirectory: _sourceDirectory, ...portableFont} = font;
      fonts.push(portableFont);
      continue;
    }
    const materialized = await materializeFile(`font-${font.id}`, font.source, font.sourceDirectory ?? sourceRoot, sourceRoot, publicRoot, options.allowOutsideSourceDirectory === true);
    copiedFiles.push(materialized.absoluteDestination);
    const {sourceDirectory: _sourceDirectory, ...portableFont} = font;
    fonts.push({...portableFont, source: materialized.publicPath});
  }

  return {ir: {...ir, assets, fonts}, copiedFiles};
}

interface MaterializedFile {
  readonly hash: string;
  readonly bytes: number;
  readonly publicPath: string;
  readonly absoluteDestination: string;
}

async function materializeFile(
  id: string,
  source: string,
  sourceDirectory: string,
  projectRoot: string,
  publicRoot: string,
  allowOutside: boolean,
): Promise<MaterializedFile> {
  const absoluteSource = path.resolve(sourceDirectory, source);
  const relative = path.relative(projectRoot, absoluteSource);
  if (!allowOutside && (relative.startsWith('..') || path.isAbsolute(relative))) {
    throw new Error(`Asset '${source}' resolves outside the source directory. Set allowOutsideSourceDirectory only for a trusted project.`);
  }
  const data = await readFile(absoluteSource);
  const hash = createHash('sha256').update(data).digest('hex');
  const extension = safeExtension(absoluteSource);
  const publicPath = `assets/${sanitize(id)}.${hash.slice(0, 16)}${extension}`;
  const absoluteDestination = path.join(publicRoot, ...publicPath.split('/'));
  await copyFile(absoluteSource, absoluteDestination);
  return {hash, bytes: data.byteLength, publicPath, absoluteDestination};
}

function isRemote(source: string): boolean {
  return /^(?:https?:|data:|blob:)/u.test(source);
}

function safeExtension(file: string): string {
  const extension = path.extname(file).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/u.test(extension) ? extension : '';
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'asset';
}
