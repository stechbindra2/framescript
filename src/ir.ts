import type {LayerType, Scalar} from './ast.js';

export type IRValue = Scalar | readonly IRValue[];

export interface IRKeyframe {
  readonly frame: number;
  readonly value: IRValue;
  readonly easing: string;
}

export interface IRAnimation {
  readonly property: string;
  readonly keyframes: readonly IRKeyframe[];
}

export interface IRLayer {
  readonly id: string;
  readonly type: LayerType;
  readonly plugin?: string;
  readonly from: number;
  readonly duration: number;
  readonly props: Readonly<Record<string, IRValue>>;
  readonly animations: readonly IRAnimation[];
  readonly children: readonly IRLayer[];
}

export type IRAssetKind = 'image' | 'video' | 'audio' | 'font' | 'data' | 'binary';

export interface IRMediaStream {
  readonly index: number;
  readonly type: 'audio' | 'video' | 'subtitle' | 'data' | 'attachment' | 'unknown';
  readonly codec?: string;
  readonly durationSeconds?: number;
  readonly bitRate?: number;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly pixelFormat?: string;
  readonly colorSpace?: string;
  readonly sampleRate?: number;
  readonly channels?: number;
  readonly channelLayout?: string;
}

export interface IRAudioLoudness {
  readonly integratedLufs: number;
  readonly loudnessRangeLu: number;
  readonly truePeakDbfs: number;
  readonly thresholdLufs: number;
  readonly targetOffsetDb: number;
}

export interface IRMediaMetadata {
  readonly schema: 'framescript-media';
  readonly version: 1;
  readonly format?: string;
  readonly durationSeconds?: number;
  readonly bitRate?: number;
  readonly streams: readonly IRMediaStream[];
  readonly loudness?: IRAudioLoudness;
}

export interface IRAsset {
  readonly id: string;
  readonly kind: IRAssetKind;
  readonly source: string;
  readonly sourceDirectory?: string;
  readonly probe: boolean;
  readonly analyzeLoudness: boolean;
  readonly media?: IRMediaMetadata;
  readonly hash?: string;
  readonly bytes?: number;
  readonly publicPath?: string;
}

export interface IRFont {
  readonly id: string;
  readonly family: string;
  readonly source: string;
  readonly sourceDirectory?: string;
  readonly weight: number | string;
  readonly style: string;
}

export interface IRComposition {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly background: string;
  readonly layers: readonly IRLayer[];
}

export interface TimelineIR {
  readonly schema: 'framescript-ir';
  readonly version: 1;
  readonly assets: readonly IRAsset[];
  readonly fonts: readonly IRFont[];
  readonly compositions: readonly IRComposition[];
}
