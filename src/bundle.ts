import * as esbuild from 'https://deno.land/x/esbuild@v0.20.2/mod.js';
import {denoPlugins} from 'jsr:@luca/esbuild-deno-loader@0.10.3';

const result = await esbuild.build({
  plugins: [...denoPlugins()],
  entryPoints: ['./src/worker.ts'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'esnext',
  minify: true,
  sourcemap: false,
  treeShaking: true,
  write: false
});

await Deno.writeTextFile('./src/worker.min.js', result.outputFiles[0].text);

esbuild.stop();
