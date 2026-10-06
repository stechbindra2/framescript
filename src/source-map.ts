import {createHash} from 'node:crypto';
import path from 'node:path';
import type {Position, Span} from './ast.js';

export interface SourceMapDraft {
  readonly mappings: Readonly<Record<string, Span>>;
}

export interface FrameScriptSourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface FrameScriptSourceRange {
  readonly start: FrameScriptSourcePosition;
  readonly end: FrameScriptSourcePosition;
}

export interface FrameScriptSourceDocument {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
}

export interface FrameScriptSourceMapping extends FrameScriptSourceRange {
  readonly source: string;
}

export interface FrameScriptSourceMap {
  readonly schema: 'framescript-source-map';
  readonly version: 1;
  readonly entry: string;
  readonly sources: readonly FrameScriptSourceDocument[];
  readonly mappings: Readonly<Record<string, FrameScriptSourceMapping>>;
}

export interface FinalizeSourceMapOptions {
  readonly entryFile: string;
  readonly projectRoot: string;
  readonly sources: ReadonlyMap<string, string>;
}

export interface ResolvedSourceLocation {
  readonly key: string;
  readonly path: string;
  readonly start: FrameScriptSourcePosition;
  readonly end: FrameScriptSourcePosition;
}

export class FrameScriptRuntimeError extends Error {
  public constructor(
    message: string,
    public readonly sourceKey: string,
    public readonly location: ResolvedSourceLocation | undefined,
    cause?: unknown,
  ) {
    super(message, {cause});
    this.name = 'FrameScriptRuntimeError';
  }
}

export function finalizeSourceMap(
  draft: SourceMapDraft,
  options: FinalizeSourceMapOptions,
): FrameScriptSourceMap {
  const files = [...new Set([
    ...options.sources.keys(),
    ...Object.values(draft.mappings)
      .map(({sourceFile}) => sourceFile)
      .filter((file): file is string => Boolean(file)),
  ])].sort();
  const documents = files.map((file, index): FrameScriptSourceDocument => ({
    id: `s${index}`,
    path: portablePath(path.relative(options.projectRoot, file) || path.basename(file)),
    sha256: createHash('sha256').update(options.sources.get(file) ?? '').digest('hex'),
  }));
  const ids = new Map(files.map((file, index) => [file, `s${index}`]));
  const mappings = Object.fromEntries(Object.entries(draft.mappings).flatMap(([key, span]) => {
    const source = span.sourceFile ? ids.get(span.sourceFile) : undefined;
    return source ? [[key, {source, start: sourcePosition(span.start), end: sourcePosition(span.end)}]] : [];
  }));
  return {
    schema: 'framescript-source-map',
    version: 1,
    entry: portablePath(path.relative(options.projectRoot, options.entryFile) || path.basename(options.entryFile)),
    sources: documents,
    mappings,
  };
}

export function resolveSourceLocation(
  sourceMap: FrameScriptSourceMap,
  key: string,
): ResolvedSourceLocation | undefined {
  let candidate = key;
  while (candidate.length > 0) {
    const mapping = sourceMap.mappings[candidate];
    if (mapping) {
      const source = sourceMap.sources.find(({id}) => id === mapping.source);
      if (source) return {key: candidate, path: source.path, start: mapping.start, end: mapping.end};
    }
    const separator = candidate.lastIndexOf('/');
    if (separator < 0) break;
    candidate = candidate.slice(0, separator);
  }
  return undefined;
}

export function formatSourceLocation(location: ResolvedSourceLocation): string {
  return `${location.path}:${location.start.line}:${location.start.column}`;
}

export function remapRuntimeError(
  error: unknown,
  key: string,
  sourceMap: FrameScriptSourceMap,
): FrameScriptRuntimeError {
  if (error instanceof FrameScriptRuntimeError) return error;
  const original = error instanceof Error ? error : new Error(String(error));
  const location = resolveSourceLocation(sourceMap, key);
  const suffix = location
    ? `\nFrameScript source: ${formatSourceLocation(location)} [${key}]`
    : `\nFrameScript source key: ${key}`;
  return new FrameScriptRuntimeError(`${original.message}${suffix}`, key, location, original);
}

export function sourceKey(...segments: readonly string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

function sourcePosition(position: Position): FrameScriptSourcePosition {
  return {line: position.line, column: position.column};
}

function portablePath(file: string): string {
  return file.replaceAll('\\', '/');
}
