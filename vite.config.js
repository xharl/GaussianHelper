import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Resolve the commit the bundle was built from. A source checkout, a dev
 * server, or a tree without git metadata yields 'unknown' rather than a
 * stale or invented SHA.
 */
function resolveBuildCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.toLowerCase() : 'unknown';
  } catch {
    return 'unknown';
  }
}

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

export default defineConfig(() => ({
  // Provenance records must say which commit produced the build. Vitest runs
  // source files directly, so it keeps the runtime `'unknown'` fallback and
  // tests exercise that path; production builds get the real short SHA.
  define: process.env.VITEST
    ? {}
    : { __APP_COMMIT__: JSON.stringify(resolveBuildCommit()) },
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
  },
}));
