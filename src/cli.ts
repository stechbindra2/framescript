#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import {FrameScriptError, formatDiagnostic} from './diagnostics.js';
import {format} from './formatter.js';
import {parse} from './parser.js';
import type {FrameScriptPlugin} from './plugins.js';
import {buildProject} from './project-builder.js';
import {compileProject, type ProjectCompilation} from './modules.js';
import {watchProject} from './watch.js';
import {probeMediaAssets, validateMedia} from './media.js';

interface Arguments {
  readonly command: string;
  readonly file?: string;
  readonly output?: string;
  readonly write: boolean;
  readonly pluginSpecifiers: readonly string[];
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.command === 'help') {
    process.stdout.write(help());
    return;
  }
  if (!args.file) throw new Error(`Command '${args.command}' requires a .frame file.`);
  const file = path.resolve(args.file);
  const source = await readFile(file, 'utf8');
  const plugins = await loadPlugins(args.pluginSpecifiers);

  switch (args.command) {
    case 'check': {
      const result = await compileProject(file, {plugins});
      await printWarnings(result);
      process.stdout.write(`OK ${file} (${result.ir.compositions.length} composition(s))\n`);
      break;
    }
    case 'inspect': {
      const result = await compileProject(file, {plugins});
      await printWarnings(result);
      process.stdout.write(`${JSON.stringify(result.ir, null, 2)}\n`);
      break;
    }
    case 'map': {
      const result = await compileProject(file, {plugins});
      await printWarnings(result);
      process.stdout.write(`${JSON.stringify(result.sourceMap, null, 2)}\n`);
      break;
    }
    case 'probe': {
      const result = await compileProject(file, {plugins});
      const probed = await probeMediaAssets(result.ir, {
        projectRoot: result.projectRoot,
        cacheDirectory: path.join(result.projectRoot, '.framescript', 'cache', 'media'),
        strict: true,
      });
      const validation = validateMedia(probed.ir, result.sourceMap, result.projectRoot);
      if (validation.some(({severity}) => severity === 'error')) {
        throw new FrameScriptError('Media validation failed', validation);
      }
      await printDiagnosticList(result, validation);
      process.stdout.write(`${JSON.stringify(probed.report, null, 2)}\n`);
      break;
    }
    case 'fmt': {
      const formatted = format(parse(source));
      if (args.write) {
        await writeFile(file, formatted, 'utf8');
        process.stdout.write(`Formatted ${file}\n`);
      } else {
        process.stdout.write(formatted);
      }
      break;
    }
    case 'build': {
      const output = args.output ?? path.join(path.dirname(file), '.framescript', path.basename(file, path.extname(file)));
      const built = await buildProject({sourceFile: file, outputDirectory: output, plugins});
      await printWarnings(built.compilation);
      await printDiagnosticList(built.compilation, built.mediaWarnings);
      for (const warning of built.media.warnings) process.stderr.write(`${warning.code}: ${warning.message}\n`);
      process.stdout.write(`Generated Remotion project at ${built.generated.directory}\n`);
      if (built.copiedAssets.length > 0) {
        process.stdout.write(`Materialized ${built.copiedAssets.length} content-addressed asset(s)\n`);
      }
      process.stdout.write(`Next: cd "${built.generated.directory}"; npm install; npm run studio\n`);
      break;
    }
    case 'watch': {
      const output = args.output ?? path.join(path.dirname(file), '.framescript', path.basename(file, path.extname(file)));
      const controller = watchProject({
        sourceFile: file,
        outputDirectory: output,
        plugins,
        onEvent: (event) => {
          if (event.type === 'building') process.stdout.write(`[watch] building (${event.reason})\n`);
          else if (event.type === 'success') {
            void printWarnings(event.result.compilation);
            void printDiagnosticList(event.result.compilation, event.result.mediaWarnings);
            for (const warning of event.result.media.warnings) process.stderr.write(`${warning.code}: ${warning.message}\n`);
            process.stdout.write(`[watch] ready ${event.result.generated.directory}\n`);
          } else {
            printWatchError(file, event.error);
          }
        },
      });
      await controller.initialBuild;
      process.stdout.write('[watch] watching source and assets; press Ctrl+C to stop\n');
      await new Promise<void>((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      controller.close();
      break;
    }
    default: throw new Error(`Unknown command '${args.command}'.\n\n${help()}`);
  }
}

function parseArguments(argv: readonly string[]): Arguments {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return {command: 'help', write: false, pluginSpecifiers: []};
  }
  const command = argv[0]!;
  let file: string | undefined;
  let output: string | undefined;
  let write = false;
  const pluginSpecifiers: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === '--out' || value === '-o') {
      output = argv[index + 1];
      index += 1;
    } else if (value === '--plugin') {
      const plugin = argv[index + 1];
      if (!plugin) throw new Error("Expected a module after '--plugin'.");
      pluginSpecifiers.push(plugin);
      index += 1;
    } else if (value === '--write' || value === '-w') {
      write = true;
    } else if (!file) {
      file = value;
    } else {
      throw new Error(`Unexpected argument '${value}'.`);
    }
  }
  return {command, ...(file ? {file} : {}), ...(output ? {output} : {}), write, pluginSpecifiers};
}

async function loadPlugins(specifiers: readonly string[]): Promise<readonly FrameScriptPlugin[]> {
  return Promise.all(specifiers.map(async (specifier) => {
    const isPath = specifier.startsWith('.') || path.isAbsolute(specifier);
    const module = await import(isPath ? pathToFileURL(path.resolve(specifier)).href : specifier) as {
      readonly default?: FrameScriptPlugin;
      readonly plugin?: FrameScriptPlugin;
    };
    const plugin = module.default ?? module.plugin;
    if (!plugin) throw new Error(`Plugin module '${specifier}' must export default or 'plugin'.`);
    return plugin;
  }));
}

async function printWarnings(compilation: ProjectCompilation): Promise<void> {
  await printDiagnosticList(compilation, compilation.warnings);
}

async function printDiagnosticList(
  compilation: ProjectCompilation,
  diagnostics: readonly import('./diagnostics.js').Diagnostic[],
): Promise<void> {
  for (const warning of diagnostics) {
    const file = warning.file ?? warning.span.sourceFile ?? compilation.entryFile;
    const source = compilation.sources.get(file) ?? await readFile(file, 'utf8').catch(() => '');
    process.stderr.write(`${formatDiagnostic(file, source, warning)}\n`);
  }
}

function printWatchError(file: string, error: unknown): void {
  if (error instanceof FrameScriptError) {
    void Promise.all(error.diagnostics.map(async (diagnostic) => {
      const diagnosticFile = diagnostic.file ?? diagnostic.span.sourceFile ?? file;
      const source = await readFile(diagnosticFile, 'utf8').catch(() => '');
      process.stderr.write(`${formatDiagnostic(diagnosticFile, source, diagnostic)}\n`);
    }));
  } else {
    process.stderr.write(`[watch] ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

function help(): string {
  return `FrameScript compiler

Usage:
  framec check <file.frame> [--plugin module]
  framec inspect <file.frame> [--plugin module]
  framec map <file.frame> [--plugin module]
  framec probe <file.frame> [--plugin module]
  framec fmt <file.frame> [--write]
  framec build <file.frame> [--out directory] [--plugin module]
  framec watch <file.frame> [--out directory] [--plugin module]
`;
}

main().catch(async (error: unknown) => {
  if (error instanceof FrameScriptError) {
    const file = process.argv[3] ? path.resolve(process.argv[3]) : '<input>';
    let source = '';
    try { source = await readFile(file, 'utf8'); } catch { /* best effort */ }
    for (const diagnostic of error.diagnostics) {
      const diagnosticFile = diagnostic.file ?? diagnostic.span.sourceFile ?? file;
      const diagnosticSource = diagnosticFile === file ? source : await readFile(diagnosticFile, 'utf8').catch(() => '');
      process.stderr.write(`${formatDiagnostic(diagnosticFile, diagnosticSource, diagnostic)}\n`);
    }
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
