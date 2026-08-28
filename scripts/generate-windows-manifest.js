/**
 * Regenerate installer/windows/files/manifest.json from installer/files/manifest.json:
 * drop ImmediatelyFast (Windows font glyph driver conflicts).
 * Run before building Windows setup.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const basePath = path.join(root, 'files', 'manifest.json');
const outDir = path.join(root, 'windows', 'files');
const outPath = path.join(outDir, 'manifest.json');

const WIN_REMOVE = [
  'mods/c2me-fabric-mc26.2-0.4.2-alpha.0.35.jar',
  'config/c2me.toml',
  'mods/ImmediatelyFast-Fabric-1.16.2+26.2.jar',
  'config/immediatelyfast.json',
];

function isImmediatelyFastEntry(e) {
  const slug = e.modrinth?.slug || '';
  const p = e.path || '';
  return slug === 'immediatelyfast' || /immediatelyfast/i.test(p);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const before = (manifest.files || []).length;

  manifest.summary =
    'Windows client pack: base installer/files/manifest.json without ImmediatelyFast (glyph corruption fix). SE overrides from files/mods.';
  manifest.platform = 'windows';
  manifest.remove = WIN_REMOVE;

  manifest.files = (manifest.files || []).filter((e) => !isImmediatelyFastEntry(e));

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

  const after = manifest.files.length;
  console.log(`Windows manifest: ${before} → ${after} CDN files (no ImmediatelyFast) → ${outPath}`);
}

main();
