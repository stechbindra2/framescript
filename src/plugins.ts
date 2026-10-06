import type {IRLayer, IRValue, TimelineIR} from './ir.js';
import {LAYER_TYPES} from './ast.js';

export type PluginValueType = 'string' | 'number' | 'boolean' | 'array' | 'dimension' | 'time' | 'color' | 'any';

export interface PluginPropertySchema {
  readonly type: PluginValueType;
  readonly required?: boolean;
  readonly animatable?: boolean;
  readonly documentation?: string;
}

export interface PluginLayerDefinition {
  readonly documentation?: string;
  readonly allowCoreProperties?: boolean;
  readonly properties: Readonly<Record<string, PluginPropertySchema>>;
}

export interface RemotionPluginLayer {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly exportName: string;
}

export interface FrameScriptPlugin {
  readonly apiVersion: 1;
  readonly name: string;
  readonly version: string;
  readonly layers: Readonly<Record<string, PluginLayerDefinition>>;
  readonly remotion?: Readonly<Record<string, RemotionPluginLayer>>;
  readonly transformIR?: (ir: TimelineIR) => TimelineIR;
  readonly validateLayer?: (layer: IRLayer) => readonly string[];
}

export class PluginRegistry {
  private readonly layerOwners = new Map<string, FrameScriptPlugin>();

  public constructor(public readonly plugins: readonly FrameScriptPlugin[] = []) {
    const names = new Set<string>();
    for (const plugin of plugins) {
      if (plugin.apiVersion !== 1) throw new Error(`Plugin '${plugin.name}' uses unsupported API ${plugin.apiVersion}.`);
      if (names.has(plugin.name)) throw new Error(`Duplicate plugin '${plugin.name}'.`);
      names.add(plugin.name);
      for (const layerType of Object.keys(plugin.layers)) {
        if ((LAYER_TYPES as readonly string[]).includes(layerType)) {
          throw new Error(`Plugin '${plugin.name}' cannot replace core layer type '${layerType}'.`);
        }
        const owner = this.layerOwners.get(layerType);
        if (owner) throw new Error(`Layer type '${layerType}' is registered by both '${owner.name}' and '${plugin.name}'.`);
        this.layerOwners.set(layerType, plugin);
      }
    }
  }

  public ownerOf(layerType: string): FrameScriptPlugin | undefined {
    return this.layerOwners.get(layerType);
  }

  public definitionOf(layerType: string): PluginLayerDefinition | undefined {
    return this.ownerOf(layerType)?.layers[layerType];
  }

  public validateProperty(type: PluginValueType, value: IRValue): boolean {
    switch (type) {
      case 'any': return true;
      case 'array': return Array.isArray(value);
      case 'string': return typeof value === 'string';
      case 'number': return typeof value === 'number';
      case 'boolean': return typeof value === 'boolean';
      case 'time': return typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:s|ms|f)$/u.test(value);
      case 'dimension': return typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:px|pct)$/u.test(value));
      case 'color': return typeof value === 'string';
    }
  }

  public transform(ir: TimelineIR): TimelineIR {
    return this.plugins.reduce((current, plugin) => plugin.transformIR?.(current) ?? current, ir);
  }
}
