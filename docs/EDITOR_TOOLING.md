# Editor tooling

FrameScript supplies two complementary editor interfaces.

## Tree-sitter

The grammar is in `tree-sitter-framescript/`. It generates a concrete syntax tree designed to remain useful while a document is incomplete. Query files provide:

- syntax highlighting;
- folds for compositions, layers, animations, arrays, and block comments;
- indentation boundaries;
- constant definitions/references;
- composition and layer navigation tags.

Generate and test it with:

```sh
npm run grammar:generate
npm run grammar:test
```

Generation is platform-independent with the prebuilt Tree-sitter CLI. Native corpus execution requires a 64-bit C/C++ compiler. On Windows, use Visual Studio Build Tools with the Desktop C++ workload or a compatible 64-bit Clang toolchain.

## Language server

Start the server over standard input/output:

```sh
npm run lsp
```

Or after building:

```sh
node dist/src/lsp/server.js --stdio
```

The server advertises incremental document synchronization and provides:

- compiler-backed errors and warnings;
- context-sensitive snippets and completion;
- property, layer, easing, and constant hover information;
- cross-file go-to-definition for constants, assets, and fonts;
- hierarchical document symbols;
- whole-document formatting.
- semantic tokens layered over syntax highlighting;
- project-wide references, collision-checked rename, and workspace symbols;
- semantic IR source keys in hover for correlating editor nodes with `framescript.map.json`;
- quick fixes for omitted composition metadata.

The workspace index follows named imports and aliases across every `.frame` file. File watcher notifications invalidate the index, while unsaved open buffers override disk content.

```frame
import { accent, logo as heroLogo } from "./theme.frame";
```

The command writes only LSP messages to stdout. Editor adapters must launch it with `--stdio` and register `.frame` files with language ID `framescript`.

## VS Code extension

The packaged extension includes a TextMate grammar for immediate highlighting, snippets and bracket configuration, plus a bundled copy of the language server. No global FrameScript installation is required for language features.

```sh
npm run extension:install
npm run extension:package
code --install-extension editors/vscode/dist/framescript-vscode.vsix
```

Use **FrameScript: Restart Language Server** from the command palette if the server needs to be restarted.

## Continuous compilation

Keep a generated Remotion project synchronized with its source and local assets:

```sh
npm run framec -- watch examples/product-launch.frame --out .framescript/product-launch
```

The watcher debounces changes, serializes rebuilds, keeps running after compiler errors, and observes the common directory containing the entry and all transitive module dependencies. It excludes generated output to avoid feedback loops. Remotion Studio observes the rewritten generated modules and refreshes its preview.

## Neovim example

```lua
vim.filetype.add({extension = {frame = 'framescript'}})

vim.lsp.config.framescript = {
  cmd = {'node', '/absolute/path/to/framescript/dist/src/lsp/server.js', '--stdio'},
  filetypes = {'framescript'},
  root_markers = {'package.json', '.git'},
}
vim.lsp.enable('framescript')
```

Point a Tree-sitter parser configuration at `tree-sitter-framescript/` for structural highlighting.

## Helix example

Add the language server command and `.frame` file type to `languages.toml`, then set the grammar source to the `tree-sitter-framescript` directory or its eventual repository. The grammar name is `framescript` and the language scope is `source.framescript`.
