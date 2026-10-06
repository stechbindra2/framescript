import {describe, expect, it} from 'vitest';
import {compile} from '../src/compiler.js';
import {FrameScriptError} from '../src/diagnostics.js';

describe('semantic compiler', () => {
  it('normalizes time and constants into deterministic frame IR', () => {
    const result = compile(`
      let ink = "#fff";
      composition Demo {
        width: 1280; height: 720; fps: 24; duration: 2s;
        text title {
          text: "Hello"; color: ink; from: 500ms; duration: 1s;
          animate opacity { 0f: 0; 12f: 1 ease out-cubic; }
        }
      }
    `);
    const composition = result.ir.compositions[0]!;
    expect(composition.durationInFrames).toBe(48);
    expect(composition.layers[0]).toMatchObject({from: 12, duration: 24});
    expect(composition.layers[0]?.props.color).toBe('#fff');
  });

  it('rejects keyframes outside a layer timeline', () => {
    expect(() => compile(`
      composition Demo {
        fps: 30; duration: 1s;
        rect card {
          animate opacity { 0s: 0; 2s: 1; }
        }
      }
    `)).toThrow(FrameScriptError);
  });

  it('rejects unknown references', () => {
    expect(() => compile('composition Demo { duration: 1s; background: missing; }'))
      .toThrow(/Semantic analysis failed/u);
  });
});
