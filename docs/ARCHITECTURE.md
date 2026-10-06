# FrameScript architecture

FrameScript is a renderer-neutral language for deterministic motion graphics.
The name is a working project name, not yet a registered product name.

## First principles

A reproducible video frame is a pure result:

```text
pixels(frame) = render(program IR, frame, declared inputs, pinned assets, fonts)
audio(time)   = mix(program IR, time, declared inputs, pinned assets)
```

Production rendering therefore needs five invariants:

1. **Determinism** — seeking directly to frame 900 must match playing to frame 900.
2. **Explicit time** — seconds and milliseconds are normalized to integer frames at compile time.
3. **Portable meaning** — the source compiles to a backend-neutral timeline IR, not React syntax.
4. **Early failure** — invalid duration, unknown references, duplicate names, and bad keyframes fail before rendering.
5. **Controlled escape hatches** — advanced renderers, shaders, and custom components enter through typed plugins rather than weakening the core language.

## Layered system

```text
.frame source
  -> module graph (named imports, aliases, cycle checks)
  -> lexer (tokens + exact spans)
  -> parser (loss-minimized AST)
  -> semantic analysis (names, units, time, constraints)
  -> canonical timeline IR (renderer contract)
  +> portable semantic source map (debugging sidecar)
  -> target adapter
       -> Remotion/React today
       -> Motion Canvas, WebGPU, native/FFmpeg later
  -> frames + audio -> encoder/package
```

The initial implementation deliberately keeps the parser dependency-free. A Tree-sitter grammar belongs in the editor-tooling phase, where incremental parsing and error recovery matter; the compiler AST remains the source of semantic truth.

## Core IR

The IR contains compositions, normalized frame metadata, ordered layers, resolved properties, and keyframe tracks. Time units are gone by this stage. Adapters must not invent timing behavior.

Layer order is paint order. A group establishes a nested coordinate system and timeline window. Each layer may define `from` and `duration`; its animation tracks use local frame time.

## Why adapters

Remotion has an excellent React ecosystem, browser rendering, audio/video primitives, server render APIs, and distributed-render options. It is also source-available rather than OSI open source. The core compiler is MIT and does not import Remotion. The generated Remotion project is an optional target with its own dependency/license obligations.

An MIT Motion Canvas adapter and an FFmpeg composition/encoding adapter can reuse the same IR. This prevents renderer licensing or API changes from becoming a language-breaking event.

## Production roadmap

### Layer 1 — compiler foundation (implemented now)

- Source spans and useful diagnostics
- Composition, layers, values, units, constants, and keyframes
- Semantic checks and normalized timeline IR
- Canonical formatter
- Standalone Remotion-project generator
- CLI and automated tests

### Layer 2 — authoring quality (implemented)

- Tree-sitter grammar with highlighting, folding, indentation, locals, and navigation tags
- Language Server Protocol server backed by compiler semantics, including semantic tokens, references, rename, and quick fixes
- Packaged VS Code extension with TextMate fallback, snippets, configuration, and bundled server
- Debounced watch compilation with serialized rebuilds and Remotion Studio refresh
- Named cross-file modules with aliases, cycle/missing-export diagnostics, dependency-aware watch roots, and declaring-module asset origins
- Workspace index with cross-file definition, references, rename, workspace symbols, and open-buffer-aware project diagnostics
- Versioned IR-to-source maps with relative paths, source hashes, semantic keys, CLI inspection, editor hover, and Remotion runtime error enrichment
- Remaining: editor integration tests inside Extension Host

### Layer 3 — production media (foundation implemented)

- Implemented: asset declarations, SHA-256 manifests, content-addressed copies, path containment, and remote asset preservation
- Implemented: local/remote font declarations and render-blocking font loading
- Implemented: audio/video trim, gain, fades, looping, muting, and playback rate
- Implemented: FFprobe stream/container metadata, SHA-256/versioned shared caches, source-mapped duration validation, opt-in EBU R128 loudness analysis, media manifests, and deterministic scheduled ducking
- Remaining: two-pass loudness normalization output, high-quality time stretch, signal-derived duck envelopes, captions, and color management
- Captions, text measurement, safe areas, color management, and alpha workflows
- Render manifest containing compiler, runtime, browser, codec, and asset versions

### Layer 4 — expressive graphics (plugin foundation implemented)

- Paths, masks, gradients, filters, blend modes, reusable symbols, constraints, and layouts
- Scene transitions and reusable animation presets
- Lottie/Rive/SVG, canvas, Three.js, WebGL/WebGPU shaders, particles, and physics baked to deterministic caches
- Implemented: versioned typed plugin SDK, schema validation, IR hooks, exact target dependencies, and static Remotion dispatch
- Remaining: plugin capability negotiation, isolation, signatures, and registry distribution

### Layer 5 — data and scale

- Typed external inputs with schemas and defaults
- Template packages and a registry with integrity signatures
- Parallel frame rendering, resumable jobs, render farms, and content-addressed caches
- Visual regression tests, frame hashes, performance budgets, telemetry, and audit logs

### Layer 6 — additional targets

- Motion Canvas adapter for an MIT-first interactive/vector workflow
- Headless WebGPU/native raster adapter for scale and predictable performance
- Direct FFmpeg filter-graph lowering for media-only compositions
- Interchange import/export where semantics permit: SVG, Lottie, OTIO, and subtitle formats

## Non-goals of the first slice

The first slice proves the language boundary; it does not pretend to provide a complete NLE, physics engine, shader compiler, or distributed renderer. Those systems should be added as IR capabilities with conformance tests, not as one-off syntax.
