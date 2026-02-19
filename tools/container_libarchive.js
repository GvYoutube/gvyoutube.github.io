// Archive/compression support using libarchive.js (WASM)
//
// This lets us list/extract entries from zip/tar/tar.gz/xz/gz/etc client-side.
//
// We still separately parse ISO/IMG after extraction.
//
// Implementation notes:
// - We dynamically import libarchive.js from a CDN.
// - libarchive.js wants the whole archive as Uint8Array (memory heavy).
// - For best results, keep uploads reasonably sized.

async function loadLibArchive() {
  // libarchive.js exposes `Archive` on module default in many builds; in others it's named.
  // This CDN package works as an ES module.
  const mod = await import('https://cdn.jsdelivr.net/npm/libarchive.js@2.0.2/dist/libarchive.esm.js');
  // Ensure wasm is loaded
  if (mod?.default?.init) {
    await mod.default.init();
    return mod.default;
  }
  if (mod?.Archive?.init) {
    await mod.Archive.init();
    return mod.Archive;
  }
  // Last resort: some builds export `init` and `open`
  if (mod?.init && mod?.open) {
    await mod.init();
    return mod;
  }
  throw new Error('Could not initialize libarchive.js from CDN.');
}

async function readAll(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function maybeListArchiveEntries(file) {
  // Return null if it doesn't look like an archive we can open.
  // We attempt to open via libarchive; if it fails, return null.
  const Lib = await loadLibArchive();

  try {
    const u8 = await readAll(file);

    const archive = await Lib.open(u8);
    const entries = [];
    for await (const entry of archive) {
      // entry: { pathname, size, filetype, ... }
      const path = entry.pathname;
      const size = entry.size ?? 0;
      const isDir = entry.filetype === 'directory' || path.endsWith('/');
      if (!isDir) entries.push({ path, size });
    }
    await archive.close?.();

    if (!entries.length) return null;
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  } catch (_e) {
    return null;
  }
}

export async function extractArchiveEntryAsBlob(file, wantedPath) {
  const Lib = await loadLibArchive();
  const u8 = await readAll(file);

  const archive = await Lib.open(u8);
  try {
    for await (const entry of archive) {
      if (entry.pathname === wantedPath) {
        // entry.readData() yields Uint8Array chunks in many builds
        const chunks = [];
        let total = 0;

        if (typeof entry.readData === 'function') {
          for await (const c of entry.readData()) {
            chunks.push(c);
            total += c.length;
          }
        } else if (entry.fileData) {
          // Some builds expose full data
          chunks.push(entry.fileData);
          total += entry.fileData.length;
        } else {
          throw new Error('libarchive entry does not expose readData().');
        }

        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return new Blob([out]);
      }
    }
    throw new Error(`Entry not found: ${wantedPath}`);
  } finally {
    await archive.close?.();
  }
}

// Payload sniffing: we do signature checks on the Blob.
async function readAt(blob, off, len) {
  return new Uint8Array(await blob.slice(off, off + len).arrayBuffer());
}

export async function sniffPayloadType(blob) {
  // ISO9660: sector 16 has 0x01 "CD001"
  if (blob.size >= 0x8000 + 6) {
    const pvd = await readAt(blob, 0x8000, 6);
    if (pvd[0] === 0x01 && pvd[1] === 0x43 && pvd[2] === 0x44 && pvd[3] === 0x30 && pvd[4] === 0x30 && pvd[5] === 0x31) {
      return 'iso';
    }
  }

  // MBR signature: 0x55AA at end of sector 0
  if (blob.size >= 512) {
    const mbrTail = await readAt(blob, 510, 2);
    if (mbrTail[0] === 0x55 && mbrTail[1] === 0xaa) {
      return 'img';
    }
  }

  // Default
  return 'unknown';
}