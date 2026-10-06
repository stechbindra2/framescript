# FrameScript language 0.1

Source files use the `.frame` extension. Statements may end with semicolons; the formatter always adds them.

## Modules

Top-level constants, assets, and fonts are module exports. Import only the names a file uses; aliases avoid local collisions:

```frame
import { brand as accent, logo } from "./theme.frame";
```

Module paths must be relative. The `.frame` extension is optional. Imports are resolved transitively, cycles and missing exports are compile errors, and compositions remain entry-file declarations rather than exports. Asset and font paths stay relative to the module that declares them.

Generated targets carry a separate semantic source map. See [source maps and runtime diagnostics](SOURCE_MAPS.md).

## Program

```frame
let accent = "#8b5cf6";

composition Demo {
  width: 1920;
  height: 1080;
  fps: 30;
  duration: 5s;
  background: "#080b16";
}
```

Composition IDs and layer IDs must be unique within their scope. Time accepts `s`, `ms`, and `f`. Visual dimensions accept numbers (pixels), `px`, or `pct`. Rotation uses `deg`.

## Assets and fonts

Assets are declared once and referenced by identifier. Local files are SHA-256 hashed and copied into the generated project's public/assets directory under a content-addressed name.

~~~frame
asset logo {
  src: \"assets/logo.png\";
  type: \"image\";
  probe: true;
}

font brand {
  src: \"assets/Brand.woff2\";
  family: \"Brand Sans\";
  weight: 700;
  style: \"normal\";
}

composition Demo {
  duration: 3s;
  image mark { src: logo; }
  text title { text: \"Hello\"; fontFamily: brand; }
}
~~~

Remote HTTPS assets stay remote. Local paths may not escape the source file's directory by default.

## Layers

Version 0.1 recognizes `rect`, `circle`, `text`, `image`, `video`, `audio`, and `group`.

```frame
text title {
  x: 960px;
  y: 540px;
  width: 1200px;
  text: "A deterministic title";
  color: "white";
  fontSize: 96px;
  fontWeight: 800;
}
```

Layer `from` and `duration` establish a local timeline window. Nested group layers are timed relative to the group.

Media paths resolve from the generated Remotion project's `public/` directory. HTTP, data, and blob URLs pass through directly.

Audio and video layers also support `trimStart`, `trimEnd`, `playbackRate`, `loop`, and `muted`. `fadeIn` and `fadeOut` multiply the declared volume using deterministic frame-local ramps.

Audio layers additionally support scheduled `duckUnder`, `duckAmount`, `duckAttack`, and `duckRelease`. Local audio/video assets are probed during project builds; `loudness: true` enables cached EBU R128 analysis. See [media intelligence](MEDIA.md).

## Animation

```frame
animate opacity {
  0s: 0;
  700ms: 1 ease out-cubic;
}
```

Keyframe time is local to the layer and must increase strictly. Supported easing names are:

- `linear`
- `in-quad`, `out-quad`, `in-out-quad`
- `in-cubic`, `out-cubic`, `in-out-cubic`
- `in-quart`, `out-quart`, `in-out-quart`
- `in-back`, `out-back`, `in-out-back`
- `step-start`, `step-end`

Numeric, compatible unit, and color tracks interpolate. Other values switch at the next keyframe.

## Current limits

- Values are literals, arrays, or constant references; arithmetic and functions are planned.
- Modules currently expose constants, assets, and fonts; explicit export visibility and reusable composition symbols are planned.
- Version 0.1 has one Remotion adapter.
- Font declarations, transitions, masks, paths, shader plugins, data schemas, and an audio graph are roadmap items.
- The generated runtime is intentionally readable and replaceable. The stable contract is the versioned IR.
