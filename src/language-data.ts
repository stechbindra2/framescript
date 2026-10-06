import {LAYER_TYPES} from './ast.js';

export interface LanguageItem {
  readonly name: string;
  readonly detail: string;
  readonly documentation: string;
  readonly insertText?: string;
}

export const COMPOSITION_PROPERTIES: readonly LanguageItem[] = [
  {name: 'width', detail: 'positive integer', documentation: 'Canvas width in pixels.', insertText: 'width: 1920;'},
  {name: 'height', detail: 'positive integer', documentation: 'Canvas height in pixels.', insertText: 'height: 1080;'},
  {name: 'fps', detail: 'positive integer', documentation: 'Frames rendered per second.', insertText: 'fps: 30;'},
  {name: 'duration', detail: 'time', documentation: 'Composition duration using s, ms, or f.', insertText: 'duration: 5s;'},
  {name: 'background', detail: 'color', documentation: 'Composition background color.', insertText: 'background: "#000000";'},
];

export const LAYER_PROPERTIES: readonly LanguageItem[] = [
  {name: 'x', detail: 'dimension', documentation: 'Horizontal center position.'},
  {name: 'y', detail: 'dimension', documentation: 'Vertical center position.'},
  {name: 'width', detail: 'dimension', documentation: 'Layer width.'},
  {name: 'height', detail: 'dimension', documentation: 'Layer height.'},
  {name: 'opacity', detail: 'number', documentation: 'Opacity from 0 to 1.'},
  {name: 'rotate', detail: 'angle', documentation: 'Layer rotation, normally in deg.'},
  {name: 'scale', detail: 'number', documentation: 'Uniform layer scale.'},
  {name: 'fill', detail: 'color', documentation: 'Shape or container fill.'},
  {name: 'color', detail: 'color', documentation: 'Text foreground color.'},
  {name: 'radius', detail: 'dimension', documentation: 'Corner radius.'},
  {name: 'fontSize', detail: 'dimension', documentation: 'Text font size.'},
  {name: 'fontWeight', detail: 'number|string', documentation: 'Text font weight.'},
  {name: 'fontFamily', detail: 'string', documentation: 'CSS font family.'},
  {name: 'fontStyle', detail: 'string', documentation: 'CSS font style.'},
  {name: 'lineHeight', detail: 'number', documentation: 'Text line-height multiplier.'},
  {name: 'letterSpacing', detail: 'dimension', documentation: 'Text letter spacing.'},
  {name: 'textAlign', detail: 'string', documentation: 'Text alignment.'},
  {name: 'text', detail: 'string', documentation: 'Text layer content.'},
  {name: 'src', detail: 'string', documentation: 'Media path under public/ or an absolute URL.'},
  {name: 'probe', detail: 'boolean', documentation: 'Enable build-time FFprobe metadata extraction for a local media asset.'},
  {name: 'loudness', detail: 'boolean', documentation: 'Run cached EBU R128 loudness analysis for a local audio asset.'},
  {name: 'objectFit', detail: 'string', documentation: 'Media fitting mode.'},
  {name: 'volume', detail: 'number', documentation: 'Audio volume from 0 to 1.'},
  {name: 'muted', detail: 'boolean', documentation: 'Whether media audio is muted.'},
  {name: 'playbackRate', detail: 'number', documentation: 'Media playback-rate multiplier.'},
  {name: 'trimStart', detail: 'time', documentation: 'Media source trim-in point.'},
  {name: 'trimEnd', detail: 'time', documentation: 'Media source trim-out point.'},
  {name: 'fadeIn', detail: 'time', documentation: 'Audio fade-in duration.'},
  {name: 'fadeOut', detail: 'time', documentation: 'Audio fade-out duration.'},
  {name: 'duckUnder', detail: 'string', documentation: 'Audio layer ID whose active interval ducks this layer.'},
  {name: 'duckAmount', detail: 'number', documentation: 'Volume multiplier while ducked, from 0 to 1.'},
  {name: 'duckAttack', detail: 'time', documentation: 'Ducking fade-down duration.'},
  {name: 'duckRelease', detail: 'time', documentation: 'Ducking recovery duration.'},
  {name: 'loop', detail: 'boolean', documentation: 'Loop media for the layer duration.'},
  {name: 'from', detail: 'time', documentation: 'Start on the parent timeline.'},
  {name: 'duration', detail: 'time', documentation: 'Duration on the parent timeline.'},
  {name: 'padding', detail: 'dimension', documentation: 'Container padding.'},
  {name: 'gap', detail: 'dimension', documentation: 'Gap between group children.'},
  {name: 'direction', detail: 'row|column', documentation: 'Group flex direction.'},
  {name: 'align', detail: 'string', documentation: 'Group cross-axis alignment.'},
  {name: 'justify', detail: 'string', documentation: 'Group main-axis alignment.'},
  {name: 'overflow', detail: 'string', documentation: 'Layer overflow behavior.'},
  {name: 'stroke', detail: 'color', documentation: 'Shape outline color.'},
  {name: 'strokeWidth', detail: 'dimension', documentation: 'Shape outline width.'},
  {name: 'shadow', detail: 'array', documentation: 'CSS box-shadow components.'},
  {name: 'blur', detail: 'dimension', documentation: 'CSS blur radius.'},
];

export const ANIMATABLE_PROPERTIES = [
  'x', 'y', 'width', 'height', 'opacity', 'rotate', 'scale', 'radius', 'fontSize',
  'lineHeight', 'letterSpacing', 'volume', 'playbackRate', 'blur', 'fill', 'color',
] as const;

export const EASING_NAMES = [
  'linear', 'in-quad', 'out-quad', 'in-out-quad', 'in-cubic', 'out-cubic',
  'in-out-cubic', 'in-quart', 'out-quart', 'in-out-quart', 'in-back',
  'out-back', 'in-out-back', 'step-start', 'step-end',
] as const;

export const LAYER_ITEMS: readonly LanguageItem[] = LAYER_TYPES.map((name) => ({
  name,
  detail: 'layer type',
  documentation: `${name[0]?.toUpperCase()}${name.slice(1)} layer.`,
  insertText: `${name} name {\n  \n}`,
}));

export const PROPERTY_BY_NAME = new Map(
  [...COMPOSITION_PROPERTIES, ...LAYER_PROPERTIES].map((item) => [item.name, item]),
);
