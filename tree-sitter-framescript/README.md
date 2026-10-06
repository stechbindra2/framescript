# tree-sitter-framescript

Incremental concrete-syntax grammar for FrameScript.

```sh
npm run grammar:generate
npm run grammar:test
npm run grammar:parse -- examples/product-launch.frame
```

`grammar:generate` validates the grammar and refreshes `src/parser.c`, `src/grammar.json`, and `src/node-types.json`. Native parsing and corpus tests also require a 64-bit C/C++ compiler supported by Tree-sitter.

Queries are provided for highlighting, folding, indentation, local constants, and navigation tags. The compiler parser under `src/` remains authoritative for semantic analysis.
