import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {
  Animation,
  AssetDeclaration,
  Composition,
  Constant,
  FontDeclaration,
  ImportDeclaration,
  Keyframe,
  Layer,
  Program,
  Property,
  Value,
} from './ast.js';
import type {CompileResult} from './compiler.js';
import {FrameScriptError, type Diagnostic} from './diagnostics.js';
import {parse} from './parser.js';
import type {FrameScriptPlugin} from './plugins.js';
import {analyze} from './semantic.js';
import {finalizeSourceMap} from './source-map.js';

export interface CompileProjectOptions {
  readonly plugins?: readonly FrameScriptPlugin[];
  readonly readSource?: (file: string) => Promise<string>;
}

export interface ProjectCompilation extends CompileResult {
  readonly entryFile: string;
  readonly projectRoot: string;
  readonly dependencyFiles: readonly string[];
  readonly sources: ReadonlyMap<string, string>;
}

interface LoadedModule {
  readonly file: string;
  readonly source: string;
  readonly program: Program;
  readonly dependencies: ReadonlyMap<ImportDeclaration, LoadedModule>;
}

export async function compileProject(
  entryFile: string,
  options: CompileProjectOptions = {},
): Promise<ProjectCompilation> {
  const entry = path.resolve(entryFile);
  const modules = new Map<string, LoadedModule>();
  const loading = new Set<string>();
  const readSource = options.readSource ?? ((file: string) => readFile(file, 'utf8'));

  const load = async (file: string, via?: ImportDeclaration): Promise<LoadedModule> => {
    const canonical = path.resolve(file);
    const cached = modules.get(canonical);
    if (cached) return cached;
    if (loading.has(canonical)) {
      throw projectError('FS4004', `Circular module import involving '${canonical}'.`, via?.sourceSpan);
    }
    loading.add(canonical);
    let source: string;
    try {
      source = await readSource(canonical);
    } catch {
      loading.delete(canonical);
      throw projectError('FS4002', `Cannot read imported module '${canonical}'.`, via?.sourceSpan);
    }
    let program: Program;
    try {
      program = parse(source, {file: canonical});
    } catch (error) {
      loading.delete(canonical);
      throw error;
    }
    const dependencies = new Map<ImportDeclaration, LoadedModule>();
    for (const declaration of program.imports) {
      const resolved = resolveModule(canonical, declaration);
      dependencies.set(declaration, await load(resolved, declaration));
    }
    const loaded: LoadedModule = {file: canonical, source, program, dependencies};
    modules.set(canonical, loaded);
    loading.delete(canonical);
    validateImports(loaded);
    return loaded;
  };

  const root = await load(entry);
  const merged = flattenModules(root, modules);
  const result = analyze(merged, options.plugins ? {plugins: options.plugins} : {});
  const sources = new Map([...modules].map(([file, module]) => [file, module.source]));
  const projectRoot = commonDirectory([...modules.keys()]);
  const sourceMap = finalizeSourceMap(result.sourceMap, {
    entryFile: entry,
    projectRoot,
    sources,
  });
  return {
    ir: result.ir,
    warnings: result.warnings,
    sourceMap,
    sourceFile: entry,
    entryFile: entry,
    projectRoot,
    dependencyFiles: [...modules.keys()].filter((file) => file !== entry),
    sources,
  };
}

function commonDirectory(files: readonly string[]): string {
  let common = path.dirname(path.resolve(files[0]!));
  for (const file of files.slice(1)) {
    const directory = path.dirname(path.resolve(file));
    while (!isInside(common, directory)) {
      const parent = path.dirname(common);
      if (parent === common) break;
      common = parent;
    }
  }
  return common;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveModule(importer: string, declaration: ImportDeclaration): string {
  const specifier = declaration.source;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    throw projectError('FS4001', `Module '${specifier}' must use a relative path.`, declaration.sourceSpan);
  }
  const resolved = path.resolve(path.dirname(importer), specifier);
  if (path.extname(resolved) && path.extname(resolved).toLowerCase() !== '.frame') {
    throw projectError('FS4001', `Module '${specifier}' must be a .frame file.`, declaration.sourceSpan);
  }
  return path.extname(resolved) ? resolved : `${resolved}.frame`;
}

function validateImports(module: LoadedModule): void {
  const localNames = new Set([
    ...module.program.constants,
    ...module.program.assets,
    ...module.program.fonts,
    ...module.program.compositions,
  ].map(({name}) => name));
  const importedLocals = new Set<string>();
  for (const [declaration, dependency] of module.dependencies) {
    const exported = new Set([
      ...dependency.program.constants,
      ...dependency.program.assets,
      ...dependency.program.fonts,
    ].map(({name}) => name));
    for (const specifier of declaration.specifiers) {
      if (!exported.has(specifier.imported)) {
        throw projectError(
          'FS4003',
          `Module '${declaration.source}' does not export '${specifier.imported}'.`,
          specifier.importedSpan,
        );
      }
      if (localNames.has(specifier.local) || importedLocals.has(specifier.local)) {
        throw projectError('FS4005', `Imported name '${specifier.local}' conflicts with another declaration.`, specifier.localSpan);
      }
      importedLocals.add(specifier.local);
    }
  }
}

function flattenModules(root: LoadedModule, modules: ReadonlyMap<string, LoadedModule>): Program {
  const constants: Constant[] = [];
  const assets: AssetDeclaration[] = [];
  const fonts: FontDeclaration[] = [];
  for (const module of modules.values()) {
    const names = moduleNames(module, root.file);
    constants.push(...module.program.constants.map((declaration) => rewriteConstant(declaration, names)));
    assets.push(...module.program.assets.map((declaration) => rewriteAsset(declaration, names)));
    fonts.push(...module.program.fonts.map((declaration) => rewriteFont(declaration, names)));
  }
  const rootNames = moduleNames(root, root.file);
  const compositions = root.program.compositions.map((composition) => rewriteComposition(composition, rootNames));
  return {
    kind: 'program',
    imports: [],
    constants,
    assets,
    fonts,
    compositions,
    span: root.program.span,
  };
}

function moduleNames(module: LoadedModule, entryFile: string): ReadonlyMap<string, string> {
  const prefix = module.file === entryFile ? '' : `__fs_${createHash('sha256').update(module.file).digest('hex').slice(0, 10)}_`;
  const names = new Map<string, string>();
  for (const declaration of [...module.program.constants, ...module.program.assets, ...module.program.fonts]) {
    names.set(declaration.name, `${prefix}${declaration.name}`);
  }
  for (const [declaration, dependency] of module.dependencies) {
    const dependencyNames = moduleNames(dependency, entryFile);
    for (const specifier of declaration.specifiers) {
      names.set(specifier.local, dependencyNames.get(specifier.imported)!);
    }
  }
  return names;
}

function rewriteConstant(declaration: Constant, names: ReadonlyMap<string, string>): Constant {
  return {...declaration, name: names.get(declaration.name)!, value: rewriteValue(declaration.value, names)};
}

function rewriteAsset(declaration: AssetDeclaration, names: ReadonlyMap<string, string>): AssetDeclaration {
  return {...declaration, name: names.get(declaration.name)!, properties: declaration.properties.map((property) => rewriteProperty(property, names))};
}

function rewriteFont(declaration: FontDeclaration, names: ReadonlyMap<string, string>): FontDeclaration {
  return {...declaration, name: names.get(declaration.name)!, properties: declaration.properties.map((property) => rewriteProperty(property, names))};
}

function rewriteComposition(composition: Composition, names: ReadonlyMap<string, string>): Composition {
  return {
    ...composition,
    properties: composition.properties.map((property) => rewriteProperty(property, names)),
    layers: composition.layers.map((layer) => rewriteLayer(layer, names)),
  };
}

function rewriteLayer(layer: Layer, names: ReadonlyMap<string, string>): Layer {
  return {
    ...layer,
    properties: layer.properties.map((property) => rewriteProperty(property, names)),
    animations: layer.animations.map((animation) => rewriteAnimation(animation, names)),
    children: layer.children.map((child) => rewriteLayer(child, names)),
  };
}

function rewriteAnimation(animation: Animation, names: ReadonlyMap<string, string>): Animation {
  return {...animation, keyframes: animation.keyframes.map((keyframe) => rewriteKeyframe(keyframe, names))};
}

function rewriteKeyframe(keyframe: Keyframe, names: ReadonlyMap<string, string>): Keyframe {
  return {...keyframe, at: rewriteValue(keyframe.at, names), value: rewriteValue(keyframe.value, names)};
}

function rewriteProperty(property: Property, names: ReadonlyMap<string, string>): Property {
  return {...property, value: rewriteValue(property.value, names)};
}

function rewriteValue(value: Value, names: ReadonlyMap<string, string>): Value {
  switch (value.kind) {
    case 'reference': return {...value, name: names.get(value.name) ?? value.name};
    case 'array': return {...value, items: value.items.map((item) => rewriteValue(item, names))};
    case 'unary': return {...value, operand: rewriteValue(value.operand, names)};
    default: return value;
  }
}

function projectError(code: string, message: string, span?: import('./ast.js').Span): FrameScriptError {
  const fallback: import('./ast.js').Span = {start: {offset: 0, line: 1, column: 1}, end: {offset: 0, line: 1, column: 1}};
  const location = span ?? fallback;
  const diagnostic: Diagnostic = {
    code,
    message,
    severity: 'error',
    span: location,
    ...(location.sourceFile ? {file: location.sourceFile} : {}),
  };
  return new FrameScriptError('Module resolution failed', [diagnostic]);
}
