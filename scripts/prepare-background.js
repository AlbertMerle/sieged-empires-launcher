/** Convert stars.mp4 → app/assets/background.webm (60fps short loop). */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const repoRoot = path.join(root, '..');
const scriptPath = __filename;
const webm = path.join(root, 'app', 'assets', 'background.webm');

const CLIP_SECONDS = 10;
const FPS = 60;
const SCALE_WIDTH = 960;
const CRF = 32;

function resolveSourceMp4() {
  const candidates = [
    path.join(root, 'stars.mp4'),
    path.join(repoRoot, 'stars.mp4'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const mp4 = resolveSourceMp4();
if (!mp4) {
  if (fs.existsSync(webm)) {
    console.log('stars.mp4 missing — keeping existing background.webm');
    process.exit(0);
  }
  console.warn('stars.mp4 not found — launcher will use solid background');
  process.exit(0);
}

const sourceMtime = Math.max(
  fs.statSync(mp4).mtimeMs,
  fs.statSync(scriptPath).mtimeMs
);
const webmFresh =
  fs.existsSync(webm) && fs.statSync(webm).mtimeMs >= sourceMtime;

if (webmFresh) {
  console.log('background.webm is up to date');
  process.exit(0);
}

function hasFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasFfmpeg()) {
  if (fs.existsSync(webm)) {
    console.log('ffmpeg missing — keeping existing background.webm');
    process.exit(0);
  }
  console.warn('ffmpeg missing and no background.webm — launcher will use solid background');
  process.exit(0);
}

fs.mkdirSync(path.dirname(webm), { recursive: true });
console.log(
  `Converting ${path.basename(mp4)} → background.webm (${CLIP_SECONDS}s @ ${FPS}fps) …`
);
execSync(
  [
    'ffmpeg -y',
    `-ss 0 -t ${CLIP_SECONDS}`,
    `-i "${mp4}"`,
    '-an',
    '-c:v libvpx-vp9',
    '-pix_fmt yuv420p',
    `-vf "scale=${SCALE_WIDTH}:-2:flags=lanczos,minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:vsbmc=1"`,
    `-crf ${CRF} -b:v 0`,
    `"${webm}"`,
  ].join(' '),
  { stdio: 'inherit' }
);
console.log('background.webm ready');
