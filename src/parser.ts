import {
  type Animation,
  type AssetDeclaration,
  type Composition,
  type Constant,
  type FontDeclaration,
  type ImportDeclaration,
  type Keyframe,
  type Layer,
  type LayerType,
  type Program,
  type Property,
  type Span,
  type Value,
} from './ast.js';
import {FrameScriptError, type Diagnostic} from './diagnostics.js';
import {lex, type Token, type TokenKind} from './lexer.js';

export interface ParseOptions {
  readonly file?: string;
}

export function parse(source: string, options: ParseOptions = {}): Program {
  return new Parser(lex(source, options.file)).parseProgram();
}

class Parser {
  private current = 0;
  private readonly diagnostics: Diagnostic[] = [];

  public constructor(private readonly tokens: readonly Token[]) {}

  public parseProgram(): Program {
    const start = this.peek().span.start;
    const imports: ImportDeclaration[] = [];
    const constants: Constant[] = [];
    const assets: AssetDeclaration[] = [];
    const fonts: FontDeclaration[] = [];
    const compositions: Composition[] = [];

    while (!this.check('eof')) {
      if (this.checkWord('import')) imports.push(this.parseImport());
      else if (this.checkWord('let')) constants.push(this.parseConstant());
      else if (this.checkWord('asset')) assets.push(this.parseResource('asset'));
      else if (this.checkWord('font')) fonts.push(this.parseResource('font'));
      else if (this.checkWord('composition')) compositions.push(this.parseComposition());
      else {
        this.report(this.peek(), 'FS2001', "Expected 'import', 'let', 'asset', 'font', or 'composition'.");
        this.synchronizeTopLevel();
      }
    }

    if (this.diagnostics.length > 0) {
      throw new FrameScriptError('Parsing failed', this.diagnostics);
    }
    return {
      kind: 'program',
      imports,
      constants,
      assets,
      fonts,
      compositions,
      span: {start, end: this.peek().span.end, ...(this.peek().span.sourceFile ? {sourceFile: this.peek().span.sourceFile} : {})},
    };
  }

  private parseImport(): ImportDeclaration {
    const keyword = this.consumeWord('import');
    this.consume('leftBrace', "Expected '{' after 'import'.");
    const specifiers: ImportDeclaration['specifiers'][number][] = [];
    while (!this.check('rightBrace') && !this.check('eof')) {
      const imported = this.consume('identifier', 'Expected an imported name.');
      let local = imported;
      if (this.checkWord('as')) {
        this.advance();
        local = this.consume('identifier', "Expected a local name after 'as'.");
      }
      specifiers.push({
        kind: 'importSpecifier',
        imported: imported.lexeme,
        importedSpan: imported.span,
        local: local.lexeme,
        localSpan: local.span,
        span: this.join(imported.span, local.span),
      });
      if (!this.match('comma')) break;
    }
    this.consume('rightBrace', "Expected '}' after imported names.");
    this.consumeWord('from');
    const source = this.consume('string', 'Expected a module path string.');
    const end = this.optionalSemicolon();
    return {
      kind: 'import',
      specifiers,
      source: String(source.value ?? ''),
      sourceSpan: source.span,
      span: {start: keyword.span.start, end, ...(keyword.span.sourceFile ? {sourceFile: keyword.span.sourceFile} : {})},
    };
  }

  private parseResource(kind: 'asset'): AssetDeclaration;
  private parseResource(kind: 'font'): FontDeclaration;
  private parseResource(kind: 'asset' | 'font'): AssetDeclaration | FontDeclaration {
    const start = this.consumeWord(kind).span.start;
    const name = this.consume('identifier', `Expected a ${kind} name.`);
    this.consume('leftBrace', `Expected '{' after the ${kind} name.`);
    const properties: Property[] = [];
    while (!this.check('rightBrace') && !this.check('eof')) properties.push(this.parseProperty());
    const end = this.consume('rightBrace', `Expected '}' after the ${kind} declaration.`).span.end;
    return {kind, name: name.lexeme, properties, span: {start, end, ...(name.span.sourceFile ? {sourceFile: name.span.sourceFile} : {})}};
  }

  private parseConstant(): Constant {
    const start = this.consumeWord('let').span.start;
    const name = this.consume('identifier', 'Expected a constant name.');
    this.consume('equals', "Expected '=' after the constant name.");
    const value = this.parseValue();
    const end = this.optionalSemicolon();
    return {kind: 'constant', name: name.lexeme, value, span: {start, end, ...(name.span.sourceFile ? {sourceFile: name.span.sourceFile} : {})}};
  }

  private parseComposition(): Composition {
    const start = this.consumeWord('composition').span.start;
    const name = this.consume('identifier', 'Expected a composition name.');
    this.consume('leftBrace', "Expected '{' after the composition name.");
    const properties: Property[] = [];
    const layers: Layer[] = [];
    while (!this.check('rightBrace') && !this.check('eof')) {
      if (this.isLayerStart()) layers.push(this.parseLayer());
      else properties.push(this.parseProperty());
    }
    const end = this.consume('rightBrace', "Expected '}' after the composition.").span.end;
    return {kind: 'composition', name: name.lexeme, properties, layers, span: {start, end, ...(name.span.sourceFile ? {sourceFile: name.span.sourceFile} : {})}};
  }

  private parseLayer(): Layer {
    const type = this.advance();
    const start = type.span.start;
    const name = this.consume('identifier', `Expected a name after '${type.lexeme}'.`);
    this.consume('leftBrace', "Expected '{' after the layer name.");
    const properties: Property[] = [];
    const animations: Animation[] = [];
    const children: Layer[] = [];
    while (!this.check('rightBrace') && !this.check('eof')) {
      if (this.checkWord('animate')) animations.push(this.parseAnimation());
      else if (this.isLayerStart()) children.push(this.parseLayer());
      else properties.push(this.parseProperty());
    }
    const end = this.consume('rightBrace', "Expected '}' after the layer.").span.end;
    return {
      kind: 'layer',
      layerType: type.lexeme as LayerType,
      name: name.lexeme,
      properties,
      animations,
      children,
      span: {start, end, ...(type.span.sourceFile ? {sourceFile: type.span.sourceFile} : {})},
    };
  }

  private parseProperty(): Property {
    const name = this.consume('identifier', 'Expected a property name.');
    this.consume('colon', "Expected ':' after the property name.");
    const value = this.parseValue();
    const end = this.optionalSemicolon();
    return {kind: 'property', name: name.lexeme, value, span: {start: name.span.start, end, ...(name.span.sourceFile ? {sourceFile: name.span.sourceFile} : {})}};
  }

  private parseAnimation(): Animation {
    const start = this.consumeWord('animate').span.start;
    const property = this.consume('identifier', 'Expected a property name after animate.');
    this.consume('leftBrace', "Expected '{' before keyframes.");
    const keyframes: Keyframe[] = [];
    while (!this.check('rightBrace') && !this.check('eof')) {
      const at = this.parseValue();
      this.consume('colon', "Expected ':' after keyframe time.");
      const value = this.parseValue();
      let easing: string | undefined;
      if (this.checkWord('ease')) {
        this.advance();
        easing = this.consume('identifier', 'Expected an easing name.').lexeme;
      }
      const end = this.optionalSemicolon();
      keyframes.push({
        kind: 'keyframe',
        at,
        value,
        ...(easing ? {easing} : {}),
        span: {start: at.span.start, end, ...(at.span.sourceFile ? {sourceFile: at.span.sourceFile} : {})},
      });
    }
    const end = this.consume('rightBrace', "Expected '}' after keyframes.").span.end;
    return {kind: 'animation', property: property.lexeme, keyframes, span: {start, end, ...(property.span.sourceFile ? {sourceFile: property.span.sourceFile} : {})}};
  }

  private parseValue(): Value {
    if (this.match('minus') || this.match('plus')) {
      const operator = this.previous();
      const operand = this.parseValue();
      return {
        kind: 'unary',
        operator: operator.kind === 'minus' ? '-' : '+',
        operand,
        span: {start: operator.span.start, end: operand.span.end, ...(operator.span.sourceFile ? {sourceFile: operator.span.sourceFile} : {})},
      };
    }
    if (this.match('number')) {
      const number = this.previous();
      if (this.check('identifier') && this.peek().span.start.offset === number.span.end.offset) {
        const unit = this.advance();
        return {
          kind: 'unit',
          value: number.value as number,
          unit: unit.lexeme,
          span: this.join(number.span, unit.span),
        };
      }
      return {kind: 'literal', value: number.value as number, span: number.span};
    }
    if (this.match('string')) {
      const string = this.previous();
      return {kind: 'literal', value: string.value as string, span: string.span};
    }
    if (this.match('identifier')) {
      const identifier = this.previous();
      if (identifier.lexeme === 'true' || identifier.lexeme === 'false') {
        return {kind: 'literal', value: identifier.lexeme === 'true', span: identifier.span};
      }
      return {kind: 'reference', name: identifier.lexeme, span: identifier.span};
    }
    if (this.match('leftBracket')) {
      const opening = this.previous();
      const start = opening.span.start;
      const items: Value[] = [];
      while (!this.check('rightBracket') && !this.check('eof')) {
        items.push(this.parseValue());
        if (!this.match('comma')) break;
      }
      const end = this.consume('rightBracket', "Expected ']' after array.").span.end;
      return {kind: 'array', items, span: {start, end, ...(opening.span.sourceFile ? {sourceFile: opening.span.sourceFile} : {})}};
    }

    const token = this.peek();
    this.report(token, 'FS2002', 'Expected a value.');
    if (!this.check('eof')) this.advance();
    return {kind: 'literal', value: 0, span: token.span};
  }

  private isLayerStart(): boolean {
    return this.check('identifier')
      && this.peekAt(1).kind === 'identifier'
      && this.peekAt(2).kind === 'leftBrace';
  }

  private optionalSemicolon(): Span['end'] {
    return this.match('semicolon') ? this.previous().span.end : this.previous().span.end;
  }

  private synchronizeTopLevel(): void {
    while (!this.check('eof')) {
      if (this.checkWord('import') || this.checkWord('let') || this.checkWord('asset') || this.checkWord('font') || this.checkWord('composition')) return;
      this.advance();
    }
  }

  private consumeWord(word: string): Token {
    if (this.checkWord(word)) return this.advance();
    return this.consume('identifier', `Expected '${word}'.`);
  }

  private consume(kind: TokenKind, message: string): Token {
    if (this.check(kind)) return this.advance();
    const token = this.peek();
    this.report(token, 'FS2003', message);
    return {kind, lexeme: '', span: token.span};
  }

  private report(token: Token, code: string, message: string): void {
    this.diagnostics.push({code, message, severity: 'error', span: token.span, ...(token.span.sourceFile ? {file: token.span.sourceFile} : {})});
  }

  private checkWord(word: string): boolean {
    return this.check('identifier') && this.peek().lexeme === word;
  }

  private match(kind: TokenKind): boolean {
    if (!this.check(kind)) return false;
    this.advance();
    return true;
  }

  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  private advance(): Token {
    const token = this.peek();
    if (!this.check('eof')) this.current += 1;
    return token;
  }

  private previous(): Token {
    return this.tokens[Math.max(0, this.current - 1)]!;
  }

  private peek(): Token {
    return this.tokens[this.current] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peekAt(distance: number): Token {
    return this.tokens[this.current + distance] ?? this.tokens[this.tokens.length - 1]!;
  }

  private join(left: Span, right: Span): Span {
    const sourceFile = left.sourceFile ?? right.sourceFile;
    return {start: left.start, end: right.end, ...(sourceFile ? {sourceFile} : {})};
  }
}
