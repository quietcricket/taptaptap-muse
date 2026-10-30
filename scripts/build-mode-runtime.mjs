import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Build the original game shell once. Only its entry changes; generated code
// cannot edit the shell, engine, styles, dependencies, or build configuration.
const shell = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const result = await build({
  configFile: false,
  mode: 'mode-preview',
  base: './',
  plugins: [
    {
      name: 'mode-preview-shell',
      transformIndexHtml: {
        order: 'pre',
        handler: () => shell.replace('/src/main.ts', '/src/preview.ts'),
      },
    },
  ],
  build: {
    write: false,
    assetsInlineLimit: Infinity,
    cssCodeSplit: false,
    rollupOptions: {
      input: 'index.html',
      output: { inlineDynamicImports: true },
    },
  },
});
const output = result.output;
let html = String(output.find((file) => file.fileName === 'index.html').source);
for (const file of output) {
  if (file.type === 'chunk') {
    // Data URLs prevent script text from terminating an HTML script element.
    const url = `data:text/javascript;base64,${Buffer.from(file.code).toString('base64')}`;
    html = html.replace(
      /<script\b[^>]*src="[^"]+"[^>]*><\/script>/,
      () => `<script type="module" src="${url}"></script>`,
    );
  } else if (file.fileName.endsWith('.css')) {
    const url = `data:text/css;base64,${Buffer.from(file.source).toString('base64')}`;
    html = html.replace(
      /<link\b[^>]*rel="stylesheet"[^>]*>/,
      () => `<link rel="stylesheet" href="${url}">`,
    );
  }
}
html = html.replace(
  '<body>',
  '<body><script id="mode-code" type="application/json">"__MODE_CODE__"</script>',
);
await mkdir('dist', { recursive: true });
await writeFile('dist/mode-runtime.json', JSON.stringify({ html }));
