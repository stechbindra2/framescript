import type {
  Composition,
  Layer,
  Program,
  Property,
  Span,
  Value,
} from './ast.js';
import path from 'node:path';
import {LAYER_TYPES} from './ast.js';
import {FrameScriptError, type Diagnostic} from './diagnostics.js';
import type {
  IRAnimation,
  IRAsset,
  IRAssetKind,
  IRComposition,
  IRFont,
  IRKeyframe,
  IRLayer,
  IRValue,
  TimelineIR,
} from './ir.js';
import {
  ANIMATABLE_PROPERTIES,
  COMPOSITION_PROPERTIES,
  EASING_NAMES,
  LAYER_PROPERTIES,
} from './language-data.js';
import {PluginRegistry, type FrameScriptPlugin, type PluginLayerDefinition} from './plugins.js';
import {sourceKey, type SourceMapDraft} from './source-map.js';

const compositionProperties = new Set(COMPOSITION_PROPERTIES.map(({name}) => name));
const layerProperties = new Set(LAYER_PROPERTIES.map(({name}) => name));
const animatableProperties = new Set<string>(ANIMATABLE_PROPERTIES);
const easingNames = new Set<string>(EASING_NAMES);

export interface AnalysisResult {
  readonly ir: TimelineIR;
  readonly warnings: readonly Diagnostic[];
  readonly sourceMap: SourceMapDraft;
}

function inferAssetKind(source: string): IRAssetKind {
  const extension = source.split(/[?#]/u)[0]?.split('.').at(-1)?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'svg'].includes(extension)) return 'image';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(extension)) return 'video';
  if (['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(extension)) return 'audio';
  if (['woff', 'woff2', 'ttf', 'otf'].includes(extension)) return 'font';
  if (['json', 'csv', 'txt', 'vtt', 'srt'].includes(extension)) return 'data';
  return 'binary';
}

export interface AnalyzeOptions {
  readonly plugins?: readonly FrameScriptPlugin[];
}

export function analyze(program: Program, options: AnalyzeOptions = {}): AnalysisResult {
  return new Analyzer(program, new PluginRegistry(options.plugins)).analyze();
}

class Analyzer {
  private readonly errors: Diagnostic[] = [];
  private readonly warnings: Diagnostic[] = [];
  private readonly constantNodes = new Map<string, Value>();
  private readonly constants = new Map<string, IRValue>();
  private readonly resolving = new Set<string>();
  private readonly assetNames = new Set<string>();
  private readonly fontFamilies = new Map<string, string>();
  private readonly sourceMappings: Record<string, Span> = {};
  private readonly plugins: PluginRegistry;

  public constructor(private readonly program: Program, plugins: PluginRegistry) {
    this.plugins = plugins;
  }

  public analyze(): AnalysisResult {
    for (const asset of this.program.assets) this.assetNames.add(asset.name);
    for (const font of this.program.fonts) {
      const family = font.properties.find(({name}) => name === 'family')?.value;
      this.fontFamilies.set(font.name, family?.kind === 'literal' && typeof family.value === 'string' ? family.value : font.name);
    }
    for (const name of this.assetNames) {
      if (this.fontFamilies.has(name)) this.error(this.program.span, 'FS3032', `Global name '${name}' is used by both an asset and a font.`);
    }
    for (const constant of this.program.constants) {
      if (this.assetNames.has(constant.name) || this.fontFamilies.has(constant.name)) {
        this.error(constant.span, 'FS3033', `Global name '${constant.name}' is already used by an asset or font.`);
      }
      if (this.constantNodes.has(constant.name)) {
        this.error(constant.span, 'FS3001', `Duplicate constant '${constant.name}'.`);
      } else {
        this.constantNodes.set(constant.name, constant.value);
      }
    }
    for (const name of this.constantNodes.keys()) this.resolveReference(name, this.program.span);

    const assets = this.analyzeAssets();
    const fonts = this.analyzeFonts();

    const seenCompositions = new Set<string>();
    const compositions: IRComposition[] = [];
    for (const composition of this.program.compositions) {
      if (seenCompositions.has(composition.name)) {
        this.error(composition.span, 'FS3002', `Duplicate composition '${composition.name}'.`);
      }
      seenCompositions.add(composition.name);
      compositions.push(this.analyzeComposition(composition));
    }
    if (compositions.length === 0) {
      this.error(this.program.span, 'FS3003', 'A program must declare at least one composition.');
    }

    if (this.errors.length > 0) {
      throw new FrameScriptError('Semantic analysis failed', [...this.errors, ...this.warnings]);
    }
    const baseIR: TimelineIR = {schema: 'framescript-ir', version: 1, assets, fonts, compositions};
    const ir = this.plugins.transform(baseIR);
    this.validatePluginLayers(ir);
    if (this.errors.length > 0) {
      throw new FrameScriptError('Plugin validation failed', [...this.errors, ...this.warnings]);
    }
    return {
      ir,
      warnings: this.warnings,
      sourceMap: {mappings: this.sourceMappings},
    };
  }

  private analyzeAssets(): IRAsset[] {
    const allowed = new Set(['src', 'type', 'probe', 'loudness']);
    const seen = new Set<string>();
    return this.program.assets.map((asset) => {
      const key = sourceKey('asset', asset.name);
      this.map(key, asset.span);
      if (seen.has(asset.name)) this.error(asset.span, 'FS3023', `Duplicate asset '${asset.name}'.`);
      seen.add(asset.name);
      const properties = this.propertyMap(asset.properties, allowed, 'asset', key);
      const source = properties.get('src');
      if (typeof source !== 'string' || source.startsWith('asset:')) {
        this.error(asset.span, 'FS3024', `Asset '${asset.name}' requires a direct string 'src'.`);
      }
      const explicitKind = properties.get('type');
      const kind = typeof explicitKind === 'string'
        ? explicitKind
        : inferAssetKind(typeof source === 'string' ? source : '');
      if (!['image', 'video', 'audio', 'font', 'data', 'binary'].includes(kind)) {
        this.error(asset.span, 'FS3025', `Asset '${asset.name}' has unknown type '${String(kind)}'.`);
      }
      const probeValue = properties.get('probe');
      if (probeValue !== undefined && typeof probeValue !== 'boolean') {
        this.error(asset.span, 'FS3034', `Asset '${asset.name}' property 'probe' must be boolean.`);
      }
      const loudnessValue = properties.get('loudness');
      if (loudnessValue !== undefined && typeof loudnessValue !== 'boolean') {
        this.error(asset.span, 'FS3035', `Asset '${asset.name}' property 'loudness' must be boolean.`);
      }
      return {
        id: asset.name,
        source: typeof source === 'string' ? source : '',
        kind: kind as IRAssetKind,
        probe: probeValue !== false,
        analyzeLoudness: loudnessValue === true,
        ...(asset.span.sourceFile && path.isAbsolute(asset.span.sourceFile) ? {sourceDirectory: path.dirname(asset.span.sourceFile)} : {}),
      };
    });
  }

  private analyzeFonts(): IRFont[] {
    const allowed = new Set(['src', 'family', 'weight', 'style']);
    const seen = new Set<string>();
    return this.program.fonts.map((font) => {
      const key = sourceKey('font', font.name);
      this.map(key, font.span);
      if (seen.has(font.name)) this.error(font.span, 'FS3026', `Duplicate font '${font.name}'.`);
      seen.add(font.name);
      const properties = this.propertyMap(font.properties, allowed, 'font', key);
      const source = properties.get('src');
      if (typeof source !== 'string') this.error(font.span, 'FS3027', `Font '${font.name}' requires a string or asset 'src'.`);
      const familyValue = properties.get('family');
      const family = typeof familyValue === 'string' ? familyValue : font.name;
      const weightValue = properties.get('weight');
      const weight = typeof weightValue === 'number' || typeof weightValue === 'string' ? weightValue : 400;
      const styleValue = properties.get('style');
      const style = typeof styleValue === 'string' ? styleValue : 'normal';
      return {
        id: font.name,
        source: typeof source === 'string' ? source : '',
        family,
        weight,
        style,
        ...(font.span.sourceFile && path.isAbsolute(font.span.sourceFile) ? {sourceDirectory: path.dirname(font.span.sourceFile)} : {}),
      };
    });
  }

  private analyzeComposition(composition: Composition): IRComposition {
    const key = sourceKey('composition', composition.name);
    this.map(key, composition.span);
    const properties = this.propertyMap(composition.properties, compositionProperties, 'composition', key);
    const fps = this.positiveInteger(properties.get('fps'), 'fps', composition.span, 30);
    const width = this.positiveInteger(properties.get('width'), 'width', composition.span, 1920);
    const height = this.positiveInteger(properties.get('height'), 'height', composition.span, 1080);
    const durationValue = properties.get('duration');
    const durationInFrames = durationValue
      ? this.timeToFrames(durationValue, fps, 'duration')
      : fps * 5;
    if (!durationValue) {
      this.warning(composition.span, 'FS3101', "Composition has no 'duration'; defaulting to 5s.");
    }
    const backgroundValue = properties.get('background');
    const background = typeof backgroundValue === 'string' ? backgroundValue : '#000000';
    if (backgroundValue !== undefined && typeof backgroundValue !== 'string') {
      this.error(composition.span, 'FS3004', "Composition 'background' must be a string.");
    }

    const names = new Set<string>();
    const layers = composition.layers.map((layer) =>
      this.analyzeLayer(layer, fps, durationInFrames, names, composition.name, key),
    );
    this.validateDucking(composition, layers);
    return {id: composition.name, width, height, fps, durationInFrames, background, layers};
  }

  private analyzeLayer(
    layer: Layer,
    fps: number,
    parentDuration: number,
    names: Set<string>,
    path: string,
    parentSourceKey: string,
  ): IRLayer {
    const qualifiedName = `${path}.${layer.name}`;
    const key = `${parentSourceKey}/${sourceKey('layer', layer.name)}`;
    this.map(key, layer.span);
    if (names.has(qualifiedName)) {
      this.error(layer.span, 'FS3005', `Duplicate layer '${qualifiedName}'.`);
    }
    names.add(qualifiedName);

    const plugin = this.plugins.ownerOf(layer.layerType);
    const pluginDefinition = this.plugins.definitionOf(layer.layerType);
    const isCore = (LAYER_TYPES as readonly string[]).includes(layer.layerType);
    if (!isCore && !pluginDefinition) {
      this.error(layer.span, 'FS3028', `Unknown layer type '${layer.layerType}'. Install or register a plugin that provides it.`);
    }
    const allowedProperties = this.allowedLayerProperties(pluginDefinition);
    const properties = this.propertyMap(layer.properties, allowedProperties, `${layer.layerType} layer`, key);
    this.validatePluginProperties(layer, properties, pluginDefinition);
    const fromValue = properties.get('from');
    const durationValue = properties.get('duration');
    const from = fromValue === undefined ? 0 : this.timeToFrames(fromValue, fps, 'from');
    const duration = durationValue === undefined
      ? parentDuration - from
      : this.timeToFrames(durationValue, fps, 'duration');
    if (from < 0 || from >= parentDuration) {
      this.error(layer.span, 'FS3006', `Layer '${qualifiedName}' starts outside its parent timeline.`);
    }
    if (duration <= 0 || from + duration > parentDuration) {
      this.error(layer.span, 'FS3007', `Layer '${qualifiedName}' duration exceeds its parent timeline.`);
    }

    properties.delete('from');
    properties.delete('duration');
    for (const name of ['trimStart', 'trimEnd', 'fadeIn', 'fadeOut', 'duckAttack', 'duckRelease']) {
      const value = properties.get(name);
      if (value !== undefined) properties.set(name, this.timeToFrames(value, fps, name));
    }
    this.validateLayerRequiredProperties(layer, properties);

    const animations: IRAnimation[] = layer.animations.map((animation) => {
      const animationKey = `${key}/${sourceKey('animation', animation.property)}`;
      this.map(animationKey, animation.span);
      const pluginAnimatable = pluginDefinition?.properties[animation.property]?.animatable === true;
      if (!animatableProperties.has(animation.property) && !pluginAnimatable) {
        this.error(animation.span, 'FS3008', `Property '${animation.property}' is not animatable.`);
      }
      if (animation.keyframes.length < 2) {
        this.error(animation.span, 'FS3009', 'An animation needs at least two keyframes.');
      }
      let previous = -1;
      const keyframes: IRKeyframe[] = animation.keyframes.map((keyframe) => {
        const keyframeIndex = animation.keyframes.indexOf(keyframe);
        this.map(`${animationKey}/${sourceKey('keyframe', String(keyframeIndex))}`, keyframe.span);
        const resolvedAt = this.resolveValue(keyframe.at);
        const frame = this.timeToFrames(resolvedAt, fps, 'keyframe time');
        if (frame <= previous) {
          this.error(keyframe.span, 'FS3010', 'Keyframe times must be strictly increasing.');
        }
        if (frame > duration) {
          this.error(keyframe.span, 'FS3011', `Keyframe at ${frame}f exceeds layer duration ${duration}f.`);
        }
        previous = frame;
        const easing = keyframe.easing ?? 'linear';
        if (!easingNames.has(easing)) {
          this.error(keyframe.span, 'FS3012', `Unknown easing '${easing}'.`);
        }
        return {frame, value: this.resolveValue(keyframe.value), easing};
      });
      return {property: animation.property, keyframes};
    });

    const children = layer.children.map((child) =>
      this.analyzeLayer(child, fps, duration, names, qualifiedName, key),
    );
    return {
      id: layer.name,
      type: layer.layerType,
      ...(plugin ? {plugin: plugin.name} : {}),
      from,
      duration,
      props: Object.fromEntries(properties),
      animations,
      children,
    };
  }

  private allowedLayerProperties(definition: PluginLayerDefinition | undefined): ReadonlySet<string> {
    if (!definition) return layerProperties;
    const names = new Set(Object.keys(definition.properties));
    if (definition.allowCoreProperties !== false) {
      for (const name of layerProperties) names.add(name);
    } else {
      names.add('from');
      names.add('duration');
    }
    return names;
  }

  private validatePluginProperties(
    layer: Layer,
    properties: ReadonlyMap<string, IRValue>,
    definition: PluginLayerDefinition | undefined,
  ): void {
    if (!definition) return;
    for (const [name, schema] of Object.entries(definition.properties)) {
      const value = properties.get(name);
      if (schema.required && value === undefined) {
        this.error(layer.span, 'FS3029', `Plugin layer '${layer.name}' requires property '${name}'.`);
      } else if (value !== undefined && !this.plugins.validateProperty(schema.type, value)) {
        this.error(layer.span, 'FS3030', `Plugin property '${name}' expects ${schema.type}.`);
      }
    }
  }

  private validatePluginLayers(ir: TimelineIR): void {
    const visit = (layer: IRLayer): void => {
      const plugin = layer.plugin ? this.plugins.plugins.find(({name}) => name === layer.plugin) : undefined;
      for (const message of plugin?.validateLayer?.(layer) ?? []) {
        this.error(this.program.span, 'FS3031', `[${plugin?.name}] ${message}`);
      }
      for (const child of layer.children) visit(child);
    };
    for (const composition of ir.compositions) for (const layer of composition.layers) visit(layer);
  }

  private validateLayerRequiredProperties(layer: Layer, properties: Map<string, IRValue>): void {
    if (layer.layerType === 'text' && typeof properties.get('text') !== 'string') {
      this.error(layer.span, 'FS3013', `Text layer '${layer.name}' requires a string 'text' property.`);
    }
    if (['image', 'video', 'audio'].includes(layer.layerType) && typeof properties.get('src') !== 'string') {
      this.error(layer.span, 'FS3014', `${layer.layerType} layer '${layer.name}' requires a string 'src' property.`);
    }
    if (layer.layerType === 'group' && ['text', 'src'].some((name) => properties.has(name))) {
      this.warning(layer.span, 'FS3102', `Group '${layer.name}' has content properties that will be ignored.`);
    }
    if (properties.has('duckUnder') && layer.layerType !== 'audio') {
      this.error(layer.span, 'FS3036', `'duckUnder' is only valid on audio layers.`);
    }
    const duckUnder = properties.get('duckUnder');
    if (duckUnder !== undefined && typeof duckUnder !== 'string') {
      this.error(layer.span, 'FS3037', `'duckUnder' must be a quoted audio layer ID.`);
    }
    const duckAmount = properties.get('duckAmount');
    if (duckAmount !== undefined && (typeof duckAmount !== 'number' || duckAmount < 0 || duckAmount > 1)) {
      this.error(layer.span, 'FS3038', `'duckAmount' must be a number from 0 to 1.`);
    }
  }

  private validateDucking(composition: Composition, layers: readonly IRLayer[]): void {
    const topLevelAudio = new Set(layers.filter(({type}) => type === 'audio').map(({id}) => id));
    const visit = (layer: IRLayer, source: Layer, depth: number): void => {
      const target = layer.props.duckUnder;
      if (typeof target === 'string') {
        if (depth > 0) this.error(source.span, 'FS3041', `'duckUnder' currently requires a top-level audio layer.`);
        else if (target === layer.id) this.error(source.span, 'FS3039', `Audio layer '${layer.id}' cannot duck under itself.`);
        else if (!topLevelAudio.has(target)) this.error(source.span, 'FS3040', `Audio layer '${layer.id}' ducks under unknown top-level audio layer '${target}'.`);
      }
      for (let index = 0; index < layer.children.length; index += 1) {
        visit(layer.children[index]!, source.children[index]!, depth + 1);
      }
    };
    for (let index = 0; index < layers.length; index += 1) {
      visit(layers[index]!, composition.layers[index]!, 0);
    }
  }

  private propertyMap(
    properties: readonly Property[],
    allowed: ReadonlySet<string>,
    owner: string,
    sourceKeyBase?: string,
  ): Map<string, IRValue> {
    const values = new Map<string, IRValue>();
    for (const property of properties) {
      if (sourceKeyBase) this.map(`${sourceKeyBase}/${sourceKey('property', property.name)}`, property.span);
      if (!allowed.has(property.name)) {
        this.error(property.span, 'FS3015', `Unknown ${owner} property '${property.name}'.`);
      }
      if (values.has(property.name)) {
        this.error(property.span, 'FS3016', `Duplicate property '${property.name}'.`);
      }
      values.set(property.name, this.resolveValue(property.value));
    }
    return values;
  }

  private resolveValue(value: Value): IRValue {
    switch (value.kind) {
      case 'literal': return value.value;
      case 'reference': return this.resolveReference(value.name, value.span);
      case 'array': return value.items.map((item) => this.resolveValue(item));
      case 'unary': {
        const operand = this.resolveValue(value.operand);
        if (typeof operand === 'number') {
          return value.operator === '-' ? -operand : operand;
        }
        if (typeof operand === 'string') {
          const unitValue = /^(\d+(?:\.\d+)?)([A-Za-z]+)$/u.exec(operand);
          if (unitValue) {
            return `${value.operator === '-' ? '-' : ''}${unitValue[1]}${unitValue[2]}`;
          }
        }
        this.error(value.span, 'FS3017', `Unary '${value.operator}' requires a number or numeric unit.`);
        return 0;
      }
      case 'unit': return `${value.value}${value.unit}`;
    }
  }

  private resolveReference(name: string, span: Span): IRValue {
    const cached = this.constants.get(name);
    if (cached !== undefined) return cached;
    if (this.assetNames.has(name)) return `asset:${name}`;
    const fontFamily = this.fontFamilies.get(name);
    if (fontFamily) return fontFamily;
    const node = this.constantNodes.get(name);
    if (!node) {
      this.error(span, 'FS3018', `Unknown reference '${name}'.`);
      return 0;
    }
    if (this.resolving.has(name)) {
      this.error(span, 'FS3019', `Circular constant reference involving '${name}'.`);
      return 0;
    }
    this.resolving.add(name);
    const value = this.resolveValue(node);
    this.resolving.delete(name);
    this.constants.set(name, value);
    return value;
  }

  private positiveInteger(value: IRValue | undefined, name: string, span: Span, fallback: number): number {
    if (value === undefined) {
      this.warning(span, 'FS3103', `Composition has no '${name}'; defaulting to ${fallback}.`);
      return fallback;
    }
    const numeric = this.numericPixels(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
      this.error(span, 'FS3020', `'${name}' must be a positive integer.`);
      return fallback;
    }
    return numeric;
  }

  private numericPixels(value: IRValue): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d+(?:\.\d+)?px$/u.test(value)) return Number.parseFloat(value);
    return Number.NaN;
  }

  private timeToFrames(value: IRValue, fps: number, label: string): number {
    if (typeof value === 'number') return Math.round(value);
    if (typeof value !== 'string') {
      this.error(this.program.span, 'FS3021', `${label} must use s, ms, or f units.`);
      return 0;
    }
    const match = /^(-?\d+(?:\.\d+)?)(s|ms|f)$/u.exec(value);
    if (!match) {
      this.error(this.program.span, 'FS3022', `${label} '${value}' must use s, ms, or f units.`);
      return 0;
    }
    const amount = Number(match[1]);
    const frames = match[2] === 's' ? amount * fps : match[2] === 'ms' ? amount * fps / 1000 : amount;
    const rounded = Math.round(frames);
    if (Math.abs(frames - rounded) > 0.000001) {
      this.warning(this.program.span, 'FS3104', `${label} '${value}' rounds to frame ${rounded} at ${fps}fps.`);
    }
    return rounded;
  }

  private error(span: Span, code: string, message: string): void {
    this.errors.push({code, message, severity: 'error', span, ...(span.sourceFile ? {file: span.sourceFile} : {})});
  }

  private warning(span: Span, code: string, message: string): void {
    this.warnings.push({code, message, severity: 'warning', span, ...(span.sourceFile ? {file: span.sourceFile} : {})});
  }

  private map(key: string, span: Span): void {
    if (span.sourceFile) this.sourceMappings[key] = span;
  }
}
