import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { createDevServer } from './dev-server.mjs';

const { positionals: [mode = 'dev'], values } = parseArgs({ allowPositionals: true, options: {
  port: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, strictPort: { type: 'boolean' },
} });
if (!['dev', 'build', 'preview'].includes(mode)) throw new Error('Expected dev, build or preview');
if (values.host !== '127.0.0.1') throw new Error('Development and preview bind only to 127.0.0.1');
const port = Number(values.port ?? (mode === 'preview' ? 4173 : 5173));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const output = resolve(mode === 'dev' ? '.cache/dev' : 'dist');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' };
let files = new Map();
const options = {
  entryPoints: ['src/main.tsx'], bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic',
  outdir: `${output}/assets`, entryNames: '[name]-[hash]', metafile: true, minify: mode !== 'dev',
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'dev' ? 'development' : 'production') },
  plugins: [{ name: 'html-and-assets', setup(builder) { builder.onEnd(async result => {
    if (result.errors.length) return;
    const outputs = Object.entries(result.metafile.outputs);
    const [scriptPath, script] = outputs.find(([, entry]) => entry.entryPoint === 'src/main.tsx');
    const html = (await readFile('index.html', 'utf8'))
      .replace('/src/main.tsx', `/assets/${basename(scriptPath)}`)
      .replace('</head>', `<link rel="stylesheet" href="/assets/${basename(script.cssBundle)}" />\n  </head>`);
    await writeFile(`${output}/index.html`, html);
    const next = new Map([['/index.html', { body: Buffer.from(html), type: 'text/html' }]]);
    for (const [path] of outputs) {
      next.set(`/assets/${basename(path)}`, { body: await readFile(path), type: path.endsWith('.css') ? 'text/css' : 'text/javascript' });
    }
    for (const name of await readdir('public')) {
      const body = await readFile(`public/${name}`);
      await writeFile(`${output}/${name}`, body);
      next.set(`/${name}`, { body, type: mime[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream' });
    }
    files = next;
  }); } }],
};

await mkdir(output, { recursive: true });
if (mode === 'build') {
  await build(options);
} else {
  let builder;
  if (mode === 'dev') {
    builder = await context(options);
    await builder.rebuild();
    await builder.watch();
  } else {
    for (const folder of ['', '/assets']) {
      for (const name of await readdir(output + folder)) {
        if (!name.includes('.')) continue;
        files.set(`${folder}/${name}`, { body: await readFile(`${output}${folder}/${name}`), type: mime[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream' });
      }
    }
  }
  const server = createDevServer({ apiTarget: process.env.ORDEROPS_API_TARGET ?? 'http://127.0.0.1:8080', files: () => files });
  const close = async () => { server.closeAllConnections(); server.close(); await builder?.dispose(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  server.once('error', async error => { console.error(error.message); await close(); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`OrderOps ${mode}: http://127.0.0.1:${port} (PID ${process.pid})`));
}
