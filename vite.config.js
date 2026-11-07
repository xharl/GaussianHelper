import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * OpenChemLib ships its force-field and conformer tables in `dist/resources.json`
 * instead of embedding them in the JS bundle, and its `exports` map does not
 * expose that file as a subpath. Aliasing it here lets `chemResources.js`
 * import the JSON normally, so MMFF94 energies work in the portable offline
 * build without a network fetch.
 */
function resolveOpenChemLibResources() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.resolve('openchemlib'))), 'resources.json');
  } catch {
    return path.resolve(process.cwd(), 'node_modules/openchemlib/dist/resources.json');
  }
}

export default defineConfig({
  // Set base to relative paths so that the compiled index.html can be double-clicked 
  // and run directly from the local file system (portable)
  base: './',
  resolve: {
    alias: {
      'openchemlib-resources': resolveOpenChemLibResources(),
    },
  },
  build: {
    // Keep resources asset files in predictable directory
    assetsDir: 'assets',
  }
});
