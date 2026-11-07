import { build } from 'esbuild'
await build({ entryPoints: ['src/index.ts'], outdir: 'lib', platform: 'node', format: 'esm', bundle: true, packages: 'external', target: 'es2022' })
await build({ entryPoints: ['src/client/index.tsx'], outfile: 'lib/client.js', platform: 'browser', format: 'cjs', bundle: true,
  external: ['react', 'react/*'], jsx: 'automatic', target: 'es2022', loader: { '.css': 'text' },
  banner: { js: 'window.__ModuleLoader__.load({id:"@missher/dsh-dashboard",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' } })
