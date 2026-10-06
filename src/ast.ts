export interface Position {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface Span {
  readonly start: Position;
  readonly end: Position;
  readonly sourceFile?: string;
}

export interface Node {
  readonly span: Span;
}

export type Scalar = string | number | boolean;

export type Value =
  | ({readonly kind: 'literal'; readonly value: Scalar} & Node)
  | ({readonly kind: 'unit'; readonly value: number; readonly unit: string} & Node)
  | ({readonly kind: 'reference'; readonly name: string} & Node)
  | ({readonly kind: 'array'; readonly items: readonly Value[]} & Node)
  | ({readonly kind: 'unary'; readonly operator: '-' | '+'; readonly operand: Value} & Node);

export interface Property extends Node {
  readonly kind: 'property';
  readonly name: string;
  readonly value: Value;
}

export interface Constant extends Node {
  readonly kind: 'constant';
  readonly name: string;
  readonly value: Value;
}

export interface ImportSpecifier extends Node {
  readonly kind: 'importSpecifier';
  readonly imported: string;
  readonly importedSpan: Span;
  readonly local: string;
  readonly localSpan: Span;
}

export interface ImportDeclaration extends Node {
  readonly kind: 'import';
  readonly specifiers: readonly ImportSpecifier[];
  readonly source: string;
  readonly sourceSpan: Span;
}

export interface AssetDeclaration extends Node {
  readonly kind: 'asset';
  readonly name: string;
  readonly properties: readonly Property[];
}

export interface FontDeclaration extends Node {
  readonly kind: 'font';
  readonly name: string;
  readonly properties: readonly Property[];
}

export interface Keyframe extends Node {
  readonly kind: 'keyframe';
  readonly at: Value;
  readonly value: Value;
  readonly easing?: string;
}

export interface Animation extends Node {
  readonly kind: 'animation';
  readonly property: string;
  readonly keyframes: readonly Keyframe[];
}

export const LAYER_TYPES = [
  'group',
  'rect',
  'circle',
  'text',
  'image',
  'video',
  'audio',
] as const;

export type CoreLayerType = (typeof LAYER_TYPES)[number];
export type LayerType = string;

export interface Layer extends Node {
  readonly kind: 'layer';
  readonly layerType: LayerType;
  readonly name: string;
  readonly properties: readonly Property[];
  readonly animations: readonly Animation[];
  readonly children: readonly Layer[];
}

export interface Composition extends Node {
  readonly kind: 'composition';
  readonly name: string;
  readonly properties: readonly Property[];
  readonly layers: readonly Layer[];
}

export interface Program extends Node {
  readonly kind: 'program';
  readonly imports: readonly ImportDeclaration[];
  readonly constants: readonly Constant[];
  readonly assets: readonly AssetDeclaration[];
  readonly fonts: readonly FontDeclaration[];
  readonly compositions: readonly Composition[];
}
