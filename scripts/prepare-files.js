/** Sync client config into installer/files/config before building setup. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const clientConfig = path.join(root, '..', 'client', 'config');
const dest = path.join(root, 'files', 'config');

if (!fs.existsSync(clientConfig)) {
  console.warn('client/config not found — skipping config sync');
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
try {
  execSync(`rsync -a --delete "${clientConfig}/" "${dest}/"`, { stdio: 'inherit' });
} catch {
  if (process.platform === 'win32') {
    console.warn('rsync not available on Windows — keeping existing installer/files/config');
    process.exit(0);
  }
  throw new Error('rsync failed while syncing client/config');
}
console.log('Synced client/config -> installer/files/config');
