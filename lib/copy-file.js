/**
 * Windows-safe file copy. `fs.copyFileSync` throws EPERM when the destination
 * is read-only (common after MSI/extraResources copies), locked by Minecraft,
 * or a OneDrive/asar source that CopyFileEx cannot open.
 */
const fs = require('fs');
const path = require('path');

const origCopyFileSync = fs.copyFileSync.bind(fs);

function sameResolvedPath(a, b) {
  const ra = path.resolve(String(a));
  const rb = path.resolve(String(b));
  if (process.platform === 'win32') return ra.toLowerCase() === rb.toLowerCase();
  return ra === rb;
}

function isFileMissingWriteBit(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() && !(st.mode & 0o200);
  } catch {
    return false;
  }
}

function makeWritable(p) {
  try {
    if (!p || !fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (!st.isFile()) return;
    fs.chmodSync(p, 0o666);
  } catch {
    /* ignore */
  }
  if (process.platform === 'win32') {
    try {
      require('child_process').execFileSync('attrib', ['-R', p], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      /* attrib is optional */
    }
  }
  // copyFile preserves FILE_ATTRIBUTE_READONLY from MSI extraResources; rewrite if still RO.
  if (!isFileMissingWriteBit(p)) return;
  try {
    const buf = fs.readFileSync(p);
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
    fs.writeFileSync(p, buf);
    fs.chmodSync(p, 0o666);
  } catch {
    /* ignore */
  }
}

/** Clear read-only on a file or every file under a directory (Minecraft must write configs). */
function makeWritableTree(dir, skipAttrib) {
  if (!dir || !fs.existsSync(dir)) return;
  if (!skipAttrib && process.platform === 'win32') {
    try {
      require('child_process').execFileSync(
        'cmd',
        ['/c', 'attrib', '-R', path.join(dir, '*'), '/S', '/D'],
        { windowsHide: true, stdio: 'ignore' }
      );
    } catch {
      /* attrib is optional */
    }
  }
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    return;
  }
  if (st.isFile()) {
    makeWritable(dir);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of fs.readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    makeWritableTree(path.join(dir, name), true);
  }
}

function formatCopyError(err, src, dest) {
  const code = err?.code || '';
  const locked = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
  let hint = '';
  if (locked) {
    hint =
      ' Close Minecraft if it is running, then press Play again. If the install is on OneDrive, set the folder to "Always keep on this device".';
  }
  const wrapped = new Error(
    `Could not copy ${path.basename(String(src))} (${err?.message || err}).${hint}`
  );
  wrapped.code = code;
  wrapped.cause = err;
  wrapped.src = src;
  wrapped.dest = dest;
  return wrapped;
}

function copyFileRobust(src, dest) {
  if (!src || !dest) throw new Error('copyFileRobust: missing path');
  if (sameResolvedPath(src, dest)) return dest;

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest)) {
    try {
      const a = fs.readFileSync(src);
      const b = fs.readFileSync(dest);
      if (Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b)) {
        makeWritable(dest);
        return dest;
      }
    } catch {
      /* overwrite */
    }
    makeWritable(dest);
    try {
      fs.unlinkSync(dest);
    } catch {
      /* CopyFile overwrite may still succeed */
    }
  }

  try {
    // writeFile (not copyFile) so Windows does not copy FILE_ATTRIBUTE_READONLY
    // from MSI extraResources — Minecraft must be able to rewrite configs.
    fs.writeFileSync(dest, fs.readFileSync(src));
  } catch (err) {
    const retryable =
      err &&
      (err.code === 'EPERM' ||
        err.code === 'EACCES' ||
        err.code === 'EBUSY' ||
        err.code === 'EEXDEV');
    if (!retryable) throw formatCopyError(err, src, dest);
    try {
      makeWritable(dest);
      try {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      fs.writeFileSync(dest, fs.readFileSync(src));
    } catch (err2) {
      throw formatCopyError(err2, src, dest);
    }
  }

  makeWritable(dest);
  return dest;
}

function writeFileRobust(dest, data, encoding) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    makeWritable(dest);
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
  }
  try {
    if (encoding) fs.writeFileSync(dest, data, encoding);
    else fs.writeFileSync(dest, data);
  } catch (err) {
    makeWritable(dest);
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    if (encoding) fs.writeFileSync(dest, data, encoding);
    else fs.writeFileSync(dest, data);
  }
  makeWritable(dest);
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
      copyFileRobust(s, d);
      n += 1;
    }
  }
  return n;
}

let patched = false;

function installCopyFilePatch() {
  if (patched) return;
  patched = true;

  fs.copyFileSync = function copyFileSyncPatched(src, dest, flags) {
    if (flags) {
      try {
        return origCopyFileSync(src, dest, flags);
      } catch (err) {
        if (err?.code !== 'EPERM' && err?.code !== 'EACCES' && err?.code !== 'EBUSY') {
          throw err;
        }
      }
    }
    return copyFileRobust(src, dest);
  };
}

module.exports = {
  copyFileRobust,
  writeFileRobust,
  copyTree,
  installCopyFilePatch,
  makeWritable,
  makeWritableTree,
};
