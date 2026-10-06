import type {
  Animation,
  AssetDeclaration,
  Composition,
  Constant,
  FontDeclaration,
  ImportDeclaration,
  Layer,
  Program,
  Property,
  Value,
} from './ast.js';

export function format(program: Program): string {
  const blocks = [
    ...program.imports.map(formatImport),
    ...program.constants.map(formatConstant),
    ...program.assets.map(formatAsset),
    ...program.fonts.map(formatFont),
    ...program.compositions.map(formatComposition),
  ];
  return `${blocks.join('\n\n')}\n`;
}

function formatImport(declaration: ImportDeclaration): string {
  const names = declaration.specifiers
    .map(({imported, local}) => imported === local ? imported : `${imported} as ${local}`)
    .join(', ');
  return `import { ${names} } from ${JSON.stringify(declaration.source)};`;
}

function formatAsset(asset: AssetDeclaration): string {
  return formatResource('asset', asset.name, asset.properties);
}

function formatFont(font: FontDeclaration): string {
  return formatResource('font', font.name, font.properties);
}

function formatResource(kind: string, name: string, properties: readonly Property[]): string {
  return `${kind} ${name} {\n${properties.map((property) => formatProperty(property, 1)).join('\n')}\n}`;
}

function formatConstant(constant: Constant): string {
  return `let ${constant.name} = ${formatValue(constant.value)};`;
}

function formatComposition(composition: Composition): string {
  const body = [
    ...composition.properties.map((property) => formatProperty(property, 1)),
    ...composition.layers.map((layer) => formatLayer(layer, 1)),
  ];
  return `composition ${composition.name} {\n${body.join('\n')}\n}`;
}

function formatLayer(layer: Layer, depth: number): string {
  const indentation = '  '.repeat(depth);
  const body = [
    ...layer.properties.map((property) => formatProperty(property, depth + 1)),
    ...layer.animations.map((animation) => formatAnimation(animation, depth + 1)),
    ...layer.children.map((child) => formatLayer(child, depth + 1)),
  ];
  return `${indentation}${layer.layerType} ${layer.name} {\n${body.join('\n')}\n${indentation}}`;
}

function formatProperty(property: Property, depth: number): string {
  return `${'  '.repeat(depth)}${property.name}: ${formatValue(property.value)};`;
}

function formatAnimation(animation: Animation, depth: number): string {
  const indentation = '  '.repeat(depth);
  const keyframes = animation.keyframes.map((keyframe) => {
    const easing = keyframe.easing ? ` ease ${keyframe.easing}` : '';
    return `${'  '.repeat(depth + 1)}${formatValue(keyframe.at)}: ${formatValue(keyframe.value)}${easing};`;
  });
  return `${indentation}animate ${animation.property} {\n${keyframes.join('\n')}\n${indentation}}`;
}

function formatValue(value: Value): string {
  switch (value.kind) {
    case 'literal': return typeof value.value === 'string' ? JSON.stringify(value.value) : String(value.value);
    case 'unit': return `${value.value}${value.unit}`;
    case 'reference': return value.name;
    case 'array': return `[${value.items.map(formatValue).join(', ')}]`;
    case 'unary': return `${value.operator}${formatValue(value.operand)}`;
  }
}
