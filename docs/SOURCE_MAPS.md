# Source maps and runtime diagnostics

FrameScript emits a versioned `framescript.map.json` sidecar for every generated project. The timeline IR remains renderer-neutral and contains no machine-specific paths.

## Semantic keys

Mappings use stable semantic paths rather than generated JavaScript line numbers:

```text
composition/ModuleDemo
composition/ModuleDemo/property/duration
composition/ModuleDemo/layer/title
composition/ModuleDemo/layer/title/property/color
composition/ModuleDemo/layer/title/animation/opacity/keyframe/1
asset/logo
font/brand
```

Segments are URI-encoded. Nested layers append another `layer/<id>` pair.

## Portability and integrity

The source table stores project-relative `/`-separated paths and a SHA-256 hash of each source file. Absolute workstation paths are excluded. Consumers can compare the hash before displaying a location to detect a stale source map.

Inspect a map without generating a target project:

```sh
framec map examples/modules.frame
```

VS Code hover displays the semantic IR key for mapped declarations and properties.

## Remotion failures

Generated Remotion projects include `FrameScriptRuntimeBoundary.tsx`. Composition and layer boundaries catch render-time React errors, resolve the nearest semantic mapping, and rethrow an error containing a location such as:

```text
FrameScript source: modules.frame:10:3 [composition/ModuleDemo/layer/title]
```

The nearest mapped ancestor is used when a plugin creates runtime structure that has no more-specific source entry. The boundary rethrows rather than rendering a fallback, so failed production renders remain failed.
