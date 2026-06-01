import { defineConfig } from 'vite';

export default defineConfig({
  // Set base to relative paths so that the compiled index.html can be double-clicked 
  // and run directly from the local file system (portable)
  base: './',
  build: {
    // Keep resources asset files in predictable directory
    assetsDir: 'assets',
  }
});
