import type {Position, Span} from './ast.js';

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly span: Span;
  readonly file?: string;
  readonly hint?: string;
}

export class FrameScriptError extends Error {
  public constructor(
    message: string,
    public readonly diagnostics: readonly Diagnostic[],
  ) {
    super(message);
    this.name = 'FrameScriptError';
  }
}

export const zeroPosition = (): Position => ({offset: 0, line: 1, column: 1});

export const zeroSpan = (): Span => ({start: zeroPosition(), end: zeroPosition()});

export function formatDiagnostic(file: string, source: string, diagnostic: Diagnostic): string {
  const {line, column} = diagnostic.span.start;
  const sourceLine = source.split(/\r?\n/u)[line - 1] ?? '';
  const width = Math.max(1, diagnostic.span.end.line === line
    ? diagnostic.span.end.column - column
    : 1);
  const pointer = `${' '.repeat(Math.max(0, column - 1))}${'^'.repeat(width)}`;
  const hint = diagnostic.hint ? `\n  hint: ${diagnostic.hint}` : '';
  return `${file}:${line}:${column} ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}\n${sourceLine}\n${pointer}${hint}`;
}
