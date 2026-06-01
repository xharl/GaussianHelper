import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = process.cwd();
const zipPath = path.join(rootDir, 'dist.zip');
const tarPath = path.join(rootDir, 'dist.tar.gz');

console.log('📦 Post-build packaging: Archiving build files...');

// Clean up old archives
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
  console.log('  Cleaned old dist.zip');
}
if (fs.existsSync(tarPath)) {
  fs.unlinkSync(tarPath);
  console.log('  Cleaned old dist.tar.gz');
}

// Create dist.zip
// In the zip, we want the contents of the dist folder to be at the root of the archive.
// Using python3: python3 -c "import shutil; shutil.make_archive('dist', 'zip', 'dist')"
try {
  console.log('  Creating dist.zip...');
  execSync('python3 -c "import shutil; shutil.make_archive(\'dist\', \'zip\', \'dist\')"', { stdio: 'inherit' });
  console.log('  Successfully created dist.zip');
} catch (error) {
  console.error('❌ Failed to create dist.zip:', error.message);
  process.exit(1);
}

// Create dist.tar.gz
// In the tar.gz, we want the dist/ folder itself to be at the root of the archive.
// Using tar: tar -czf dist.tar.gz dist
try {
  console.log('  Creating dist.tar.gz...');
  execSync('tar -czf dist.tar.gz dist', { stdio: 'inherit' });
  console.log('  Successfully created dist.tar.gz');
} catch (error) {
  console.error('❌ Failed to create dist.tar.gz:', error.message);
  process.exit(1);
}

// Log details
if (fs.existsSync(zipPath) && fs.existsSync(tarPath)) {
  const zipStats = fs.statSync(zipPath);
  const tarStats = fs.statSync(tarPath);
  console.log(`\n🎉 Packaging complete!`);
  console.log(`  dist.zip size: ${(zipStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  dist.tar.gz size: ${(tarStats.size / 1024 / 1024).toFixed(2)} MB\n`);
} else {
  console.error('❌ Packaging failed: Archives were not generated.');
  process.exit(1);
}
