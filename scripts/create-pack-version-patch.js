#!/usr/bin/env node
/**
 * Create a partial pack version folder for AlbertMerle/sieged-empires-client.
 *
 * Usage:
 *   node scripts/create-pack-version-patch.js 1.0.1 mods/voxelmapsync-1.0.0.jar
 *   node scripts/create-pack-version-patch.js 1.0.2 mods/distantnoise-1.0.0.jar config/distantnoise.json
 *
 * Writes to ./pack-version-out/versions/<version>/ (copy that tree into the GitHub repo).
 * Updates pack-version-out/pack-version.json — merge `versions` list when pushing multiple releases.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.join(__dirname, '..', '..');
const filesRoot = path.join(__dirname, '..', 'files');

function sha1File(p) {
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
}

function sha512File(p) {
  return crypto.createHash('sha512').update(fs.readFileSync(p)).digest('hex');
}

function resolveSource(relPath) {
  const candidates = [
    path.join(filesRoot, relPath),
    path.join(repoRoot, 'client', relPath),
    path.join(repoRoot, 'installer', 'files', relPath),
    path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function parseVersionParts(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .filter(Boolean)
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function main() {
  const version = process.argv[2];
  const relPaths = process.argv.slice(3).map((p) => p.replace(/\\/g, '/'));
  if (!version || !relPaths.length) {
    console.error(
      'Usage: node scripts/create-pack-version-patch.js <version> <rel-path> [rel-path...]\n' +
        'Example: node scripts/create-pack-version-patch.js 1.0.1 mods/voxelmapsync-1.0.0.jar'
    );
    process.exit(1);
  }

  const outRoot = path.join(process.cwd(), 'pack-version-out');
  const versionDir = path.join(outRoot, 'versions', version);
  const overrides = [];
  const staticFiles = [];

  for (const relPath of relPaths) {
    const src = resolveSource(relPath);
    if (!src) {
      console.error(`Source not found: ${relPath}`);
      process.exit(1);
    }
    const dest = path.join(versionDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);

    const stat = fs.statSync(src);
    const entry = {
      path: relPath,
      hashes: {
        sha1: sha1File(src),
        sha512: sha512File(src),
      },
      fileSize: stat.size,
    };

    if (relPath.startsWith('config/') || relPath === 'options.txt' || relPath.startsWith('shaderpacks/')) {
      staticFiles.push({ path: relPath, sha: entry.hashes.sha1 });
    } else {
      overrides.push(entry);
    }
    console.log(`  + ${relPath}  sha1 ${entry.hashes.sha1}`);
  }

  const patch = {
    version,
    overrides,
  };
  if (staticFiles.length) patch.static = staticFiles;

  fs.writeFileSync(path.join(versionDir, 'patch.json'), `${JSON.stringify(patch, null, 2)}\n`);

  const indexPath = path.join(outRoot, 'pack-version.json');
  let index = { latest: version, versions: [version] };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch {
      /* reset */
    }
  }
  const versions = [...new Set([...(index.versions || []), version])].sort(compareVersions);
  index.versions = versions;
  index.latest = versions[versions.length - 1];
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  console.log(`\nWrote ${versionDir}/patch.json`);
  console.log(`Updated ${indexPath} (latest ${index.latest})`);
  console.log('\nPush to GitHub repo root:');
  console.log('  pack-version.json');
  console.log(`  versions/${version}/`);
}

main();
