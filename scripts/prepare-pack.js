/**
 * Build-time: copy ONLY redistributable overrides (installer/files/mods) + config.
 * Third-party mods are NOT downloaded into the .deb/.msi — Play fetches them via
 * official CDN links in files/manifest.json (redistribution of those jars is illegal).
 *
 * macOS: SE_PACK_PLATFORM=mac (or --mac) uses MacOS/files/manifest.json (no Voxy; +DH)
 * and strips Voxy configs from the payload. Linux/Windows keep base files/manifest.json.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const payload = path.join(root, 'pack-payload');
const filesRoot = path.join(root, 'files');
const macFilesRoot = path.join(root, 'MacOS', 'files');
const winFilesRoot = path.join(root, 'windows', 'files');
const clientRoot = path.join(root, '..', 'client');
const isMacPack =
  process.env.SE_PACK_PLATFORM === 'mac' || process.argv.includes('--mac');
const isWinPack =
  process.env.SE_PACK_PLATFORM === 'win' || process.argv.includes('--win');

function sha1File(p) {
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
}

function copyTree(src, dest) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(src)) {
    if (name === '.DS_Store') continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) n += copyTree(s, d);
    else {
      fs.copyFileSync(s, d);
      n += 1;
    }
  }
  return n;
}

function wipeModsDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    fs.unlinkSync(path.join(dir, name));
  }
}

function overrideFilesDir(filesRoot, entry) {
  const rel = entry.source || entry.path;
  if (rel.startsWith('resourcepacks/')) return path.join(filesRoot, 'resourcepacks');
  if (rel.startsWith('shaderpacks/')) return path.join(filesRoot, 'shaderpacks');
  return path.join(filesRoot, 'mods');
}

function isPackOverridePath(p) {
  return (
    p?.startsWith('mods/') || p?.startsWith('resourcepacks/') || p?.startsWith('shaderpacks/')
  );
}

function resolveManifestPath() {
  if (isMacPack) {
    const macManifest = path.join(macFilesRoot, 'manifest.json');
    if (!fs.existsSync(macManifest)) {
      throw new Error(
        `macOS pack requested but missing ${macManifest} — run: npm run generate:macos-manifest`
      );
    }
    return macManifest;
  }
  if (isWinPack) {
    const winManifest = path.join(winFilesRoot, 'manifest.json');
    if (!fs.existsSync(winManifest)) {
      throw new Error(
        `Windows pack requested but missing ${winManifest} — run: npm run generate:windows-manifest`
      );
    }
    return winManifest;
  }
  return path.join(filesRoot, 'manifest.json');
}

function applyManifestRemoves(manifest, installRoot) {
  const remove = manifest.remove || [];
  let n = 0;
  for (const rel of remove) {
    const p = path.join(installRoot, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      fs.unlinkSync(p);
      n += 1;
      console.log(`  remove ${rel}`);
    }
  }
  return n;
}

function overlayMacConfig(configDest) {
  const macConfig = path.join(macFilesRoot, 'config');
  if (!fs.existsSync(macConfig)) return 0;
  return copyTree(macConfig, configDest);
}

async function main() {
  const manifestPath = resolveManifestPath();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Using manifest: ${path.relative(root, manifestPath)}${isMacPack ? ' (macOS)' : isWinPack ? ' (Windows)' : ' (Linux/Default)'}`);

  const modsOut = path.join(payload, 'mods');
  fs.mkdirSync(modsOut, { recursive: true });
  wipeModsDir(modsOut);

  const resourcepacksOut = path.join(payload, 'resourcepacks');
  fs.mkdirSync(resourcepacksOut, { recursive: true });
  wipeModsDir(resourcepacksOut);

  const configDest = path.join(payload, 'config');
  const configSrc = path.join(filesRoot, 'config');
  if (fs.existsSync(configSrc)) {
    const n = copyTree(configSrc, configDest);
    console.log(`Copied ${n} config files`);
  }
  if (isMacPack) {
    const over = overlayMacConfig(configDest);
    if (over) console.log(`Overlaid ${over} macOS config files`);
  }
  if (isMacPack || isWinPack) {
    const removed = applyManifestRemoves(manifest, payload);
    if (removed) console.log(`Removed ${removed} platform-excluded config/mod paths from payload`);
  }

  const optionsSrc = path.join(clientRoot, 'options.txt');
  if (fs.existsSync(optionsSrc)) {
    fs.copyFileSync(optionsSrc, path.join(payload, 'options.txt'));
    console.log('Copied options.txt');
  }

  const overrides = (manifest.overrides || []).filter((e) => isPackOverridePath(e.path));
  let copied = 0;
  for (const entry of overrides) {
    const baseName = path.basename(entry.source || entry.path);
    const macSrc =
      isMacPack &&
      path.join(overrideFilesDir(macFilesRoot, entry), baseName);
    const src =
      macSrc && fs.existsSync(macSrc)
        ? macSrc
        : path.join(overrideFilesDir(filesRoot, entry), baseName);
    if (!fs.existsSync(src)) throw new Error(`Override missing (SE-owned only): ${src}`);
    const dest = path.join(payload, entry.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    const expected = (entry.hashes?.sha1 || '').toLowerCase();
    if (expected && sha1File(dest).toLowerCase() !== expected) {
      console.warn(`  warn hash mismatch for ${path.basename(dest)} (manifest may be stale)`);
    }
    console.log(`  copy ${path.basename(dest)}${src === macSrc ? ' (mac override)' : ''}`);
    copied += 1;
  }

  const cdnCount = (manifest.files || []).filter((e) =>
    e.path?.startsWith('mods/') ||
    e.path?.startsWith('resourcepacks/') ||
    e.path?.startsWith('shaderpacks/')
  ).length;
  const cdnMods = (manifest.files || []).filter((e) => e.path?.startsWith('mods/')).length;
  const cdnResourcePacks = (manifest.files || []).filter((e) => e.path?.startsWith('resourcepacks/')).length;
  const cdnShaderPacks = (manifest.files || []).filter((e) => e.path?.startsWith('shaderpacks/')).length;
  console.log(
    `Skipped ${cdnCount} CDN files (${cdnMods} mods, ${cdnResourcePacks} resource packs, ${cdnShaderPacks} shader packs) — downloaded at Play via official links.`
  );

  fs.writeFileSync(
    path.join(payload, 'pack-manifest.json'),
    JSON.stringify(
      {
        name: manifest.name,
        minecraft: manifest.minecraft,
        loader: manifest.loader,
        bundledOverrides: copied,
        cdnMods: cdnMods,
        cdnResourcePacks,
        cdnShaderPacks,
        note: 'Third-party files are not bundled; installer downloads from manifest.files[].downloads',
        platform: isMacPack ? 'macos' : isWinPack ? 'windows' : 'linux',
        preparedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  // Keep a stub pointer so runtime loads the full files/manifest.json from extraResources.
  console.log(`Pack payload ready: ${copied} SE overrides only → ${payload}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
