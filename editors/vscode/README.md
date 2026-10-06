# FrameScript for VS Code

Language support for `.frame` files:

- TextMate and semantic highlighting
- Diagnostics and quick fixes
- Completion and snippets
- Hover, definitions, references, and rename
- Document symbols and formatting
- Cross-file module indexing and workspace symbols
- Semantic source keys for runtime-diagnostic correlation

## Requirements

The language tooling is bundled. Node.js or a global FrameScript installation is not required for editor features. Building and rendering generated projects requires Node.js 22 or newer; media probing additionally uses FFprobe/FFmpeg when available.

## Getting started

```frame
composition Demo {
  width: 1920;
  height: 1080;
  fps: 30;
  duration: 3s;

  text title {
    text: "Hello from FrameScript";
    x: 960px;
    y: 540px;
    color: "white";
  }
}
```

This is an alpha extension. Use **FrameScript: Restart Language Server** if a workspace needs to be re-indexed manually.

Build from the repository root with `npm run extension:install` followed by `npm run extension:build`. Package a VSIX with `npm run extension:package`.
