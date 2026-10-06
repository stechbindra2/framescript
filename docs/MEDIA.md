# Media intelligence and audio control

FrameScript uses FFprobe during file-based builds to inspect local audio and video assets before rendering. Remote URLs are preserved but are not fetched during compilation.

## Asset probing

Local audio and video assets are probed by default:

```frame
asset narration {
  src: "media/narration.wav";
  type: "audio";
  loudness: true;
}
```

`probe: false` disables probing for an asset. `loudness: true` additionally runs full-file EBU R128 analysis, which is opt-in because it must decode the audio stream.

Normalized metadata includes duration, container, bitrate, codecs, stream types, video dimensions/frame rate/pixel format/color space, audio sample rate/channel layout, and optional loudness measurements.

Inspect media without generating a renderer project:

```sh
framec probe path/to/main.frame
```

## Cache

Probe results are stored under `.framescript/cache/media`. A cache key includes:

- SHA-256 of the media bytes;
- the exact FFprobe version line;
- FrameScript's media schema version;
- whether loudness analysis was enabled.

Writes are atomic. Changing the file, tool version, schema, or analysis mode produces a different cache entry.

Generated projects contain `media-manifest.json`, while normalized metadata is also attached to each asset in the generated timeline IR.

## Compile-time checks

When duration and stream metadata are available, FrameScript checks:

- an audio/video layer has a matching stream;
- `trimStart` and `trimEnd` fit within the source;
- trim-out follows trim-in;
- non-looping media has enough frames for the requested layer duration and playback rate.

Invalid trims and stream mismatches fail the build at the original `.frame` property. A short non-looping source currently produces a warning.

## Deterministic ducking

Ducking uses declared timeline intervals instead of nondeterministic live signal measurement:

```frame
audio music {
  src: soundtrack;
  duckUnder: "narration";
  duckAmount: 0.25;
  duckAttack: 200ms;
  duckRelease: 500ms;
}

audio narration {
  src: voice;
  from: 2s;
  duration: 4s;
}
```

`duckAmount` is the volume multiplier during ducking. The referenced audio layer must be top-level in the same composition. Attack and release are compiled to frames, making random-access rendering identical to sequential playback.

## Tooling behavior

Ordinary in-memory `compile()` remains independent of FFmpeg. Project builds use probing when FFprobe is available and report a warning when it is absent. `framec probe` is strict and fails when FFprobe cannot run.
