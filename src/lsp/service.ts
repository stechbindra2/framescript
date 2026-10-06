import type {Composition, Layer, Span} from '../ast.js';
import {compile} from '../compiler.js';
import {FrameScriptError} from '../diagnostics.js';
import {format} from '../formatter.js';
import {
  ANIMATABLE_PROPERTIES,
  COMPOSITION_PROPERTIES,
  EASING_NAMES,
  LAYER_ITEMS,
  LAYER_PROPERTIES,
  PROPERTY_BY_NAME,
  type LanguageItem,
} from '../language-data.js';
import {parse} from '../parser.js';
import {
  CompletionItemKind,
  CodeActionKind,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  SemanticTokensBuilder,
  SymbolKind,
  type CompletionItem,
  type CodeAction,
  type Diagnostic,
  type DocumentSymbol,
  type Hover,
  type Location,
  type Position,
  type Range,
  type SemanticTokens,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver/node';
import {lex, type Token} from '../lexer.js';
import {sourceKey} from '../source-map.js';

export const SEMANTIC_TOKEN_TYPES = [
  'keyword', 'class', 'function', 'property', 'variable', 'number', 'string', 'enumMember',
] as const;
export const SEMANTIC_TOKEN_MODIFIERS = ['declaration', 'readonly'] as const;

export function diagnostics(source: string): readonly Diagnostic[] {
  try {
    const program = parse(source);
    if (program.imports.length > 0) return [];
    const result = compile(source);
    return result.warnings.map(toDiagnostic);
  } catch (error) {
    if (error instanceof FrameScriptError) return error.diagnostics.map(toDiagnostic);
    throw error;
  }
}

export function completions(source: string, offset: number): readonly CompletionItem[] {
  const prefix = source.slice(0, offset);
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (/\banimate\s+[A-Za-z0-9_-]*$/u.test(line)) {
    return ANIMATABLE_PROPERTIES.map((name) => completion(name, 'animatable property', CompletionItemKind.Property));
  }
  if (/\bease\s+[A-Za-z0-9_-]*$/u.test(line)) {
    return EASING_NAMES.map((name) => completion(name, 'easing function', CompletionItemKind.Function));
  }

  const context = blockContext(prefix);
  if (context === 'root') {
    return [
      snippet('composition', 'Composition declaration', 'composition ${1:Name} {\n  width: 1920;\n  height: 1080;\n  fps: 30;\n  duration: 5s;\n  $0\n}'),
      snippet('import', 'Named module import', 'import { ${1:name} } from "${2:./module.frame}";'),
      snippet('let', 'Constant declaration', 'let ${1:name} = ${2:value};'),
      snippet('asset', 'Asset declaration', 'asset ${1:name} {\n  src: "${2:assets/file.png}";\n  type: "${3:image}";\n}'),
      snippet('font', 'Font declaration', 'font ${1:name} {\n  src: "${2:assets/font.woff2}";\n  family: "${3:Font Family}";\n  weight: ${4:400};\n}'),
    ];
  }
  if (context === 'resource') {
    return ['src', 'type', 'probe', 'loudness', 'family', 'weight', 'style'].map((name) =>
      completion(name, 'resource property', CompletionItemKind.Property),
    );
  }
  if (context === 'animation') {
    return [snippet('keyframe', 'Keyframe', '${1:0s}: ${2:0} ease ${3:out-cubic};')];
  }
  if (context === 'composition') {
    return [
      ...COMPOSITION_PROPERTIES.map(propertyCompletion),
      ...LAYER_ITEMS.map(layerCompletion),
    ];
  }
  return [
    ...LAYER_PROPERTIES.map(propertyCompletion),
    ...LAYER_ITEMS.map(layerCompletion),
    snippet('animate', 'Animation track', 'animate ${1:opacity} {\n  ${2:0s}: ${3:0};\n  ${4:1s}: ${5:1} ease ${6:out-cubic};\n}'),
  ];
}

export function hover(source: string, offset: number): Hover | null {
  const word = wordAt(source, offset);
  if (!word) return null;
  const mappingKey = irSourceKeyAt(source, offset);
  const mappingDetail = mappingKey ? `\n\nIR source key: \`${mappingKey}\`` : '';
  const property = PROPERTY_BY_NAME.get(word.text);
  if (property) return markdown(`**${property.name}** · \`${property.detail}\`\n\n${property.documentation}${mappingDetail}`, word.range);
  const layer = LAYER_ITEMS.find(({name}) => name === word.text);
  if (layer) return markdown(`**${layer.name} layer**\n\n${layer.documentation}${mappingDetail}`, word.range);
  if ((EASING_NAMES as readonly string[]).includes(word.text)) {
    return markdown(`**${word.text}**\n\nFrameScript easing function.`, word.range);
  }
  try {
    const program = parse(source);
    const constant = program.constants.find(({name}) => name === word.text);
    if (constant) return markdown(`**${constant.name}**\n\nFrameScript constant.${mappingDetail}`, word.range);
    const asset = program.assets.find(({name}) => name === word.text);
    if (asset) return markdown(`**${asset.name}**\n\nDeclared FrameScript asset.${mappingDetail}`, word.range);
    const font = program.fonts.find(({name}) => name === word.text);
    if (font) return markdown(`**${font.name}**\n\nDeclared FrameScript font.${mappingDetail}`, word.range);
  } catch { /* Incomplete documents still get keyword/property hover. */ }
  if (mappingKey) return markdown(`IR source key: \`${mappingKey}\``, word.range);
  return null;
}

export function irSourceKeyAt(source: string, offset: number): string | undefined {
  try {
    const program = parse(source);
    for (const asset of program.assets) {
      if (containsOffset(asset.span, offset)) return sourceKey('asset', asset.name);
    }
    for (const font of program.fonts) {
      if (containsOffset(font.span, offset)) return sourceKey('font', font.name);
    }
    for (const composition of program.compositions) {
      if (!containsOffset(composition.span, offset)) continue;
      const compositionKey = sourceKey('composition', composition.name);
      const property = composition.properties.find(({span}) => containsOffset(span, offset));
      if (property) return `${compositionKey}/${sourceKey('property', property.name)}`;
      for (const layer of composition.layers) {
        const match = layerSourceKeyAt(layer, compositionKey, offset);
        if (match) return match;
      }
      return compositionKey;
    }
  } catch { /* Incomplete documents have no stable semantic key yet. */ }
  return undefined;
}

export function definition(source: string, uri: string, offset: number): Location | null {
  const word = wordAt(source, offset);
  if (!word) return null;
  try {
    const program = parse(source);
    const declaration = [
      ...program.constants,
      ...program.assets,
      ...program.fonts,
    ].find(({name}) => name === word.text);
    return declaration ? {uri, range: spanRange(declaration.span)} : null;
  } catch {
    return null;
  }
}

export function documentSymbols(source: string): readonly DocumentSymbol[] {
  try {
    const program = parse(source);
    return [
      ...program.constants.map((constant): DocumentSymbol => ({
        name: constant.name,
        kind: SymbolKind.Constant,
        range: spanRange(constant.span),
        selectionRange: spanRange(constant.span),
      })),
      ...program.assets.map((asset): DocumentSymbol => ({
        name: asset.name,
        detail: 'asset',
        kind: SymbolKind.File,
        range: spanRange(asset.span),
        selectionRange: spanRange(asset.span),
      })),
      ...program.fonts.map((font): DocumentSymbol => ({
        name: font.name,
        detail: 'font',
        kind: SymbolKind.Class,
        range: spanRange(font.span),
        selectionRange: spanRange(font.span),
      })),
      ...program.compositions.map(compositionSymbol),
    ];
  } catch {
    return fallbackSymbols(source);
  }
}

export function formattingEdit(source: string): TextEdit | null {
  try {
    const formatted = format(parse(source));
    if (formatted === source) return null;
    return {range: fullRange(source), newText: formatted};
  } catch {
    return null;
  }
}

export function semanticTokens(source: string): SemanticTokens {
  const builder = new SemanticTokensBuilder();
  let tokens: readonly Token[];
  try { tokens = lex(source); } catch { return builder.build(); }
  const keywords = new Set(['import', 'from', 'as', 'let', 'asset', 'font', 'composition', 'animate', 'ease', 'true', 'false']);
  const declarationWords = new Set(['let', 'asset', 'font', 'composition']);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'eof') continue;
    let type: (typeof SEMANTIC_TOKEN_TYPES)[number] | undefined;
    let modifiers = 0;
    if (token.kind === 'number') type = 'number';
    else if (token.kind === 'string') type = 'string';
    else if (token.kind === 'identifier') {
      const previous = tokens[index - 1];
      const next = tokens[index + 1];
      const nextNext = tokens[index + 2];
      if (keywords.has(token.lexeme)) type = 'keyword';
      else if (previous?.kind === 'identifier' && declarationWords.has(previous.lexeme)) {
        type = previous.lexeme === 'composition' ? 'function' : previous.lexeme === 'font' ? 'class' : 'variable';
        modifiers = modifierBits('declaration', previous.lexeme === 'let' ? 'readonly' : undefined);
      } else if (next?.kind === 'identifier' && nextNext?.kind === 'leftBrace') {
        type = 'class';
      } else if (previous?.kind === 'identifier' && tokens[index + 1]?.kind === 'leftBrace') {
        type = 'variable';
        modifiers = modifierBits('declaration');
      } else if (next?.kind === 'colon') type = 'property';
      else if (previous?.lexeme === 'ease') type = 'function';
      else if (previous?.kind === 'number' && previous.span.end.offset === token.span.start.offset) type = 'enumMember';
      else type = 'variable';
    }
    if (type) {
      builder.push(
        token.span.start.line - 1,
        token.span.start.column - 1,
        Math.max(1, token.span.end.offset - token.span.start.offset),
        SEMANTIC_TOKEN_TYPES.indexOf(type),
        modifiers,
      );
    }
  }
  return builder.build();
}

export function references(source: string, uri: string, offset: number, includeDeclaration: boolean): readonly Location[] {
  const target = wordAt(source, offset);
  if (!target) return [];
  const declarations = globalDeclarations(source);
  if (!declarations.has(target.text)) return [];
  try {
    return lex(source)
      .filter((token, index, tokens) => token.kind === 'identifier'
        && token.lexeme === target.text
        && !isPropertyOrLayerIdentifier(index, tokens)
        && (includeDeclaration || !isGlobalDeclaration(index, tokens)))
      .map((token) => ({uri, range: spanRange(token.span)}));
  } catch {
    return [];
  }
}

export function prepareRename(source: string, offset: number): Range | null {
  const target = wordAt(source, offset);
  return target && globalDeclarations(source).has(target.text) ? target.range : null;
}

export function rename(source: string, uri: string, offset: number, newName: string): WorkspaceEdit | null {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(newName) || ['let', 'asset', 'font', 'composition', 'animate', 'ease'].includes(newName)) {
    return null;
  }
  const locations = references(source, uri, offset, true);
  return locations.length > 0
    ? {changes: {[uri]: locations.map(({range}) => ({range, newText: newName}))}}
    : null;
}

export function codeActions(source: string, uri: string, items: readonly Diagnostic[]): readonly CodeAction[] {
  const defaults: Readonly<Record<string, string>> = {
    width: '1920', height: '1080', fps: '30', duration: '5s',
  };
  const actions: CodeAction[] = [];
  for (const diagnostic of items) {
    if (diagnostic.code !== 'FS3101' && diagnostic.code !== 'FS3103') continue;
    const message = typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value;
    const match = /no '([^']+)'/u.exec(message);
    const property = match?.[1];
    if (!property || !defaults[property]) continue;
    const start = positionOffset(source, diagnostic.range.start);
    const brace = source.indexOf('{', start);
    if (brace < 0) continue;
    const edit: TextEdit = {
      range: offsetRange(source, brace + 1, brace + 1),
      newText: `\n  ${property}: ${defaults[property]};`,
    };
    actions.push({
      title: `Add ${property}: ${defaults[property]}`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      isPreferred: true,
      edit: {changes: {[uri]: [edit]}},
    });
  }
  return actions;
}

function compositionSymbol(composition: Composition): DocumentSymbol {
  return {
    name: composition.name,
    detail: 'composition',
    kind: SymbolKind.Function,
    range: spanRange(composition.span),
    selectionRange: spanRange(composition.span),
    children: composition.layers.map(layerSymbol),
  };
}

function layerSymbol(layer: Layer): DocumentSymbol {
  return {
    name: layer.name,
    detail: layer.layerType,
    kind: layer.layerType === 'audio' ? SymbolKind.Event : SymbolKind.Object,
    range: spanRange(layer.span),
    selectionRange: spanRange(layer.span),
    children: layer.children.map(layerSymbol),
  };
}

function layerSourceKeyAt(layer: Layer, parentKey: string, offset: number): string | undefined {
  if (!containsOffset(layer.span, offset)) return undefined;
  const key = `${parentKey}/${sourceKey('layer', layer.name)}`;
  const property = layer.properties.find(({span}) => containsOffset(span, offset));
  if (property) return `${key}/${sourceKey('property', property.name)}`;
  for (const animation of layer.animations) {
    if (!containsOffset(animation.span, offset)) continue;
    const animationKey = `${key}/${sourceKey('animation', animation.property)}`;
    const index = animation.keyframes.findIndex(({span}) => containsOffset(span, offset));
    return index >= 0 ? `${animationKey}/${sourceKey('keyframe', String(index))}` : animationKey;
  }
  for (const child of layer.children) {
    const match = layerSourceKeyAt(child, key, offset);
    if (match) return match;
  }
  return key;
}

function containsOffset(span: Span, offset: number): boolean {
  return offset >= span.start.offset && offset <= span.end.offset;
}

function fallbackSymbols(source: string): readonly DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  const pattern = /^\s*(?:composition|(?:group|rect|circle|text|image|video|audio))\s+([A-Za-z_][A-Za-z0-9_-]*)/gmu;
  for (const match of source.matchAll(pattern)) {
    const startOffset = (match.index ?? 0) + match[0].lastIndexOf(match[1]!);
    const range = offsetRange(source, startOffset, startOffset + match[1]!.length);
    symbols.push({name: match[1]!, kind: SymbolKind.Object, range, selectionRange: range});
  }
  return symbols;
}

function blockContext(prefix: string): 'root' | 'resource' | 'composition' | 'layer' | 'animation' {
  const clean = prefix
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, '""');
  const stack: Array<'resource' | 'composition' | 'layer' | 'animation'> = [];
  const tokenPattern = /\b(asset|font|composition|group|rect|circle|text|image|video|audio|animate)\b[^{}]*|[{}]/gu;
  let pending: 'resource' | 'composition' | 'layer' | 'animation' | undefined;
  for (const match of clean.matchAll(tokenPattern)) {
    const token = match[0];
    if (token === '{') {
      if (pending) stack.push(pending);
      pending = undefined;
    } else if (token === '}') {
      stack.pop();
      pending = undefined;
    } else if (token.trimStart().startsWith('composition')) pending = 'composition';
    else if (token.trimStart().startsWith('asset') || token.trimStart().startsWith('font')) pending = 'resource';
    else if (token.trimStart().startsWith('animate')) pending = 'animation';
    else pending = 'layer';
  }
  return stack.at(-1) ?? 'root';
}

function propertyCompletion(item: LanguageItem): CompletionItem {
  return {
    label: item.name,
    kind: CompletionItemKind.Property,
    detail: item.detail,
    documentation: item.documentation,
    insertText: item.insertText ?? `${item.name}: $0;`,
    insertTextFormat: InsertTextFormat.Snippet,
  };
}

function layerCompletion(item: LanguageItem): CompletionItem {
  return {
    label: item.name,
    kind: CompletionItemKind.Class,
    detail: item.detail,
    documentation: item.documentation,
    insertText: `${item.name} \${1:name} {\n  $0\n}`,
    insertTextFormat: InsertTextFormat.Snippet,
  };
}

function completion(label: string, detail: string, kind: CompletionItemKind): CompletionItem {
  return {label, detail, kind};
}

function snippet(label: string, detail: string, insertText: string): CompletionItem {
  return {label, detail, insertText, kind: CompletionItemKind.Snippet, insertTextFormat: InsertTextFormat.Snippet};
}

function markdown(value: string, range: Range): Hover {
  return {contents: {kind: MarkupKind.Markdown, value}, range};
}

function toDiagnostic(diagnostic: import('../diagnostics.js').Diagnostic): Diagnostic {
  return {
    code: diagnostic.code,
    source: 'framescript',
    message: diagnostic.hint ? `${diagnostic.message}\n${diagnostic.hint}` : diagnostic.message,
    severity: diagnostic.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    range: spanRange(diagnostic.span),
  };
}

function spanRange(span: Span): Range {
  return {
    start: {line: span.start.line - 1, character: span.start.column - 1},
    end: {line: span.end.line - 1, character: span.end.column - 1},
  };
}

function wordAt(source: string, offset: number): {text: string; range: Range} | null {
  let start = Math.min(Math.max(0, offset), source.length);
  let end = start;
  while (start > 0 && /[A-Za-z0-9_-]/u.test(source[start - 1]!)) start -= 1;
  while (end < source.length && /[A-Za-z0-9_-]/u.test(source[end]!)) end += 1;
  return end > start ? {text: source.slice(start, end), range: offsetRange(source, start, end)} : null;
}

function offsetRange(source: string, start: number, end: number): Range {
  return {start: offsetPosition(source, start), end: offsetPosition(source, end)};
}

function offsetPosition(source: string, offset: number): Position {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return {line: lines.length - 1, character: lines.at(-1)?.length ?? 0};
}

function fullRange(source: string): Range {
  return {start: {line: 0, character: 0}, end: offsetPosition(source, source.length)};
}

function globalDeclarations(source: string): ReadonlySet<string> {
  try {
    const program = parse(source);
    return new Set([
      ...program.constants.map(({name}) => name),
      ...program.assets.map(({name}) => name),
      ...program.fonts.map(({name}) => name),
      ...program.imports.flatMap(({specifiers}) => specifiers.map(({local}) => local)),
    ]);
  } catch {
    return new Set();
  }
}

function isGlobalDeclaration(index: number, tokens: readonly Token[]): boolean {
  return ['let', 'asset', 'font'].includes(tokens[index - 1]?.lexeme ?? '');
}

function isPropertyOrLayerIdentifier(index: number, tokens: readonly Token[]): boolean {
  const next = tokens[index + 1];
  const nextNext = tokens[index + 2];
  const previous = tokens[index - 1];
  if (next?.kind === 'colon') return true;
  if (next?.kind === 'identifier' && nextNext?.kind === 'leftBrace') return true;
  return previous?.kind === 'identifier' && next?.kind === 'leftBrace' && !isGlobalDeclaration(index, tokens);
}

function modifierBits(...names: Array<(typeof SEMANTIC_TOKEN_MODIFIERS)[number] | undefined>): number {
  return names.reduce<number>((bits, name) => name === undefined ? bits : bits | (1 << SEMANTIC_TOKEN_MODIFIERS.indexOf(name)), 0);
}

function positionOffset(source: string, position: Position): number {
  const lines = source.split('\n');
  let offset = 0;
  for (let line = 0; line < position.line; line += 1) offset += (lines[line]?.length ?? 0) + 1;
  return offset + position.character;
}
