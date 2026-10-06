import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {materializeAssets} from './assets.js';
import type {ProjectCompilation} from './modules.js';
import {compileProject} from './modules.js';
import type {FrameScriptPlugin} from './plugins.js';
import {generateRemotionProject, type GeneratedProject} from './targets/remotion.js';
import {FrameScriptError} from './diagnostics.js';
import {
  probeMediaAssets,
  validateMedia,
  type MediaCommandRunner,
  type MediaProbeReport,
} from './media.js';

export interface BuildProjectOptions {
  readonly sourceFile: string;
  readonly outputDirectory: string;
  readonly plugins?: readonly FrameScriptPlugin[];
  readonly media?: {
    readonly cacheDirectory?: string;
    readonly ffprobePath?: string;
    readonly ffmpegPath?: string;
    readonly strict?: boolean;
    readonly runner?: MediaCommandRunner;
  };
}

export interface ProjectBuildResult {
  readonly source: string;
  readonly compilation: ProjectCompilation;
  readonly generated: GeneratedProject;
  readonly copiedAssets: readonly string[];
  readonly media: MediaProbeReport;
  readonly mediaWarnings: readonly import('./diagnostics.js').Diagnostic[];
}

export async function buildProject(options: BuildProjectOptions): Promise<ProjectBuildResult> {
  const sourceFile = path.resolve(options.sourceFile);
  const outputDirectory = path.resolve(options.outputDirectory);
  const source = await readFile(sourceFile, 'utf8');
  const compilation = await compileProject(sourceFile, {
    ...(options.plugins ? {plugins: options.plugins} : {}),
  });
  const projectRoot = compilation.projectRoot;
  const probed = await probeMediaAssets(compilation.ir, {
    projectRoot,
    cacheDirectory: options.media?.cacheDirectory ?? path.join(projectRoot, '.framescript', 'cache', 'media'),
    ...(options.media?.ffprobePath ? {ffprobePath: options.media.ffprobePath} : {}),
    ...(options.media?.ffmpegPath ? {ffmpegPath: options.media.ffmpegPath} : {}),
    ...(options.media?.strict !== undefined ? {strict: options.media.strict} : {}),
    ...(options.media?.runner ? {runner: options.media.runner} : {}),
  });
  const mediaDiagnostics = validateMedia(probed.ir, compilation.sourceMap, projectRoot);
  const mediaErrors = mediaDiagnostics.filter(({severity}) => severity === 'error');
  if (mediaErrors.length > 0) throw new FrameScriptError('Media validation failed', mediaDiagnostics);
  const materialized = await materializeAssets(probed.ir, {
    sourceDirectory: projectRoot,
    publicDirectory: path.join(outputDirectory, 'public'),
  });
  const generated = await generateRemotionProject(materialized.ir, {
    outputDirectory,
    projectName: path.basename(sourceFile, path.extname(sourceFile)),
    sourceMap: compilation.sourceMap,
    mediaManifest: probed.report,
    ...(options.plugins ? {plugins: options.plugins} : {}),
  });
  return {
    source,
    compilation,
    generated,
    copiedAssets: materialized.copiedFiles,
    media: probed.report,
    mediaWarnings: mediaDiagnostics.filter(({severity}) => severity === 'warning'),
  };
}
