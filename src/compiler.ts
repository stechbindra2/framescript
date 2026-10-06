import {parse} from './parser.js';
import {analyze} from './semantic.js';
import type {FrameScriptPlugin} from './plugins.js';
import {FrameScriptError} from './diagnostics.js';
import {finalizeSourceMap, type FrameScriptSourceMap} from './source-map.js';
import path from 'node:path';
import type {TimelineIR} from './ir.js';
import type {Diagnostic} from './diagnostics.js';

export interface CompileOptions {
  readonly file?: string;
  readonly plugins?: readonly FrameScriptPlugin[];
}

export interface CompileResult {
  readonly ir: TimelineIR;
  readonly warnings: readonly Diagnostic[];
  readonly sourceMap: FrameScriptSourceMap;
  readonly sourceFile: string;
}

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const sourceFile = options.file ?? '<memory>';
  const program = parse(source, {file: sourceFile});
  if (program.imports.length > 0) {
    const declaration = program.imports[0]!;
    throw new FrameScriptError('Project compilation required', [{
      code: 'FS4000',
      message: 'Imports require the project compiler. Use framec with a source file.',
      severity: 'error',
      span: declaration.span,
      ...(declaration.span.sourceFile ? {file: declaration.span.sourceFile} : {}),
    }]);
  }
  const result = analyze(program, options.plugins ? {plugins: options.plugins} : {});
  const projectRoot = options.file ? path.dirname(path.resolve(options.file)) : process.cwd();
  const sourceMap = finalizeSourceMap(result.sourceMap, {
    entryFile: sourceFile,
    projectRoot,
    sources: new Map([[sourceFile, source]]),
  });
  return {ir: result.ir, warnings: result.warnings, sourceMap, sourceFile};
}
