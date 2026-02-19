const SECTOR = 2048;

function u32le(u8, off) {
  return u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24);
}
function readAscii(u8, off, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[off + i]);
  return s;
}
async function readAt(blob, off, len) {
  const buf = await blob.slice(off, off + len).arrayBuffer();
  return new Uint8Array(buf);
}
function normPath(p) {
  if (!p || p === '/') return '/';
  if (!p.startsWith('/')) p = '/' + p;
  return p.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

export class IsoFS {
  constructor(blob, rootExtent, rootSize) {
    this.blob = blob;
    this.rootExtent = rootExtent;
    this.rootSize = rootSize;
    this.dirCache = new Map();
  }

  static async fromBlob(blob) {
    const pvd = await readAt(blob, 16 * SECTOR, SECTOR);
    if (!(pvd[0] === 0x01 && readAscii(pvd, 1, 5) === 'CD001')) {
      throw new Error('Not an ISO9660 (missing PVD signature).');
    }
    const rrOff = 156;
    const rrLen = pvd[rrOff];
    if (rrLen < 34) throw new Error('Invalid root directory record.');
    const extent = u32le(pvd, rrOff + 2);
    const size = u32le(pvd, rrOff + 10);
    return new IsoFS(blob, extent, size);
  }

  join(base, name) {
    base = normPath(base);
    if (base === '/') return '/' + name;
    return base + '/' + name;
  }
  parent(p) {
    p = normPath(p);
    if (p === '/') return '/';
    return p.split('/').slice(0, -1).join('/') || '/';
  }

  async listDir(path) {
    path = normPath(path);
    if (this.dirCache.has(path)) return this.dirCache.get(path);

    const { extent, size } = await this._resolveDir(path);
    const entries = await this._readDir(extent, size);
    this.dirCache.set(path, entries);
    return entries;
  }

  async readFile(path) {
    path = normPath(path);
    const node = await this._resolveNode(path);
    if (!node || node.isDir) throw new Error('Not a file.');
    const off = node.extent * SECTOR;
    const u8 = await readAt(this.blob, off, node.size);
    return new Blob([u8]);
  }

  async _resolveDir(path) {
    if (path === '/') return { extent: this.rootExtent, size: this.rootSize };
    const node = await this._resolveNode(path);
    if (!node || !node.isDir) throw new Error('Directory not found: ' + path);
    return { extent: node.extent, size: node.size };
  }

  async _resolveNode(path) {
    if (path === '/') return { isDir: true, extent: this.rootExtent, size: this.rootSize, name: '' };
    const parts = path.split('/').filter(Boolean);
    let cur = { extent: this.rootExtent, size: this.rootSize };

    for (let i = 0; i < parts.length; i++) {
      const entries = await this._readDir(cur.extent, cur.size);
      const want = parts[i].toUpperCase();
      const found = entries.find(e => e.name.toUpperCase() === want);
      if (!found) return null;
      if (i === parts.length - 1) return found;
      if (!found.isDir) return null;
      cur = { extent: found.extent, size: found.size };
    }
    return null;
  }

  async _readDir(extent, size) {
    const off = extent * SECTOR;
    const bytes = await readAt(this.blob, off, size);
    const entries = [];
    let i = 0;

    while (i < bytes.length) {
      const len = bytes[i];
      if (len === 0) {
        i = (Math.floor(i / SECTOR) + 1) * SECTOR;
        continue;
      }
      const rec = bytes.slice(i, i + len);
      const extent = u32le(rec, 2);
      const size = u32le(rec, 10);
      const flags = rec[25];
      const nameLen = rec[32];
      const rawName = readAscii(rec, 33, nameLen);

      if (rawName.charCodeAt(0) === 0 || rawName.charCodeAt(0) === 1) {
        i += len;
        continue;
      }

      const name = rawName.replace(/;[0-9]+$/, '');
      const isDir = (flags & 0x02) !== 0;

      entries.push({ name, isDir, extent, size });
      i += len;
    }

    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
    return entries;
  }
}