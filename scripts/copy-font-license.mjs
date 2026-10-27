import { copyFile } from 'node:fs/promises';
await copyFile(
  new URL(
    '../node_modules/@fontsource-variable/fredoka/LICENSE',
    import.meta.url,
  ),
  new URL('../dist/FREDOKA-LICENSE.txt', import.meta.url),
);
