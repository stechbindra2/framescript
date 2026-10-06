import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import type {ImportDeclaration, ImportSpecifier, Program, Span} from '../ast.js';
import {lex, type Token} from '../lexer.js';
import {parse} from '../parser.js';
import {compileProject} from '../modules.js';
import {FrameScriptError} from '../diagnostics.js';
import {
  DiagnosticSeverity,
  SymbolKind,
  type Location,
  type Diagnostic as LspDiagnostic,
  type Range,
  type SymbolInformation,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver/node';

interface IndexedDocument {
  readonly uri: string;
  readonly file?: string;
  readonly source: string;
  readonly program?: Program;
  readonly tokens: readonly Token[];
}

interface Declaration {
  readonly uri: string;
  readonly name: string;
  readonly kind: 'constant' | 'asset' | 'font' | 'composition';
  readonly range: Range;
}

interface ResolvedOccurrence {
  readonly declaration: Declaration;
  readonly range: Range;
  readonly alias?: ImportSpecifier;
}

const ignoredDirectories = new Set(['.git', '.framescript', 'coverage', 'dist', 'node_modules']);
const reservedWords = new Set(['import', 'from', 'as', 'let', 'asset', 'font', 'composition', 'animate', 'ease']);

export class ProjectIndex {
  private readonly openDocuments = new Map<string, string>();
  private documents = new Map<string, IndexedDocument>();
  private dirty = true;

  public constructor(private readonly roots: readonly string[]) {}

  public setDocument(uri: string, source: string): void {
    this.openDocuments.set(uri, source);
    this.dirty = true;
  }

  public closeDocument(uri: string): void {
    this.openDocuments.delete(uri);
    this.dirty = true;
  }

  public invalidate(): void {
    this.dirty = true;
  }

  public async definition(uri: string, offset: number): Promise<Location | null> {
    const occurrence = await this.occurrenceAt(uri, offset);
    return occurrence ? {uri: occurrence.declaration.uri, range: occurrence.declaration.range} : null;
  }

  public async prepareRename(uri: string, offset: number): Promise<Range | null> {
    const occurrence = await this.occurrenceAt(uri, offset);
    return occurrence?.range ?? null;
  }

  public async references(uri: string, offset: number, includeDeclaration: boolean): Promise<readonly Location[]> {
    const occurrence = await this.occurrenceAt(uri, offset);
    if (!occurrence) return [];
    await this.refresh();
    const locations: Location[] = [];
    for (const document of this.documents.values()) {
      for (const token of document.tokens) {
        if (token.kind !== 'identifier') continue;
        const candidate = this.resolveToken(document, token);
        if (!candidate || !sameDeclaration(candidate.declaration, occurrence.declaration)) continue;
        if (!includeDeclaration && candidate.declaration.uri === document.uri && rangesEqual(candidate.range, candidate.declaration.range)) continue;
        locations.push({uri: document.uri, range: candidate.range});
      }
    }
    return uniqueLocations(locations);
  }

  public async rename(uri: string, offset: number, newName: string): Promise<WorkspaceEdit | null> {
    if (!isIdentifier(newName) || reservedWords.has(newName)) return null;
    const occurrence = await this.occurrenceAt(uri, offset);
    if (!occurrence) return null;
    await this.refresh();
    const sourceDocument = this.documents.get(uri);
    if (!sourceDocument) return null;

    const alias = localAliasForOccurrence(sourceDocument, occurrence.range);
    if (alias && alias.local !== alias.imported && !rangesEqual(occurrence.range, spanRange(alias.importedSpan))) {
      if (hasLocalCollision(sourceDocument, newName, alias.local)) return null;
      const edits = sourceDocument.tokens
        .filter((token) => token.kind === 'identifier' && token.lexeme === alias.local)
        .map((token) => this.resolveToken(sourceDocument, token))
        .filter((item): item is ResolvedOccurrence => item !== undefined && sameDeclaration(item.declaration, occurrence.declaration))
        .filter((item) => !rangesEqual(item.range, spanRange(alias.importedSpan)))
        .map(({range}): TextEdit => ({range, newText: newName}));
      return edits.length > 0 ? {changes: {[uri]: uniqueEdits(edits)}} : null;
    }

    const changes: Record<string, TextEdit[]> = {};
    for (const document of this.documents.values()) {
      const imports = importsForTarget(document, occurrence.declaration, this.documents);
      const localNames = new Set(imports.map(({specifier}) => specifier.local));
      if (document.uri === occurrence.declaration.uri) localNames.add(occurrence.declaration.name);
      for (const oldName of localNames) {
        if (oldName !== newName && hasLocalCollision(document, newName, oldName)) return null;
      }
      for (const token of document.tokens) {
        if (token.kind !== 'identifier') continue;
        const candidate = this.resolveToken(document, token);
        if (!candidate || !sameDeclaration(candidate.declaration, occurrence.declaration)) continue;
        const matchingImport = imports.find(({specifier}) => spanContains(specifier.importedSpan, token.span));
        const isAliasedUse = candidate.alias && candidate.alias.local !== candidate.alias.imported
          && !spanContains(candidate.alias.importedSpan, token.span);
        if (!matchingImport && isAliasedUse) continue;
        (changes[document.uri] ??= []).push({range: candidate.range, newText: newName});
      }
    }
    for (const [documentUri, edits] of Object.entries(changes)) changes[documentUri] = uniqueEdits(edits);
    return Object.keys(changes).length > 0 ? {changes} : null;
  }

  public async workspaceSymbols(query: string): Promise<readonly SymbolInformation[]> {
    await this.refresh();
    const normalized = query.toLowerCase();
    const symbols: SymbolInformation[] = [];
    for (const document of this.documents.values()) {
      for (const declaration of declarations(document)) {
        if (normalized && !declaration.name.toLowerCase().includes(normalized)) continue;
        symbols.push({
          name: declaration.name,
          kind: symbolKind(declaration.kind),
          location: {uri: declaration.uri, range: declaration.range},
          containerName: document.file ? path.basename(document.file) : document.uri,
        });
      }
    }
    return symbols;
  }

  public async diagnostics(entryUri: string): Promise<ReadonlyMap<string, readonly LspDiagnostic[]>> {
    await this.refresh();
    const document = this.documents.get(entryUri);
    if (!document?.file) return new Map();
    if (document.program && document.program.compositions.length === 0) return new Map([[entryUri, []]]);
    try {
      const result = await compileProject(document.file, {
        readSource: async (file) => {
          const uri = pathToFileURL(path.resolve(file)).href;
          return this.openDocuments.get(uri) ?? readFile(file, 'utf8');
        },
      });
      return groupDiagnostics(result.warnings, document.file);
    } catch (error) {
      if (error instanceof FrameScriptError) return groupDiagnostics(error.diagnostics, document.file);
      throw error;
    }
  }

  private async occurrenceAt(uri: string, offset: number): Promise<ResolvedOccurrence | undefined> {
    await this.refresh();
    const document = this.documents.get(uri);
    if (!document) return undefined;
    const token = document.tokens.find(({span}) => offset >= span.start.offset && offset <= span.end.offset);
    return token?.kind === 'identifier' ? this.resolveToken(document, token) : undefined;
  }

  private resolveToken(document: IndexedDocument, token: Token): ResolvedOccurrence | undefined {
    if (!document.program) return undefined;
    const ownDeclarations = declarations(document);
    const own = ownDeclarations.find(({name, range}) => name === token.lexeme && rangesEqual(range, spanRange(token.span)));
    if (own) return {declaration: own, range: spanRange(token.span)};

    for (const declaration of document.program.imports) {
      const dependency = importedDocument(document, declaration, this.documents);
      if (!dependency) continue;
      for (const specifier of declaration.specifiers) {
        if (!spanContains(specifier.importedSpan, token.span) && !spanContains(specifier.localSpan, token.span)) continue;
        const target = declarations(dependency).find(({name, kind}) => name === specifier.imported && kind !== 'composition');
        if (target) return {declaration: target, range: spanRange(token.span), alias: specifier};
      }
    }
    if (isPropertyOrLayerIdentifier(token, document.tokens)) return undefined;
    const local = ownDeclarations.find(({name, kind}) => name === token.lexeme && kind !== 'composition');
    if (local) return {declaration: local, range: spanRange(token.span)};
    for (const declaration of document.program.imports) {
      const dependency = importedDocument(document, declaration, this.documents);
      if (!dependency) continue;
      const specifier = declaration.specifiers.find(({local}) => local === token.lexeme);
      if (!specifier) continue;
      const target = declarations(dependency).find(({name, kind}) => name === specifier.imported && kind !== 'composition');
      if (target) return {declaration: target, range: spanRange(token.span), alias: specifier};
    }
    return undefined;
  }

  private async refresh(): Promise<void> {
    if (!this.dirty) return;
    const uris = new Set(this.openDocuments.keys());
    for (const root of this.roots) {
      for (const file of await frameFiles(root)) uris.add(pathToFileURL(file).href);
    }
    const next = new Map<string, IndexedDocument>();
    for (const uri of uris) {
      let source = this.openDocuments.get(uri);
      const file = uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
      if (source === undefined && file) source = await readFile(file, 'utf8').catch(() => undefined);
      if (source === undefined) continue;
      let program: Program | undefined;
      let tokens: readonly Token[] = [];
      try {
        tokens = lex(source, file);
        program = parse(source, file ? {file} : {});
      } catch { /* Incomplete documents remain indexed after the next valid edit. */ }
      next.set(uri, {uri, ...(file ? {file} : {}), source, ...(program ? {program} : {}), tokens});
    }
    this.documents = next;
    this.dirty = false;
  }
}

function declarations(document: IndexedDocument): readonly Declaration[] {
  if (!document.program) return [];
  const result: Declaration[] = [];
  for (const [kind, items] of [
    ['constant', document.program.constants],
    ['asset', document.program.assets],
    ['font', document.program.fonts],
    ['composition', document.program.compositions],
  ] as const) {
    for (const item of items) {
      const token = document.tokens.find((candidate, index, tokens) => candidate.kind === 'identifier'
        && candidate.lexeme === item.name
        && tokens[index - 1]?.lexeme === (kind === 'constant' ? 'let' : kind));
      if (token) result.push({uri: document.uri, name: item.name, kind, range: spanRange(token.span)});
    }
  }
  return result;
}

function importedDocument(
  importer: IndexedDocument,
  declaration: ImportDeclaration,
  documents: ReadonlyMap<string, IndexedDocument>,
): IndexedDocument | undefined {
  if (!importer.file || (!declaration.source.startsWith('./') && !declaration.source.startsWith('../'))) return undefined;
  const target = path.resolve(path.dirname(importer.file), declaration.source);
  const file = path.extname(target) ? target : `${target}.frame`;
  return documents.get(pathToFileURL(file).href);
}

function importsForTarget(
  document: IndexedDocument,
  target: Declaration,
  documents: ReadonlyMap<string, IndexedDocument>,
): Array<{declaration: ImportDeclaration; specifier: ImportSpecifier}> {
  const matches: Array<{declaration: ImportDeclaration; specifier: ImportSpecifier}> = [];
  for (const declaration of document.program?.imports ?? []) {
    const dependency = importedDocument(document, declaration, documents);
    if (!dependency || dependency.uri !== target.uri) continue;
    for (const specifier of declaration.specifiers) {
      if (specifier.imported === target.name) matches.push({declaration, specifier});
    }
  }
  return matches;
}

function localAliasForOccurrence(document: IndexedDocument, range: Range): ImportSpecifier | undefined {
  for (const declaration of document.program?.imports ?? []) {
    for (const specifier of declaration.specifiers) {
      if (rangesEqual(spanRange(specifier.localSpan), range)) return specifier;
      if (specifier.local !== specifier.imported && wordAtRange(document.source, range) === specifier.local) return specifier;
    }
  }
  return undefined;
}

function hasLocalCollision(document: IndexedDocument, name: string, except: string): boolean {
  if (name === except) return false;
  return declarations(document).some((declaration) => declaration.name === name)
    || (document.program?.imports ?? []).some((declaration) => declaration.specifiers.some(({local}) => local === name));
}

async function frameFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, {withFileTypes: true}).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) await visit(file);
      else if (entry.isFile() && entry.name.endsWith('.frame')) files.push(file);
    }));
  };
  await visit(path.resolve(root));
  return files;
}

function isPropertyOrLayerIdentifier(token: Token, tokens: readonly Token[]): boolean {
  const index = tokens.indexOf(token);
  const next = tokens[index + 1];
  const nextNext = tokens[index + 2];
  const previous = tokens[index - 1];
  if (next?.kind === 'colon') return true;
  if (next?.kind === 'identifier' && nextNext?.kind === 'leftBrace') return true;
  return previous?.kind === 'identifier' && next?.kind === 'leftBrace'
    && !['let', 'asset', 'font', 'composition'].includes(previous.lexeme);
}

function spanRange(span: Span): Range {
  return {
    start: {line: span.start.line - 1, character: span.start.column - 1},
    end: {line: span.end.line - 1, character: span.end.column - 1},
  };
}

function spanContains(container: Span, candidate: Span): boolean {
  return candidate.start.offset >= container.start.offset && candidate.end.offset <= container.end.offset;
}

function rangesEqual(left: Range, right: Range): boolean {
  return left.start.line === right.start.line && left.start.character === right.start.character
    && left.end.line === right.end.line && left.end.character === right.end.character;
}

function sameDeclaration(left: Declaration, right: Declaration): boolean {
  return left.uri === right.uri && left.name === right.name && left.kind === right.kind;
}

function uniqueLocations(locations: readonly Location[]): Location[] {
  const seen = new Set<string>();
  return locations.filter(({uri, range}) => {
    const key = `${uri}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueEdits(edits: readonly TextEdit[]): TextEdit[] {
  const seen = new Set<string>();
  return edits.filter(({range}) => {
    const key = `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wordAtRange(source: string, range: Range): string {
  const lines = source.split('\n');
  return (lines[range.start.line] ?? '').slice(range.start.character, range.end.character);
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(value);
}

function symbolKind(kind: Declaration['kind']): SymbolKind {
  if (kind === 'constant') return SymbolKind.Constant;
  if (kind === 'asset') return SymbolKind.File;
  if (kind === 'font') return SymbolKind.Class;
  return SymbolKind.Function;
}

function groupDiagnostics(
  diagnostics: readonly import('../diagnostics.js').Diagnostic[],
  fallbackFile: string,
): ReadonlyMap<string, readonly LspDiagnostic[]> {
  const grouped = new Map<string, LspDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const file = diagnostic.file ?? diagnostic.span.sourceFile ?? fallbackFile;
    const uri = pathToFileURL(file).href;
    const item: LspDiagnostic = {
      code: diagnostic.code,
      source: 'framescript',
      message: diagnostic.hint ? `${diagnostic.message}\n${diagnostic.hint}` : diagnostic.message,
      severity: diagnostic.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      range: spanRange(diagnostic.span),
    };
    const items = grouped.get(uri) ?? [];
    items.push(item);
    grouped.set(uri, items);
  }
  return grouped;
}
