import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Trusted compiler entry. Never import or run the submitted module here.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Expected input and output paths');
const source = await readFile(input, 'utf8');
if (Buffer.byteLength(source) > 128_000)
  throw new Error('Mode source is too large');
const parsed = ts.createSourceFile(
  input,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const classes = parsed.statements.filter(ts.isClassDeclaration);
if (
  classes.length !== 1 ||
  classes[0].name?.text !== 'CustomMode' ||
  !classes[0].modifiers?.some(
    (item) => item.kind === ts.SyntaxKind.DefaultKeyword,
  ) ||
  !classes[0].modifiers?.some(
    (item) => item.kind === ts.SyntaxKind.ExportKeyword,
  ) ||
  parsed.statements.some(
    (item) =>
      !ts.isImportDeclaration(item) &&
      !ts.isClassDeclaration(item) &&
      !ts.isInterfaceDeclaration(item) &&
      !ts.isTypeAliasDeclaration(item),
  )
)
  throw new Error(
    'Export exactly one default class named CustomMode, plus imports and type declarations',
  );

const sharedImports = new Set([
  '@taptaptap/modes/shared/writing',
  '@taptaptap/modes/shared/writing-layout',
  '@taptaptap/modes/shared/stories',
]);
for (const statement of parsed.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  const name = (statement.moduleSpecifier as ts.StringLiteral).text;
  if (name === '@taptaptap/engine/types' && statement.importClause?.isTypeOnly)
    continue;
  if (name === 'pixi.js' || name === 'matter-js' || sharedImports.has(name))
    continue;
  throw new Error(`Unsupported mode import: ${name}`);
}
function checkCalls(node: ts.Node): void {
  if (
    ts.isImportEqualsDeclaration(node) ||
    (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')))
  )
    throw new Error('Use only the allowed static imports');
  ts.forEachChild(node, checkCalls);
}
checkCalls(parsed);
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  esModuleInterop: true,
  baseUrl: root,
  paths: { '@taptaptap/*': ['src/*'] },
  types: [],
};
// Resolve package types from the app, not the temporary output directory.
const host = ts.createCompilerHost(options);
const virtual = resolve(root, 'studio-mode.ts');
const contract = resolve(root, 'studio-mode-contract.ts');
const files = new Map([
  [virtual, source],
  [
    contract,
    `import CustomMode from './studio-mode';
import type { ModeDefinition } from './src/engine/types';
const mode: ModeDefinition = {
  id: 'custom', name: 'Custom', symbol: '✦', description: 'Custom mode',
  create: context => new CustomMode(context),
};`,
  ],
]);
const originalRead = host.readFile.bind(host);
const originalExists = host.fileExists.bind(host);
host.readFile = (path) => files.get(path) ?? originalRead(path);
host.fileExists = (path) => files.has(path) || originalExists(path);
host.getSourceFile = (path, languageVersion) => {
  const text = host.readFile(path);
  return text === undefined
    ? undefined
    : ts.createSourceFile(path, text, languageVersion, true);
};
const program = ts.createProgram([virtual, contract], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  throw new Error(
    ts.formatDiagnostics(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    }),
  );
}
// Bun parses and bundles modules; submitted code is never evaluated. The large
// libraries are already in the immutable browser runtime, so keep them external.
const bundled = await Bun.build({
  entrypoints: [input],
  target: 'browser',
  format: 'esm',
  minify: true,
  external: ['pixi.js', 'matter-js'],
  plugins: [
    {
      name: 'trusted-mode-helpers',
      setup(build) {
        build.onResolve({ filter: /^@taptaptap\// }, ({ path }) => ({
          path: resolve(root, 'src', path.slice('@taptaptap/'.length) + '.ts'),
        }));
      },
    },
  ],
});
if (!bundled.success || bundled.outputs.length !== 1)
  throw new Error('Mode bundling failed');
const javascript = await bundled.outputs[0].text();
// Replace external library imports with references provided by preview.ts.
// This transformer works on syntax nodes, including aliases and namespaces.
const compiled = ts.transpileModule(javascript, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
  transformers: {
    before: [
      (context) => (file) => {
        const statements: ts.Statement[] = [];
        for (const statement of file.statements) {
          if (!ts.isImportDeclaration(statement)) {
            statements.push(statement);
            continue;
          }
          const name = (statement.moduleSpecifier as ts.StringLiteral).text;
          if (name !== 'pixi.js' && name !== 'matter-js')
            throw new Error('Unexpected bundled import');
          const library = ts.factory.createPropertyAccessExpression(
            ts.factory.createPropertyAccessExpression(
              ts.factory.createIdentifier('globalThis'),
              '__taptaptap',
            ),
            name === 'pixi.js' ? 'pixi' : 'matter',
          );
          const clause = statement.importClause;
          const variables: ts.VariableDeclaration[] = [];
          if (clause?.name)
            variables.push(
              ts.factory.createVariableDeclaration(
                clause.name,
                undefined,
                undefined,
                library,
              ),
            );
          const bindings = clause?.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings)) {
            variables.push(
              ts.factory.createVariableDeclaration(
                bindings.name,
                undefined,
                undefined,
                library,
              ),
            );
          } else if (bindings) {
            const pattern = ts.factory.createObjectBindingPattern(
              bindings.elements.map((item) =>
                ts.factory.createBindingElement(
                  undefined,
                  item.propertyName,
                  item.name,
                ),
              ),
            );
            variables.push(
              ts.factory.createVariableDeclaration(
                pattern,
                undefined,
                undefined,
                library,
              ),
            );
          }
          if (variables.length)
            statements.push(
              ts.factory.createVariableStatement(
                undefined,
                ts.factory.createVariableDeclarationList(
                  variables,
                  ts.NodeFlags.Const,
                ),
              ),
            );
        }
        return context.factory.updateSourceFile(file, statements);
      },
    ],
  },
}).outputText;
if (Buffer.byteLength(compiled) > 256_000)
  throw new Error('Compiled mode is too large');
await writeFile(output, compiled);
