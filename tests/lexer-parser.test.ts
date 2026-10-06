import {describe, expect, it} from 'vitest';
import {lex} from '../src/lexer.js';
import {parse} from '../src/parser.js';
import {format} from '../src/formatter.js';

describe('lexer and parser', () => {
  it('tracks units, strings, comments, and keyframes', () => {
    const source = `
      // motion
      let accent = "#80f";
      composition Demo {
        duration: 2s;
        text title {
          text: "hello\\nworld";
          color: accent;
          animate opacity { 0ms: 0; 1s: 1 ease out-cubic; }
        }
      }
    `;
    const tokens = lex(source);
    expect(tokens.some((token) => token.lexeme === 'out-cubic')).toBe(true);
    const program = parse(source);
    expect(program.constants).toHaveLength(1);
    expect(program.compositions[0]?.layers[0]?.animations[0]?.keyframes).toHaveLength(2);
  });

  it('formats into a stable canonical form', () => {
    const source = 'composition X{duration:1s;text t{text:"x";color:"white";}}';
    const once = format(parse(source));
    const twice = format(parse(once));
    expect(twice).toBe(once);
  });
});
