import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(projectRoot, 'src', 'styles');

function findTokens(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    for (const candidate of [join(dir, 'design', 'tokens.json'), join(dir, 'development', 'design', 'tokens.json')]) {
      if (existsSync(candidate)) return candidate;
    }
    if (dir === dirname(dir)) return null;
  }
}

const tokensPath = findTokens(projectRoot);
if (!tokensPath) {
  const cssOut = join(outDir, 'tokens.css');
  const tsOut = join(outDir, 'tokens.generated.ts');
  if (existsSync(cssOut) && existsSync(tsOut)) {
    console.log('tokens: design/tokens.json not present; using committed src/styles/tokens.*');
    process.exit(0);
  }
  throw new Error(`design/tokens.json not found above ${projectRoot} and committed token outputs are missing`);
}
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
const banner = 'Generated from design/tokens.json by scripts/build-tokens.mjs. Do not edit.';

const declarations = (entries) => entries.map(([name, value]) => `  --${name}: ${value};`).join('\n');

const group = (prefix, values) => Object.entries(values).map(([name, value]) => [`${prefix}-${name}`, value]);

const shared = [
  ['font-display', tokens.type['family-display']],
  ['font-body', tokens.type['family-body']],
  ...group('size', tokens.type.size),
  ...group('line', tokens.type.line),
  ...group('tracking', tokens.type.tracking),
  ...group('radius', tokens.radius),
  ...group('space', tokens.space),
  ['target-min', tokens['target-min']],
  ['target-primary', tokens['target-primary']],
  ['motion-duration', tokens.motion.duration],
  ['motion-easing', tokens.motion.easing],
];

const colorSchemes = tokens.schemes;
const defaultTheme = tokens['default-theme'];
const themeBlocks = Object.entries(tokens.themes).map(([name, colors]) => {
  const selector = name === defaultTheme ? `:root,\n:root[data-theme='${name}']` : `:root[data-theme='${name}']`;
  return `${selector} {\n  color-scheme: ${colorSchemes[name]};\n${declarations(Object.entries(colors))}\n}`;
});

// Paper is printed in the light theme whatever the screen shows, so a dark screen never costs a page of ink.
const printColors = declarations(Object.entries(tokens.themes[tokens['print-theme']])).replace(/^/gm, '  ');
const printBlock = `@media print {\n  :root,\n  :root[data-theme] {\n    color-scheme: light;\n${printColors}\n  }\n}`;

const css = `/* ${banner} */\n:root {\n${declarations(shared)}\n}\n\n${themeBlocks.join('\n\n')}\n\n${printBlock}\n`;

const ts = `// ${banner}
export const themes = ${JSON.stringify(tokens.themes, null, 2)} as const;

export type ThemeName = keyof typeof themes;
export type ThemeColors = Record<keyof (typeof themes)['${defaultTheme}'], string>;
export const DEFAULT_THEME: ThemeName = '${defaultTheme}';
`;

writeFileSync(join(outDir, 'tokens.css'), css);
writeFileSync(join(outDir, 'tokens.generated.ts'), ts);
console.log(`tokens: ${tokensPath} -> src/styles/tokens.css, src/styles/tokens.generated.ts`);
