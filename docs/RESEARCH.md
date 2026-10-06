# Research notes and decisions

Research date: 2026-10-05. Prefer primary project documentation before changing pinned integrations.

## Findings

- Remotion models a composition as a React component plus width, height, FPS, and duration. A renderer supplies the current frame, which matches FrameScript's deterministic frame model.
- Remotion's server renderer exposes composition discovery, still/frame rendering, and media rendering. Its transition package formalizes overlaps and timing constraints that should eventually live in the IR rather than generated JSX.
- Current Remotion documentation says the project is source-available and not OSI open source. Organizations and automation products must review its current license. Therefore Remotion is an optional adapter, not the compiler core.
- Tree-sitter is an incremental parser generator designed to keep producing useful trees during syntax errors. It is ideal for editor tooling, but requiring its native toolchain in the first compiler slice would slow portability.
- Motion Canvas is MIT-licensed and combines generator-authored TypeScript animations with a real-time editor. It is a strong second adapter, particularly for explanatory/vector animation.
- FFmpeg is LGPL 2.1+ by default, while optional GPL components change the combined license. Codec patent questions are separate from software copyright licensing.
- The Language Server Protocol standardizes completion, definitions, hover, symbols, formatting, and diagnostics across editors; the official Node implementation supports incremental document synchronization.
- Remotion's local-font API blocks rendering until a declared font is loaded, supporting deterministic generated projects.
- VS Code combines TextMate tokenization with semantic tokens layered on top, so FrameScript ships both immediate regex-based highlighting and compiler-aware semantic classification.
- Node's file watcher supports AbortSignal-controlled shutdown and recursive directory watching on current supported platforms, but retains platform-specific caveats; FrameScript therefore debounces and serializes rebuilds.
- FFprobe supports machine-readable JSON with explicit stream and container sections; FrameScript normalizes only selected stable fields and treats missing optional fields as absent.
- FFmpeg's `loudnorm` filter implements EBU R128 analysis and can emit JSON statistics. FrameScript uses this for opt-in cached analysis, while normalization output remains a separate future render stage.
- FFmpeg provides `sidechaincompress`, but FrameScript's first ducking primitive is timeline-scheduled so random-access frame rendering does not depend on replaying an audio detector from the beginning.

## Primary sources

- Remotion fundamentals: https://www.remotion.dev/docs/the-fundamentals
- Remotion timing: https://www.remotion.dev/docs/timing
- Remotion transitions: https://www.remotion.dev/docs/transitioning
- Remotion renderer: https://www.remotion.dev/docs/renderer
- Remotion license FAQ: https://www.remotion.dev/docs/license/faq
- Tree-sitter introduction: https://tree-sitter.github.io/
- Tree-sitter parser guide: https://tree-sitter.github.io/tree-sitter/creating-parsers/1-getting-started.html
- Motion Canvas repository/license: https://github.com/motion-canvas/motion-canvas
- FFmpeg legal/license guidance: https://ffmpeg.org/legal.html
- Language Server Protocol: https://microsoft.github.io/language-server-protocol/
- VS Code language-server Node implementation: https://github.com/microsoft/vscode-languageserver-node
- Remotion local fonts: https://www.remotion.dev/docs/fonts-api/load-font
- VS Code semantic highlighting: https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide
- Node file watching: https://nodejs.org/api/fs.html#fswatchfilename-options-listener
- FFprobe documentation: https://ffmpeg.org/ffprobe.html
- FFmpeg `loudnorm` and `sidechaincompress` filters: https://ffmpeg.org/ffmpeg-filters.html

These notes are engineering guidance, not legal advice.
