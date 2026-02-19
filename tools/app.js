import { sniffPayloadType, maybeListArchiveEntries, extractArchiveEntryAsBlob } from './container_libarchive.js';
import { IsoFS } from './iso9660.js';
import { parseMBR, FatFS } from './mbr_fat.js';
import { humanBytes, downloadBlob, el, clear, setText } from './ui.js';

const $file = document.getElementById('file');
const $btnAnalyze = document.getElementById('btnAnalyze');
const $btnReset = document.getElementById('btnReset');
const $status = document.getElementById('status');
const $containerInfo = document.getElementById('containerInfo');

const $archivePicker = document.getElementById('archivePicker');
const $entrySelect = document.getElementById('entrySelect');
const $btnUseEntry = document.getElementById('btnUseEntry');

const $exploreRoot = document.getElementById('exploreRoot');
const $isoExplorer = document.getElementById('isoExplorer');
const $isoPath = document.getElementById('isoPath');
const $isoList = document.getElementById('isoList');
const $btnIsoUp = document.getElementById('btnIsoUp');

const $imgExplorer = document.getElementById('imgExplorer');
const $partitions = document.getElementById('partitions');
const $fatExplorer = document.getElementById('fatExplorer');
const $fatPath = document.getElementById('fatPath');
const $fatList = document.getElementById('fatList');
const $btnFatUp = document.getElementById('btnFatUp');

let originalFile = null;

// After selection/extraction from an outer archive, this is the blob we treat as ISO/IMG.
let payload = null; // { blob, name }

// ISO state
let iso = null;
let isoCwd = '/';

// IMG/FAT state
let imgBlob = null;
let fat = null;
let fatCwd = '/';

function status(msg, kind = 'info') {
  $status.innerHTML = '';
  const p = document.createElement('div');
  p.className = kind === 'error' ? 'bad' : '';
  p.textContent = msg;
  $status.appendChild(p);
}

function resetUI() {
  originalFile = null;
  payload = null;
  iso = null;
  isoCwd = '/';
  imgBlob = null;
  fat = null;
  fatCwd = '/';

  $btnAnalyze.disabled = true;
  $btnReset.disabled = true;

  setText($containerInfo, 'No file analyzed yet.');
  setText($exploreRoot, 'Nothing to explore yet.');
  $archivePicker.classList.add('hidden');

  $isoExplorer.classList.add('hidden');
  clear($isoList);
  setText($isoPath, '');
  $btnIsoUp.disabled = true;

  $imgExplorer.classList.add('hidden');
  clear($partitions);
  $fatExplorer.classList.add('hidden');
  clear($fatList);
  setText($fatPath, '');
  $btnFatUp.disabled = true;

  status('Select a file to begin.');
}

resetUI();

$file.addEventListener('change', () => {
  const f = $file.files?.[0] || null;
  originalFile = f;
  $btnAnalyze.disabled = !f;
  $btnReset.disabled = !f;
  if (f) status(`Selected: ${f.name} (${humanBytes(f.size)})`);
});

$btnReset.addEventListener('click', () => {
  $file.value = '';
  resetUI();
});

$btnAnalyze.addEventListener('click', async () => {
  if (!originalFile) return;
  try {
    status('Analyzing upload…');

    // Try to treat the file as an archive first (zip/tar.gz/xz/etc). If it contains multiple entries, we’ll show a picker.
    const entries = await maybeListArchiveEntries(originalFile);
    if (entries && entries.length) {
      setText($containerInfo, `Container: archive/compressed (${entries.length} extractable entries)`);
      if (entries.length === 1) {
        status('Archive has one entry; extracting…');
        const blob = await extractArchiveEntryAsBlob(originalFile, entries[0].path);
        payload = { blob, name: entries[0].path };
        await analyzePayload();
        return;
      }

      $archivePicker.classList.remove('hidden');
      clear($entrySelect);
      for (const e of entries) {
        const opt = document.createElement('option');
        opt.value = e.path;
        opt.textContent = `${e.path} (${humanBytes(e.size)})`;
        $entrySelect.appendChild(opt);
      }
      status('Pick an entry to extract.');
      return;
    }

    // Not an archive (or libarchive couldn’t list it) => treat as direct payload.
    payload = { blob: originalFile, name: originalFile.name };
    await analyzePayload();
  } catch (e) {
    console.error(e);
    status(`Error: ${e?.message || String(e)}`, 'error');
  }
});

$btnUseEntry.addEventListener('click', async () => {
  if (!originalFile) return;
  try {
    const path = $entrySelect.value;
    status(`Extracting: ${path} …`);
    const blob = await extractArchiveEntryAsBlob(originalFile, path);
    payload = { blob, name: path };
    $archivePicker.classList.add('hidden');
    await analyzePayload();
  } catch (e) {
    console.error(e);
    status(`Error: ${e?.message || String(e)}`, 'error');
  }
});

async function analyzePayload() {
  if (!payload?.blob) return;

  // Reset explorers
  $isoExplorer.classList.add('hidden');
  $imgExplorer.classList.add('hidden');
  $fatExplorer.classList.add('hidden');
  setText($exploreRoot, `Payload: ${payload.name} (${humanBytes(payload.blob.size)})`);

  status('Detecting payload type…');
  const kind = await sniffPayloadType(payload.blob);

  setText($containerInfo, `Payload detected: ${kind.toUpperCase()} (${payload.name})`);

  if (kind === 'iso') {
    status('Parsing ISO9660…');
    iso = await IsoFS.fromBlob(payload.blob);
    isoCwd = '/';
    $isoExplorer.classList.remove('hidden');
    await renderIso();
    status('ISO ready.');
    return;
  }

  if (kind === 'img') {
    status('Parsing MBR partitions…');
    imgBlob = payload.blob;
    const parts = await parseMBR(imgBlob);
    $imgExplorer.classList.remove('hidden');
    renderPartitions(parts);
    status(`Found ${parts.length} MBR partition(s). Select one to browse (FAT only).`);
    return;
  }

  status(`Unsupported payload. Expected ISO or IMG.`, 'error');
}

async function renderIso() {
  setText($isoPath, isoCwd);
  $btnIsoUp.disabled = isoCwd === '/';
  clear($isoList);

  const entries = await iso.listDir(isoCwd);
  for (const ent of entries) {
    const row = el('div', { className: 'item' });
    const name = el('div', { className: 'name' }, ent.name + (ent.isDir ? '/' : ''));
    const actions = el('div');

    if (ent.isDir) {
      const a = el('a', { href: '#', className: 'linkish' }, 'Open');
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        isoCwd = iso.join(isoCwd, ent.name);
        renderIso();
      });
      actions.appendChild(a);
    } else {
      const btn = el('button', {}, 'Download');
      btn.addEventListener('click', async () => {
        status(`Reading ${ent.name} …`);
        const b = await iso.readFile(iso.join(isoCwd, ent.name));
        downloadBlob(b, ent.name);
        status(`Downloaded ${ent.name}.`);
      });
      actions.appendChild(btn);
    }

    row.appendChild(name);
    row.appendChild(actions);
    $isoList.appendChild(row);
  }
}

$btnIsoUp.addEventListener('click', async () => {
  if (!iso) return;
  if (isoCwd === '/') return;
  isoCwd = iso.parent(isoCwd);
  await renderIso();
});

function renderPartitions(parts) {
  clear($partitions);
  for (const p of parts) {
    const row = el('div', { className: 'item' });
    const name = el(
      'div',
      { className: 'name' },
      `#${p.index} type=0x${p.type.toString(16).padStart(2, '0')} startLBA=${p.startLBA} sectors=${p.sectors} (${humanBytes(p.sectors * 512)})`
    );

    const actions = el('div');
    const btn = el('button', {}, 'Browse (FAT)');
    btn.addEventListener('click', async () => {
      try {
        status(`Opening partition #${p.index} …`);
        fat = await FatFS.fromImage(imgBlob, p.startLBA, p.sectors);
        fatCwd = '/';
        $fatExplorer.classList.remove('hidden');
        await renderFat();
        status(`FAT partition #${p.index} ready.`);
      } catch (e) {
        console.error(e);
        status(`Could not open as FAT: ${e?.message || String(e)}`, 'error');
      }
    });
    actions.appendChild(btn);

    row.appendChild(name);
    row.appendChild(actions);
    $partitions.appendChild(row);
  }
}

async function renderFat() {
  setText($fatPath, fatCwd);
  $btnFatUp.disabled = fatCwd === '/';
  clear($fatList);

  const entries = await fat.listDir(fatCwd);
  for (const ent of entries) {
    const row = el('div', { className: 'item' });
    const name = el('div', { className: 'name' }, ent.name + (ent.isDir ? '/' : ''));
    const actions = el('div');

    if (ent.isDir) {
      const a = el('a', { href: '#', className: 'linkish' }, 'Open');
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        fatCwd = fat.join(fatCwd, ent.name);
        renderFat();
      });
      actions.appendChild(a);
    } else {
      const btn = el('button', {}, 'Download');
      btn.addEventListener('click', async () => {
        status(`Reading ${ent.name} …`);
        const b = await fat.readFile(fat.join(fatCwd, ent.name));
        downloadBlob(b, ent.name);
        status(`Downloaded ${ent.name}.`);
      });
      actions.appendChild(btn);
    }

    row.appendChild(name);
    row.appendChild(actions);
    $fatList.appendChild(row);
  }
}

$btnFatUp.addEventListener('click', async () => {
  if (!fat) return;
  if (fatCwd === '/') return;
  fatCwd = fat.parent(fatCwd);
  await renderFat();
});