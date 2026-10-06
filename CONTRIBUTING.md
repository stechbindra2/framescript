# Contributing

FrameScript is an experimental compiler with a deliberately strict deterministic core.

## Development

```sh
npm ci
npm run extension:install
npm run check
npm test
npm run grammar:generate
npm run extension:build
```

Compiler behavior changes require tests. Syntax changes must update the handwritten parser, formatter, Tree-sitter grammar, editor queries, documentation, and at least one corpus case.

Do not weaken determinism or semantic validation to support a target adapter. Add renderer-neutral IR capability first, then implement target lowering.

By contributing, you agree that your contribution is licensed under this repository's MIT license.
