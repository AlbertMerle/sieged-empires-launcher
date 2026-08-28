/**
 * Regenerate installer/MacOS/files/manifest.json from installer/files/manifest.json:
 * drop Voxy + VoxyServer, add Distant Horizons (Fabric 26.2).
 * Run after editing the base Linux/Windows manifest.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const basePath = path.join(root, 'files', 'manifest.json');
const outDir = path.join(root, 'MacOS', 'files');
const outPath = path.join(outDir, 'manifest.json');

/** Distant Horizons 3.2.0-b-26.2 (Modrinth) — no required project deps; pack already has Fabric API + Sodium + Iris. */
const DH_ENTRY = {
  path: 'mods/DistantHorizons-3.2.0-b-26.2-fabric-neoforge.jar',
  downloads: [
    'https://cdn.modrinth.com/data/uCdwusMi/versions/gBf0SaV1/DistantHorizons-3.2.0-b-26.2-fabric-neoforge.jar',
  ],
  hashes: {
    sha1: '3646a34691c0857a64614bb7ecd344d8b22b117a',
    sha512:
      'c1b8857776a002c2232887d891bd49195f3c3127a7abe1242376ad20371e31554d8ba6c7c92a195b70782cad94fe970941487f2af530988d9b8819455c859e72',
  },
  fileSize: 29705395,
  env: {
    client: 'required',
    server: 'unsupported',
  },
  modrinth: {
    project_id: 'uCdwusMi',
    version_id: 'gBf0SaV1',
    version_number: '3.2.0-b-26.2',
    slug: 'distanthorizons',
    filename: 'DistantHorizons-3.2.0-b-26.2-fabric-neoforge.jar',
  },
};

const REMOVE = [
  'mods/voxy-0.2.18-beta.jar',
  'mods/VoxyServer.jar',
  'mods/VoxyServer-1.2.4-26.2.jar',
  'config/voxy-config.json',
  'config/voxyserver-client.json',
  'config/voxyserver.json',
];

function isVoxyEntry(e) {
  const slug = e.modrinth?.slug || '';
  const p = e.path || '';
  return slug === 'voxy' || slug === 'voxyserver' || /voxy/i.test(p);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const before = (manifest.files || []).length;

  manifest.summary =
    'macOS client pack: base installer/files/manifest.json without Voxy/VoxyServer; Distant Horizons via Modrinth CDN instead. SE overrides still from files/mods. Linux/Windows keep Voxy.';
  manifest.platform = 'macos';
  manifest.remove = REMOVE;

  manifest.files = (manifest.files || []).filter((e) => !isVoxyEntry(e));

  const already = manifest.files.some((e) => e.modrinth?.slug === 'distanthorizons');
  if (!already) {
    const insertAt = manifest.files.findIndex((e) => (e.path || '') > DH_ENTRY.path);
    if (insertAt === -1) manifest.files.push(DH_ENTRY);
    else manifest.files.splice(insertAt, 0, DH_ENTRY);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

  const after = manifest.files.length;
  const hasVoxy = manifest.files.some(isVoxyEntry);
  const hasDh = manifest.files.some((e) => e.modrinth?.slug === 'distanthorizons');
  if (hasVoxy) throw new Error('Voxy still present in macOS manifest');
  if (!hasDh) throw new Error('Distant Horizons missing from macOS manifest');

  console.log(`macOS manifest: ${before} → ${after} CDN files (no Voxy, +DH) → ${outPath}`);
}

main();
