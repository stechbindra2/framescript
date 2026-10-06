# Typed plugins

The compiler exports a versioned TypeScript plugin API from `src/plugins.ts`. Plugins register new layer types and property schemas without turning off semantic validation.

~~~ts
import type {FrameScriptPlugin} from 'framescript-workspace';

export const particles = {
  apiVersion: 1,
  name: 'particles',
  version: '1.0.0',
  layers: {
    particles: {
      properties: {
        count: {type: 'number', required: true},
        color: {type: 'color', animatable: true},
      },
    },
  },
  remotion: {
    particles: {
      packageName: '@example/framescript-particles',
      packageVersion: '1.0.0',
      exportName: 'ParticlesLayer',
    },
  },
} as const satisfies FrameScriptPlugin;
~~~

Pass plugins to both compilation and target generation:

~~~ts
const result = compile(source, {plugins: [particles]});
await generateRemotionProject(result.ir, {
  outputDirectory: 'generated',
  plugins: [particles],
});
~~~

A Remotion plugin component receives `layer`, `props`, and `frame`. Package names and exact versions are inserted into the generated project's dependencies, while imports and layer dispatch are generated statically. Plugins can additionally validate compiled layers and apply a deterministic IR transform.

Plugins are trusted compiler extensions: transformation hooks execute with the privileges of the host process. Do not load untrusted plugin code.
