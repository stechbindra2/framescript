import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {compile} from '../src/compiler.js';
import {probeMediaAssets, validateMedia, type MediaCommandRunner} from '../src/media.js';
import {buildProject} from '../src/project-builder.js';

const probeJson = JSON.stringify({
  streams: [{
    index: 0,
    codec_type: 'audio',
    codec_name: 'pcm_s16le',
    duration: '1.5',
    bit_rate: '1411200',
    sample_rate: '44100',
    channels: 2,
    channel_layout: 'stereo',
  }],
  format: {format_name: 'wav', duration: '1.5', bit_rate: '1411200'},
});

const loudnessJson = JSON.stringify({
  input_i: '-18.25',
  input_tp: '-1.20',
  input_lra: '4.10',
  input_thresh: '-28.50',
  target_offset: '0.15',
});

describe('media probing and validation', () => {
  it('normalizes FFprobe metadata, analyzes loudness, and reuses the content cache', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-media-'));
    const mediaFile = path.join(root, 'voice.wav');
    await writeFile(mediaFile, Buffer.from('deterministic fake media bytes'));
    const calls: Array<{command: string; args: readonly string[]}> = [];
    const runner: MediaCommandRunner = async (command, args) => {
      calls.push({command, args});
      if (args[0] === '-version') return {stdout: 'ffprobe version test-1\n', stderr: ''};
      if (command === 'ffmpeg') return {stdout: '', stderr: `analysis\n${loudnessJson}\n`};
      return {stdout: probeJson, stderr: ''};
    };
    const result = compile(`
      asset voice { src: "voice.wav"; type: "audio"; loudness: true; }
      composition Demo { fps: 30; duration: 1s; audio narration { src: voice; } }
    `, {file: path.join(root, 'main.frame')});
    const options = {projectRoot: root, cacheDirectory: path.join(root, 'cache'), runner};
    const first = await probeMediaAssets(result.ir, options);
    const second = await probeMediaAssets(result.ir, options);

    expect(first.ir.assets[0]?.media).toMatchObject({
      durationSeconds: 1.5,
      streams: [{type: 'audio', sampleRate: 44100, channels: 2}],
      loudness: {integratedLufs: -18.25, truePeakDbfs: -1.2},
    });
    expect(first.report.cacheHits).toBe(0);
    expect(second.report.cacheHits).toBe(1);
    expect(calls.filter(({args}) => args.includes('-show_streams'))).toHaveLength(1);
    expect(calls.filter(({command}) => command === 'ffmpeg')).toHaveLength(1);
  });

  it('maps invalid trims back to the exact FrameScript property', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-media-validation-'));
    await writeFile(path.join(root, 'clip.wav'), Buffer.from('fake'));
    const file = path.join(root, 'main.frame');
    const result = compile(`
      asset clip { src: "clip.wav"; type: "audio"; }
      composition Demo {
        fps: 30; duration: 2s;
        audio score { src: clip; trimEnd: 2s; }
      }
    `, {file});
    const runner: MediaCommandRunner = async (_command, args) => args[0] === '-version'
      ? {stdout: 'ffprobe version test-1\n', stderr: ''}
      : {stdout: probeJson, stderr: ''};
    const probed = await probeMediaAssets(result.ir, {projectRoot: root, cacheDirectory: path.join(root, 'cache'), runner});
    const diagnostics = validateMedia(probed.ir, result.sourceMap, root);
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'FS5003', file, span: expect.objectContaining({start: expect.objectContaining({line: 5})})}),
    ]));
  });

  it('writes a media manifest during a project build', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'framescript-media-build-'));
    await writeFile(path.join(root, 'voice.wav'), Buffer.from('fake'));
    const file = path.join(root, 'main.frame');
    await writeFile(file, 'asset voice { src: "voice.wav"; type: "audio"; } composition Demo { fps: 30; duration: 1s; audio narration { src: voice; loop: true; } }', 'utf8');
    const runner: MediaCommandRunner = async (_command, args) => args[0] === '-version'
      ? {stdout: 'ffprobe version test-1\n', stderr: ''}
      : {stdout: probeJson, stderr: ''};
    const output = path.join(root, 'out');
    const built = await buildProject({sourceFile: file, outputDirectory: output, media: {runner, strict: true}});
    expect(built.media.probedAssets).toBe(1);
    const manifest = JSON.parse(await readFile(path.join(output, 'media-manifest.json'), 'utf8')) as {assets: unknown[]};
    expect(manifest.assets).toHaveLength(1);
  });
});
