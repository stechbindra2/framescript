import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {Diagnostic} from './diagnostics.js';
import type {
  IRAudioLoudness,
  IRAsset,
  IRLayer,
  IRMediaMetadata,
  IRMediaStream,
  TimelineIR,
} from './ir.js';
import {resolveSourceLocation, sourceKey, type FrameScriptSourceMap} from './source-map.js';

const MEDIA_SCHEMA_VERSION = 1;

export interface MediaCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type MediaCommandRunner = (command: string, args: readonly string[]) => Promise<MediaCommandResult>;

export interface ProbeMediaOptions {
  readonly projectRoot: string;
  readonly cacheDirectory: string;
  readonly ffprobePath?: string;
  readonly ffmpegPath?: string;
  readonly strict?: boolean;
  readonly runner?: MediaCommandRunner;
}

export interface MediaProbeWarning {
  readonly code: string;
  readonly assetId?: string;
  readonly message: string;
}

export interface MediaProbeReport {
  readonly schema: 'framescript-media-manifest';
  readonly version: 1;
  readonly ffprobeVersion?: string;
  readonly probedAssets: number;
  readonly cacheHits: number;
  readonly warnings: readonly MediaProbeWarning[];
  readonly assets: readonly {
    readonly id: string;
    readonly sourceHash: string;
    readonly cacheKey: string;
    readonly metadata: IRMediaMetadata;
  }[];
}

export interface ProbedMedia {
  readonly ir: TimelineIR;
  readonly report: MediaProbeReport;
}

interface CachedProbe {
  readonly schema: 'framescript-media-cache';
  readonly version: 1;
  readonly sourceHash: string;
  readonly ffprobeVersion: string;
  readonly loudness: boolean;
  readonly metadata: IRMediaMetadata;
}

interface RawProbeStream {
  readonly index?: number;
  readonly codec_type?: string;
  readonly codec_name?: string;
  readonly duration?: string;
  readonly bit_rate?: string;
  readonly width?: number;
  readonly height?: number;
  readonly avg_frame_rate?: string;
  readonly r_frame_rate?: string;
  readonly pix_fmt?: string;
  readonly color_space?: string;
  readonly sample_rate?: string;
  readonly channels?: number;
  readonly channel_layout?: string;
}

interface RawProbe {
  readonly streams?: readonly RawProbeStream[];
  readonly format?: {
    readonly format_name?: string;
    readonly duration?: string;
    readonly bit_rate?: string;
  };
}

export class MediaProbeError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly assetId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MediaProbeError';
  }
}

export async function probeMediaAssets(
  ir: TimelineIR,
  options: ProbeMediaOptions,
): Promise<ProbedMedia> {
  const runner = options.runner ?? runCommand;
  const ffprobe = options.ffprobePath ?? 'ffprobe';
  const ffmpeg = options.ffmpegPath ?? 'ffmpeg';
  const warnings: MediaProbeWarning[] = [];
  const candidates = ir.assets.filter((asset) => asset.probe && ['audio', 'video'].includes(asset.kind) && !isRemote(asset.source));
  if (candidates.length === 0) {
    return {ir, report: {schema: 'framescript-media-manifest', version: 1, probedAssets: 0, cacheHits: 0, warnings, assets: []}};
  }
  let ffprobeVersion: string | undefined;
  try {
    const version = await runner(ffprobe, ['-version']);
    ffprobeVersion = version.stdout.split(/\r?\n/u)[0]?.trim() || 'ffprobe-unknown';
  } catch (error) {
    if (options.strict) throw new MediaProbeError('FS5000', `FFprobe is required but could not be executed: ${errorMessage(error)}`, undefined, {cause: error});
    warnings.push({code: 'FS5100', message: 'FFprobe was not found; local audio/video metadata validation was skipped.'});
    return {ir, report: {schema: 'framescript-media-manifest', version: 1, probedAssets: 0, cacheHits: 0, warnings, assets: []}};
  }

  await mkdir(options.cacheDirectory, {recursive: true});
  const assets: IRAsset[] = [];
  const records: MediaProbeReport['assets'][number][] = [];
  let cacheHits = 0;
  for (const asset of ir.assets) {
    if (!asset.probe || !['audio', 'video'].includes(asset.kind) || isRemote(asset.source)) {
      assets.push(asset);
      continue;
    }
    const absoluteSource = path.resolve(asset.sourceDirectory ?? options.projectRoot, asset.source);
    let bytes: Buffer;
    try {
      bytes = await readFile(absoluteSource);
    } catch (error) {
      throw new MediaProbeError('FS5005', `Cannot read media asset '${asset.id}' at '${asset.source}': ${errorMessage(error)}`, asset.id, {cause: error});
    }
    const sourceHash = createHash('sha256').update(bytes).digest('hex');
    const cacheKey = createHash('sha256')
      .update(`framescript-media:${MEDIA_SCHEMA_VERSION}\0${ffprobeVersion}\0${sourceHash}\0${asset.analyzeLoudness}`)
      .digest('hex');
    const cacheFile = path.join(options.cacheDirectory, `${cacheKey}.json`);
    let cached = await readCache(cacheFile);
    if (cached && (cached.sourceHash !== sourceHash || cached.ffprobeVersion !== ffprobeVersion || cached.loudness !== asset.analyzeLoudness)) {
      cached = undefined;
    }
    let metadata: IRMediaMetadata;
    if (cached) {
      cacheHits += 1;
      metadata = cached.metadata;
    } else {
      metadata = await probeOne(asset, absoluteSource, ffprobe, ffmpeg, runner);
      const entry: CachedProbe = {
        schema: 'framescript-media-cache',
        version: 1,
        sourceHash,
        ffprobeVersion,
        loudness: asset.analyzeLoudness,
        metadata,
      };
      await atomicWrite(cacheFile, `${JSON.stringify(entry, null, 2)}\n`);
    }
    assets.push({...asset, media: metadata});
    records.push({id: asset.id, sourceHash, cacheKey, metadata});
  }
  return {
    ir: {...ir, assets},
    report: {
      schema: 'framescript-media-manifest',
      version: 1,
      ffprobeVersion,
      probedAssets: records.length,
      cacheHits,
      warnings,
      assets: records,
    },
  };
}

export function validateMedia(
  ir: TimelineIR,
  sourceMap: FrameScriptSourceMap,
  projectRoot: string,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const assets = new Map(ir.assets.map((asset) => [asset.id, asset]));
  for (const composition of ir.compositions) {
    const compositionKey = sourceKey('composition', composition.id);
    const visit = (layer: IRLayer, parentKey: string): void => {
      const layerKey = `${parentKey}/${sourceKey('layer', layer.id)}`;
      if (layer.type === 'audio' || layer.type === 'video') {
        const reference = layer.props.src;
        const asset = typeof reference === 'string' && reference.startsWith('asset:')
          ? assets.get(reference.slice(6))
          : undefined;
        if (asset?.media) {
          const hasExpectedStream = asset.media.streams.some(({type}) => type === layer.type);
          if (!hasExpectedStream) {
            diagnostics.push(mediaDiagnostic('FS5001', 'error', `Asset '${asset.id}' has no ${layer.type} stream.`, `${layerKey}/${sourceKey('property', 'src')}`, sourceMap, projectRoot));
          }
          const duration = asset.media.durationSeconds;
          if (duration !== undefined) {
            const sourceFrames = Math.floor(duration * composition.fps);
            const trimStart = numeric(layer.props.trimStart, 0);
            const trimEnd = layer.props.trimEnd === undefined ? undefined : numeric(layer.props.trimEnd, 0);
            if (trimStart >= sourceFrames) {
              diagnostics.push(mediaDiagnostic('FS5002', 'error', `trimStart ${trimStart}f exceeds '${asset.id}' duration ${sourceFrames}f.`, `${layerKey}/${sourceKey('property', 'trimStart')}`, sourceMap, projectRoot));
            }
            if (trimEnd !== undefined && trimEnd > sourceFrames) {
              diagnostics.push(mediaDiagnostic('FS5003', 'error', `trimEnd ${trimEnd}f exceeds '${asset.id}' duration ${sourceFrames}f.`, `${layerKey}/${sourceKey('property', 'trimEnd')}`, sourceMap, projectRoot));
            }
            if (trimEnd !== undefined && trimEnd <= trimStart) {
              diagnostics.push(mediaDiagnostic('FS5004', 'error', 'trimEnd must be after trimStart.', `${layerKey}/${sourceKey('property', 'trimEnd')}`, sourceMap, projectRoot));
            }
            const rate = numeric(layer.props.playbackRate, 1);
            const available = (trimEnd ?? sourceFrames) - trimStart;
            if (!Boolean(layer.props.loop) && layer.duration * rate > available) {
              diagnostics.push(mediaDiagnostic('FS5101', 'warning', `Layer '${layer.id}' needs ${Math.ceil(layer.duration * rate)} source frames but '${asset.id}' provides ${available}f after trimming.`, layerKey, sourceMap, projectRoot));
            }
          }
        }
      }
      for (const child of layer.children) visit(child, layerKey);
    };
    for (const layer of composition.layers) visit(layer, compositionKey);
  }
  return diagnostics;
}

async function probeOne(
  asset: IRAsset,
  absoluteSource: string,
  ffprobe: string,
  ffmpeg: string,
  runner: MediaCommandRunner,
): Promise<IRMediaMetadata> {
  let raw: RawProbe;
  try {
    const result = await runner(ffprobe, [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', absoluteSource,
    ]);
    raw = JSON.parse(result.stdout) as RawProbe;
  } catch (error) {
    throw new MediaProbeError('FS5006', `FFprobe failed for asset '${asset.id}': ${errorMessage(error)}`, asset.id, {cause: error});
  }
  const streams = (raw.streams ?? []).map(normalizeStream);
  const streamDuration = Math.max(0, ...streams.map(({durationSeconds}) => durationSeconds ?? 0));
  const formatDuration = finiteNumber(raw.format?.duration);
  let loudness: IRAudioLoudness | undefined;
  if (asset.analyzeLoudness && streams.some(({type}) => type === 'audio')) {
    loudness = await analyzeLoudness(asset, absoluteSource, ffmpeg, runner);
  }
  return {
    schema: 'framescript-media',
    version: 1,
    ...(raw.format?.format_name ? {format: raw.format.format_name} : {}),
    ...(formatDuration !== undefined || streamDuration > 0 ? {durationSeconds: formatDuration ?? streamDuration} : {}),
    ...(finiteInteger(raw.format?.bit_rate) !== undefined ? {bitRate: finiteInteger(raw.format?.bit_rate)!} : {}),
    streams,
    ...(loudness ? {loudness} : {}),
  };
}

async function analyzeLoudness(
  asset: IRAsset,
  absoluteSource: string,
  ffmpeg: string,
  runner: MediaCommandRunner,
): Promise<IRAudioLoudness> {
  let result: MediaCommandResult;
  try {
    result = await runner(ffmpeg, [
      '-hide_banner', '-nostats', '-i', absoluteSource,
      '-map', '0:a:0', '-af', 'loudnorm=I=-24:LRA=7:TP=-2:print_format=json',
      '-f', 'null', '-',
    ]);
  } catch (error) {
    throw new MediaProbeError('FS5007', `Loudness analysis failed for asset '${asset.id}': ${errorMessage(error)}`, asset.id, {cause: error});
  }
  const start = result.stderr.lastIndexOf('{');
  const end = result.stderr.lastIndexOf('}');
  if (start < 0 || end <= start) throw new MediaProbeError('FS5008', `FFmpeg returned no loudness JSON for asset '${asset.id}'.`, asset.id);
  const raw = JSON.parse(result.stderr.slice(start, end + 1)) as Record<string, string>;
  return {
    integratedLufs: requiredNumber(raw.input_i, 'input_i', asset.id),
    loudnessRangeLu: requiredNumber(raw.input_lra, 'input_lra', asset.id),
    truePeakDbfs: requiredNumber(raw.input_tp, 'input_tp', asset.id),
    thresholdLufs: requiredNumber(raw.input_thresh, 'input_thresh', asset.id),
    targetOffsetDb: requiredNumber(raw.target_offset, 'target_offset', asset.id),
  };
}

function normalizeStream(stream: RawProbeStream): IRMediaStream {
  const type = ['audio', 'video', 'subtitle', 'data', 'attachment'].includes(stream.codec_type ?? '')
    ? stream.codec_type as IRMediaStream['type']
    : 'unknown';
  const frameRate = rationalNumber(stream.avg_frame_rate) ?? rationalNumber(stream.r_frame_rate);
  return {
    index: stream.index ?? 0,
    type,
    ...(stream.codec_name ? {codec: stream.codec_name} : {}),
    ...(finiteNumber(stream.duration) !== undefined ? {durationSeconds: finiteNumber(stream.duration)!} : {}),
    ...(finiteInteger(stream.bit_rate) !== undefined ? {bitRate: finiteInteger(stream.bit_rate)!} : {}),
    ...(stream.width !== undefined ? {width: stream.width} : {}),
    ...(stream.height !== undefined ? {height: stream.height} : {}),
    ...(frameRate !== undefined ? {frameRate} : {}),
    ...(stream.pix_fmt ? {pixelFormat: stream.pix_fmt} : {}),
    ...(stream.color_space ? {colorSpace: stream.color_space} : {}),
    ...(finiteInteger(stream.sample_rate) !== undefined ? {sampleRate: finiteInteger(stream.sample_rate)!} : {}),
    ...(stream.channels !== undefined ? {channels: stream.channels} : {}),
    ...(stream.channel_layout ? {channelLayout: stream.channel_layout} : {}),
  };
}

function mediaDiagnostic(
  code: string,
  severity: Diagnostic['severity'],
  message: string,
  key: string,
  sourceMap: FrameScriptSourceMap,
  projectRoot: string,
): Diagnostic {
  const location = resolveSourceLocation(sourceMap, key);
  const file = location ? path.resolve(projectRoot, ...location.path.split('/')) : undefined;
  const start = location?.start ?? {line: 1, column: 1};
  const end = location?.end ?? start;
  const span = {
    start: {offset: 0, line: start.line, column: start.column},
    end: {offset: 0, line: end.line, column: end.column},
    ...(file ? {sourceFile: file} : {}),
  };
  return {code, severity, message, span, ...(file ? {file} : {})};
}

async function readCache(file: string): Promise<CachedProbe | undefined> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as CachedProbe;
    return value.schema === 'framescript-media-cache' && value.version === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, file);
}

function runCommand(command: string, args: readonly string[]): Promise<MediaCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true}, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} exited with ${error.code ?? 'an error'}: ${stderr.trim()}`, {cause: error}));
      else resolve({stdout, stderr});
    });
  });
}

function requiredNumber(value: string | undefined, field: string, assetId: string): number {
  const number = finiteNumber(value);
  if (number === undefined) throw new MediaProbeError('FS5009', `Invalid loudness field '${field}' for asset '${assetId}'.`, assetId);
  return number;
}

function finiteNumber(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function finiteInteger(value: string | number | undefined): number | undefined {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.round(number);
}

function rationalNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator] = value.split('/').map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  return numerator! / denominator!;
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRemote(source: string): boolean {
  return /^(?:https?:|data:|blob:)/u.test(source);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
