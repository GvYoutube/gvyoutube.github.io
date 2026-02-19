const SECTOR = 512;

async function readAt(blob, off, len) {
  const buf = await blob.slice(off, off + len).arrayBuffer();
  return new Uint8Array(buf);
}

function u16le(u8, off) { return u8[off] | (u8[off + 1] << 8); }
function u32le(u8, off) { return (u8[off] | (u8[off + 1] << 8) | (u8[off + 2] << 16) | (u8[off + 3] << 24)) >>> 0; }

export async function parseMBR(imgBlob) {
  const mbr = await readAt(imgBlob, 0, SECTOR);
  if (!(mbr[510] === 0x55 && mbr[511] === 0xaa)) {
    throw new Error('No MBR signature (0x55AA). This might be GPT or not a raw disk image.');
  }
  const parts = [];
  const tableOff = 446;
  for (let i = 0; i < 4; i++) {
    const off = tableOff + i * 16;
    const type = mbr[off + 4];
    const startLBA = u32le(mbr, off + 8);
    const sectors = u32le(mbr, off + 12);
    if (type !== 0 && startLBA !== 0 && sectors !== 0) {
      parts.push({ index: i + 1, type, startLBA, sectors });
    }
  }
  return parts;
}

function normPath(p) {
  if (!p || p === '/') return '/';
  if (!p.startsWith('/')) p = '/' + p;
  return p.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function decodeLFNPart(entry) {
  const chars = [];
  const ranges = [[1,10],[14,12],[28,4]];
  for (const [start, len] of ranges) {
    for (let i = 0; i < len; i += 2) {
      const code = entry[start + i] | (entry[start + i + 1] << 8);
      if (code === 0x0000 || code === 0xffff) return chars;
      chars.push(String.fromCharCode(code));
    }
  }
  return chars;
}

function shortName(entry) {
  const name = String.fromCharCode(...entry.slice(0, 8)).trim();
  const ext = String.fromCharCode(...entry.slice(8, 11)).trim();
  return ext ? `${name}.${ext}` : name;
}

export class FatFS {
  constructor(imgBlob, partStartLBA, partSectors, bpb) {
    this.imgBlob = imgBlob;
    this.partStartLBA = partStartLBA;
    this.partSectors = partSectors;
    this.bpb = bpb;

    this.bytesPerSector = bpb.bytesPerSector;
    this.sectorsPerCluster = bpb.sectorsPerCluster;
    this.reservedSectors = bpb.reservedSectors;
    this.numFATs = bpb.numFATs;
    this.rootEntryCount = bpb.rootEntryCount;
    this.totalSectors = bpb.totalSectors;
    this.fatSizeSectors = bpb.fatSizeSectors;
    this.rootDirSectors = Math.ceil((this.rootEntryCount * 32) / this.bytesPerSector);

    this.firstDataSector = this.reservedSectors + (this.numFATs * this.fatSizeSectors) + this.rootDirSectors;
    this.firstFATSector = this.reservedSectors;

    this.fatType = bpb.fatType;
    this.rootCluster = bpb.rootCluster || 2;

    this._fatCache = null;
    this._dirCache = new Map();
  }

  static async fromImage(imgBlob, startLBA, sectors) {
    const boot = await readAt(imgBlob, startLBA * SECTOR, SECTOR);
    const bytesPerSector = u16le(boot, 11);
    const sectorsPerCluster = boot[13];
    const reservedSectors = u16le(boot, 14);
    const numFATs = boot[16];
    const rootEntryCount = u16le(boot, 17);
    const totSec16 = u16le(boot, 19);
    const totSec32 = u32le(boot, 32);
    const fatSz16 = u16le(boot, 22);
    const fatSz32 = u32le(boot, 36);

    const totalSectors = totSec16 !== 0 ? totSec16 : totSec32;
    const fatSizeSectors = fatSz16 !== 0 ? fatSz16 : fatSz32;

    const rootDirSectors = Math.ceil((rootEntryCount * 32) / bytesPerSector);
    const dataSectors = totalSectors - (reservedSectors + numFATs * fatSizeSectors + rootDirSectors);
    const countOfClusters = Math.floor(dataSectors / sectorsPerCluster);
    let fatType = 16;
    if (countOfClusters >= 65525) fatType = 32;

    let rootCluster = 2;
    if (fatType === 32) rootCluster = u32le(boot, 44);

    if (!(bytesPerSector === 512 || bytesPerSector === 1024 || bytesPerSector === 2048 || bytesPerSector === 4096)) {
      throw new Error('Not FAT (invalid bytes/sector).');
    }
    if (sectorsPerCluster === 0) throw new Error('Not FAT (invalid sectors/cluster).');
    if (numFATs < 1) throw new Error('Not FAT (invalid FAT count).');
    if (fatSizeSectors === 0) throw new Error('Not FAT (invalid FAT size).');

    return new FatFS(imgBlob, startLBA, sectors, {
      bytesPerSector,
      sectorsPerCluster,
      reservedSectors,
      numFATs,
      rootEntryCount,
      totalSectors,
      fatSizeSectors,
      fatType,
      rootCluster
    });
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
    if (this._dirCache.has(path)) return this._dirCache.get(path);
    const entries = await this._readDir(path);
    this._dirCache.set(path, entries);
    return entries;
  }

  async readFile(path) {
    path = normPath(path);
    const node = await this._resolveNode(path);
    if (!node || node.isDir) throw new Error('Not a file');
    const data = await this._readClusterChain(node.firstCluster, node.size);
    return new Blob([data]);
  }

  async _resolveNode(path) {
    if (path === '/') return { isDir: true, firstCluster: this.rootCluster, size: 0, name: '' };
    const parts = path.split('/').filter(Boolean);
    let cur = '/';
    for (let i = 0; i < parts.length; i++) {
      const entries = await this.listDir(cur);
      const found = entries.find(e => e.name.toLowerCase() === parts[i].toLowerCase());
      if (!found) return null;
      if (i === parts.length - 1) return found;
      if (!found.isDir) return null;
      cur = this.join(cur, found.name);
    }
    return null;
  }

  async _readDir(path) {
    if (path === '/') {
      if (this.fatType === 16 && this.rootEntryCount > 0) {
        const rootDirStart = this.partStartLBA * SECTOR + (this.reservedSectors + this.numFATs * this.fatSizeSectors) * this.bytesPerSector;
        const rootDirBytes = Math.ceil((this.rootEntryCount * 32) / this.bytesPerSector) * this.bytesPerSector;
        const buf = await readAt(this.imgBlob, rootDirStart, rootDirBytes);
        return this._parseDirEntries(buf);
      }
      const buf = await this._readClusterChain(this.rootCluster, null);
      return this._parseDirEntries(buf);
    }

    const node = await this._resolveNode(path);
    if (!node || !node.isDir) throw new Error('Directory not found');
    const buf = await this._readClusterChain(node.firstCluster, null);
    return this._parseDirEntries(buf);
  }

  async _readFAT() {
    if (this._fatCache) return this._fatCache;
    const fatOff = this.partStartLBA * SECTOR + this.firstFATSector * this.bytesPerSector;
    const fatBytes = this.fatSizeSectors * this.bytesPerSector;
    const fat = await readAt(this.imgBlob, fatOff, fatBytes);
    this._fatCache = fat;
    return fat;
  }

  _clusterToOffset(cluster) {
    const firstSector = ((cluster - 2) * this.sectorsPerCluster) + this.firstDataSector;
    const absSector = this.partStartLBA + firstSector;
    return absSector * SECTOR;
  }

  async _nextCluster(cluster) {
    const fat = await this._readFAT();
    if (this.fatType === 32) return (u32le(fat, cluster * 4) & 0x0fffffff) >>> 0;
    return u16le(fat, cluster * 2);
  }

  _isEOC(val) {
    if (this.fatType === 32) return val >= 0x0ffffff8;
    return val >= 0xfff8;
  }

  async _readClusterChain(firstCluster, sizeOrNull) {
    const chunks = [];
    let remaining = sizeOrNull == null ? Infinity : sizeOrNull;
    let cluster = firstCluster;

    const bytesPerCluster = this.bytesPerSector * this.sectorsPerCluster;
    let guard = 0;

    while (cluster >= 2 && !this._isEOC(cluster) && remaining > 0) {
      if (guard++ > 100000) throw new Error('Cluster chain too long (corrupt FAT?)');
      const off = this._clusterToOffset(cluster);
      const want = Math.min(bytesPerCluster, remaining);
      const u8 = await readAt(this.imgBlob, off, want);
      chunks.push(u8);
      remaining -= u8.length;

      const next = await this._nextCluster(cluster);
      if (this._isEOC(next) || next === 0) break;
      cluster = next;
    }

    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  _parseDirEntries(buf) {
    const entries = [];
    let lfnParts = [];

    for (let off = 0; off + 32 <= buf.length; off += 32) {
      const first = buf[off];
      if (first === 0x00) break;
      if (first === 0xe5) continue;

      const attr = buf[off + 11];
      const isLFN = attr === 0x0f;

      if (isLFN) {
        lfnParts.push(buf.slice(off, off + 32));
        continue;
      }

      const part = buf.slice(off, off + 32);
      const isDir = (attr & 0x10) !== 0;

      const hi = u16le(part, 20);
      const lo = u16le(part, 26);
      const firstCluster = (hi << 16) | lo;
      const size = u32le(part, 28);

      let name = shortName(part);
      if (lfnParts.length) {
        const chars = [];
        for (let i = lfnParts.length - 1; i >= 0; i--) chars.push(...decodeLFNPart(lfnParts[i]));
        const longName = chars.join('');
        if (longName) name = longName;
      }
      lfnParts = [];

      if (name === '.' || name === '..') continue;
      entries.push({ name, isDir, firstCluster, size });
    }

    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1)));
    return entries;
  }
}