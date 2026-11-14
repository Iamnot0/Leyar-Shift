import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function findContract(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    for (const candidate of [join(dir, 'backend', 'openapi.yaml')]) {
      if (existsSync(candidate)) return candidate;
    }
    if (dir === dirname(dir)) return null;
  }
}

const contractPath = findContract(projectRoot);
const schemaOut = join(projectRoot, 'src', 'api', 'schema.generated.ts');
if (!contractPath) {
  if (existsSync(schemaOut)) {
    console.log('api types: backend/openapi.yaml not present; using committed src/api/schema.generated.ts');
    process.exit(0);
  }
  throw new Error(`backend/openapi.yaml not found above ${projectRoot} and committed schema types are missing`);
}
const { default: openapiTS, astToString } = await import('openapi-typescript');
const ast = await openapiTS(pathToFileURL(contractPath));
const banner = '// Generated from backend/openapi.yaml by tools/contract-types/generate.mjs. Do not edit.\n';
writeFileSync(schemaOut, banner + astToString(ast));
console.log(`api types: ${contractPath} -> src/api/schema.generated.ts`);
