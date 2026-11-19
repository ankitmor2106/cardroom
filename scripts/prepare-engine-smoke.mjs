import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Engine smoke scripts execute emitted JavaScript without requiring a frontend
// install. Mirror the compiled shared workspace into Node's local package path
// so package-boundary imports from the compiled bot module resolve correctly.
const outputPackage = resolve('.check-build/node_modules/@cardroom/shared');
const compiledShared = resolve('.check-build/packages/shared/src');
await mkdir(outputPackage, { recursive: true });
await cp(compiledShared, outputPackage, { recursive: true, force: true });
await writeFile(resolve(outputPackage, 'package.json'), JSON.stringify({
  name: '@cardroom/shared',
  private: true,
  type: 'module',
  exports: {
    '.': './index.js',
    './cards': './cards.js',
    './contracts': './contracts.js',
    './games/*': './games/*.js',
  },
}, null, 2) + '\n');
