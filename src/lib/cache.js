import { openDB } from 'idb';

const DB_NAME = 'prdeck';
const DB_VERSION = 1;

let _idbFailed = false;

const dbp = openDB(DB_NAME, DB_VERSION, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('prs', { keyPath: 'id' });
      db.createObjectStore('viewed');
      db.createObjectStore('observed');
      db.createObjectStore('etags');
      db.createObjectStore('meta');
    }
  },
  blocked() {
    console.warn('IDB blocked by older tab');
  },
  blocking() {
    console.warn('IDB blocking newer version; reload to upgrade');
  },
  terminated() {
    _idbFailed = true;
  },
}).catch((e) => {
  _idbFailed = true;
  console.error('IDB open failed', e);
  return null;
});

async function db() {
  const d = await dbp;
  if (!d || _idbFailed) throw new Error('idb-unavailable');
  return d;
}

export async function isReady() {
  try {
    await db();
    return true;
  } catch {
    return false;
  }
}

export async function getAllPRs() {
  try {
    return await (await db()).getAll('prs');
  } catch {
    return [];
  }
}

export async function putPRs(prs) {
  const d = await db();
  const tx = d.transaction('prs', 'readwrite');
  for (const pr of prs) tx.store.put(pr);
  await tx.done;
}

export async function replaceAllPRs(prs) {
  const d = await db();
  const tx = d.transaction('prs', 'readwrite');
  await tx.store.clear();
  for (const pr of prs) tx.store.put(pr);
  await tx.done;
}

export async function getAllViewed() {
  const d = await db();
  const tx = d.transaction('viewed', 'readonly');
  const map = new Map();
  let cursor = await tx.store.openCursor();
  while (cursor) {
    map.set(cursor.key, cursor.value);
    cursor = await cursor.continue();
  }
  return map;
}

export async function setViewed(id, value) {
  await (await db()).put('viewed', value, id);
}

export async function resetPR(id) {
  const d = await db();
  const tx = d.transaction(['viewed', 'observed'], 'readwrite');
  tx.objectStore('viewed').delete(id);
  tx.objectStore('observed').delete(id);
  await tx.done;
}

export async function getAllObserved() {
  const d = await db();
  const tx = d.transaction('observed', 'readonly');
  const map = new Map();
  let cursor = await tx.store.openCursor();
  while (cursor) {
    map.set(cursor.key, cursor.value);
    cursor = await cursor.continue();
  }
  return map;
}

export async function markObservedBulk(prs, now = Date.now()) {
  const d = await db();
  const tx = d.transaction('observed', 'readwrite');
  const existing = new Set(await tx.store.getAllKeys());
  const newly = [];
  for (const pr of prs) {
    if (existing.has(pr.id)) continue;
    tx.store.put({ firstSeenAt: now }, pr.id);
    newly.push(pr.id);
  }
  await tx.done;
  return newly;
}

export async function getMeta(key) {
  return (await db()).get('meta', key);
}

export async function setMeta(key, value) {
  await (await db()).put('meta', value, key);
}

export async function clearAll() {
  const d = await db();
  for (const store of ['prs', 'viewed', 'observed', 'etags', 'meta']) {
    await d.clear(store);
  }
}
