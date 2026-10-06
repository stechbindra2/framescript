import type {Position, Span} from './ast.js';
import {FrameScriptError, type Diagnostic} from './diagnostics.js';

export type TokenKind =
  | 'identifier'
  | 'number'
  | 'string'
  | 'leftBrace'
  | 'rightBrace'
  | 'leftBracket'
  | 'rightBracket'
  | 'colon'
  | 'semicolon'
  | 'comma'
  | 'equals'
  | 'plus'
  | 'minus'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly value?: string | number;
  readonly span: Span;
}

const punctuation: Readonly<Record<string, TokenKind>> = {
  '{': 'leftBrace',
  '}': 'rightBrace',
  '[': 'leftBracket',
  ']': 'rightBracket',
  ':': 'colon',
  ';': 'semicolon',
  ',': 'comma',
  '=': 'equals',
  '+': 'plus',
  '-': 'minus',
};

export function lex(source: string, sourceFile?: string): readonly Token[] {
  const scanner = new Scanner(source, sourceFile);
  return scanner.scan();
}

class Scanner {
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private offset = 0;
  private line = 1;
  private column = 1;

  public constructor(
    private readonly source: string,
    private readonly sourceFile?: string,
  ) {}

  public scan(): readonly Token[] {
    while (!this.atEnd()) {
      this.scanToken();
    }

    const here = this.position();
    this.tokens.push({kind: 'eof', lexeme: '', span: this.span(here, here)});
    if (this.diagnostics.length > 0) {
      throw new FrameScriptError('Lexing failed', this.diagnostics);
    }
    return this.tokens;
  }

  private scanToken(): void {
    const start = this.position();
    const character = this.advance();

    if (/\s/u.test(character)) return;
    if (character === '/' && this.peek() === '/') {
      while (!this.atEnd() && this.peek() !== '\n') this.advance();
      return;
    }
    if (character === '/' && this.peek() === '*') {
      this.advance();
      this.blockComment(start);
      return;
    }

    const punctuationKind = punctuation[character];
    if (punctuationKind) {
      this.add(punctuationKind, start);
      return;
    }
    if (character === '"' || character === "'") {
      this.string(character, start);
      return;
    }
    if (/[0-9]/u.test(character) || (character === '.' && /[0-9]/u.test(this.peek()))) {
      this.number(start);
      return;
    }
    if (/[A-Za-z_]/u.test(character)) {
      this.identifier(start);
      return;
    }

    this.diagnostics.push({
      code: 'FS1001',
      message: `Unexpected character ${JSON.stringify(character)}.`,
      severity: 'error',
      span: this.span(start, this.position()),
    });
  }

  private blockComment(start: Position): void {
    while (!this.atEnd()) {
      if (this.peek() === '*' && this.peek(1) === '/') {
        this.advance();
        this.advance();
        return;
      }
      this.advance();
    }
    this.diagnostics.push({
      code: 'FS1002',
      message: 'Unterminated block comment.',
      severity: 'error',
      span: this.span(start, this.position()),
    });
  }

  private string(quote: string, start: Position): void {
    let value = '';
    while (!this.atEnd() && this.peek() !== quote) {
      const character = this.advance();
      if (character !== '\\') {
        value += character;
        continue;
      }
      if (this.atEnd()) break;
      const escaped = this.advance();
      const escapes: Readonly<Record<string, string>> = {
        n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'",
      };
      value += escapes[escaped] ?? escaped;
    }
    if (this.atEnd()) {
      this.diagnostics.push({
        code: 'FS1003',
        message: 'Unterminated string literal.',
        severity: 'error',
        span: this.span(start, this.position()),
      });
      return;
    }
    this.advance();
    this.add('string', start, value);
  }

  private number(start: Position): void {
    while (/[0-9]/u.test(this.peek())) this.advance();
    if (this.peek() === '.' && /[0-9]/u.test(this.peek(1))) {
      this.advance();
      while (/[0-9]/u.test(this.peek())) this.advance();
    }
    const lexeme = this.source.slice(start.offset, this.offset);
    this.add('number', start, Number(lexeme));
  }

  private identifier(start: Position): void {
    while (/[A-Za-z0-9_-]/u.test(this.peek())) this.advance();
    this.add('identifier', start, this.source.slice(start.offset, this.offset));
  }

  private add(kind: TokenKind, start: Position, value?: string | number): void {
    const token: Token = {
      kind,
      lexeme: this.source.slice(start.offset, this.offset),
      span: this.span(start, this.position()),
      ...(value === undefined ? {} : {value}),
    };
    this.tokens.push(token);
  }

  private advance(): string {
    const character = this.source[this.offset] ?? '\0';
    this.offset += 1;
    if (character === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return character;
  }

  private peek(distance = 0): string {
    return this.source[this.offset + distance] ?? '\0';
  }

  private atEnd(): boolean {
    return this.offset >= this.source.length;
  }

  private position(): Position {
    return {offset: this.offset, line: this.line, column: this.column};
  }

  private span(start: Position, end: Position): Span {
    return {start, end, ...(this.sourceFile ? {sourceFile: this.sourceFile} : {})};
  }
}
