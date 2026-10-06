# FrameScript

FrameScript is an early, MIT-licensed language and compiler for deterministic animation and programmatic video. It compiles a compact `.frame` source file into a versioned timeline IR and then into a standalone Remotion project.

Projects can be split into explicit named modules:

```frame
import { brand as accent, logo } from "./theme.frame";
```

This repository currently contains the first complete vertical slice—not a claim that the full production roadmap is finished.

Once the public alpha is published, install the compiler with:

```sh
npm install --global framescript@next
framec --help
```

## Try it

Requires Node.js 22 or newer.

```sh
npm install
npm test
npm run grammar:generate
npm run framec -- check examples/product-launch.frame
npm run framec -- check examples/modules.frame
npm run framec -- build examples/product-launch.frame --out .framescript/product-launch
cd .framescript/product-launch
npm install
npm run studio
```

Render after generation:

```sh
npm run render -- ProductLaunch out/product-launch.mp4
```

## Commands

```text
framec check <file.frame> [--plugin module]
framec inspect <file.frame> [--plugin module]
framec map <file.frame> [--plugin module]
framec probe <file.frame> [--plugin module]
framec fmt <file.frame> [--write]
framec build <file.frame> [--out directory] [--plugin module]
framec watch <file.frame> [--out directory] [--plugin module]
```

Editor integrations can launch `npm run lsp` for diagnostics, completion, hover, symbols, definitions, and formatting. The Tree-sitter grammar and structural queries live in `tree-sitter-framescript/`; see [editor tooling](docs/EDITOR_TOOLING.md).

The build pipeline also supports content-addressed assets, local or remote font declarations, FFprobe-backed [media intelligence and deterministic ducking](docs/MEDIA.md), and portable [IR source maps](docs/SOURCE_MAPS.md). See the [language reference](docs/LANGUAGE.md). The [typed plugin API](docs/PLUGINS.md) adds validated custom layers and renderer contributions; plugins are trusted code and must be explicitly supplied.

Build and install the VS Code extension:

```sh
npm run extension:install
npm run extension:package
code --install-extension editors/vscode/dist/framescript-vscode.vsix
```

## Design

The compiler pipeline is:

```text
source -> tokens -> AST -> semantic checks -> timeline IR -> Remotion adapter
```

The renderer-neutral IR is the central design decision. See [architecture](docs/ARCHITECTURE.md), [language reference](docs/LANGUAGE.md), and [research notes](docs/RESEARCH.md).

## Licensing

The FrameScript compiler is MIT licensed. Generated Remotion projects depend on Remotion, whose current license is source-available rather than OSI open source. Review Remotion's license for the intended production use. Future renderer adapters can provide fully OSI-open stacks.

Release maintainers should follow the tested [publishing guide](docs/PUBLISHING.md).
