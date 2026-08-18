import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    host: 'src/host/index.ts',
    client: 'src/client/index.tsx',
  },
  format: ['iife'],
  outDir: 'dist',
  target: 'es2022',
  platform: 'browser',
  jsx: {
    factory: 'React.createElement',
    fragment: 'React.Fragment',
  },
  noExternal: ['*'],
  splitting: false,
  clean: true,
  minify: false,
  globalName: '__mpro',
  footer: {
    js: '\nreturn { apply: (typeof __mpro !== "undefined" && __mpro.apply) ? __mpro.apply : __mpro.default };',
  },
  onSuccess: 'node scripts/rename-output.mjs',
})
