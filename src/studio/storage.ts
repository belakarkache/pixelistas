import { PALETTE_PRESETS, newProject, uid, type Palette, type Project, type ProjectSummary } from './model';
import { frameToDataUrl } from './raster';
import { t } from './i18n';

const DB_NAME = 'pixelistas';
const PROJECTS = 'projects';
const SUMMARIES = 'summaries';
const PALETTES = 'palettes';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [PROJECTS, SUMMARIES, PALETTES]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function summarize(project: Project): ProjectSummary {
  const { doc } = project;
  return {
    id: project.id,
    name: project.name,
    width: doc.width,
    height: doc.height,
    frameCount: doc.frames.length,
    thumb: frameToDataUrl(doc, 0, 256),
    updatedAt: project.updatedAt,
  };
}

export async function saveProject(project: Project): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PROJECTS, SUMMARIES], 'readwrite');
  tx.objectStore(PROJECTS).put(project);
  tx.objectStore(SUMMARIES).put(summarize(project));
  await done(tx);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const db = await openDb();
  return request(db.transaction(PROJECTS).objectStore(PROJECTS).get(id));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDb();
  const all = await request<ProjectSummary[]>(db.transaction(SUMMARIES).objectStore(SUMMARIES).getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([PROJECTS, SUMMARIES], 'readwrite');
  tx.objectStore(PROJECTS).delete(id);
  tx.objectStore(SUMMARIES).delete(id);
  await done(tx);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const project = await loadProject(id);
  if (!project) return;
  await saveProject({ ...project, name, updatedAt: Date.now() });
}

export async function duplicateProject(id: string): Promise<Project | undefined> {
  const project = await loadProject(id);
  if (!project) return;
  const copy = { ...newProject(`${project.name} copy`, project.doc), palette: project.palette, paletteId: project.paletteId ?? null, reference: project.reference };
  await saveProject(copy);
  return copy;
}

export async function listPalettes(): Promise<Palette[]> {
  const db = await openDb();
  const all = await request<Palette[]>(db.transaction(PALETTES).objectStore(PALETTES).getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getPalette(id: string): Promise<Palette | undefined> {
  const preset = PALETTE_PRESETS.find((p) => p.id === id);
  if (preset) return preset;
  const db = await openDb();
  return request(db.transaction(PALETTES).objectStore(PALETTES).get(id));
}

export async function savePalette(palette: Palette): Promise<Palette> {
  const saved = { ...palette, name: palette.name.trim() || t('Untitled palette'), updatedAt: Date.now() };
  const db = await openDb();
  const tx = db.transaction(PALETTES, 'readwrite');
  tx.objectStore(PALETTES).put(saved);
  await done(tx);
  return saved;
}

export async function deletePalette(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(PALETTES, 'readwrite');
  tx.objectStore(PALETTES).delete(id);
  await done(tx);
}

export async function duplicatePalette(id: string): Promise<Palette | undefined> {
  const palette = await getPalette(id);
  if (!palette) return;
  const now = Date.now();
  const copy: Palette = {
    ...palette,
    id: uid(),
    name: `${palette.name} copy`,
    colors: [...palette.colors],
    source: palette.source === 'preset' ? 'custom' : palette.source,
    createdAt: now,
    updatedAt: now,
  };
  return savePalette(copy);
}
