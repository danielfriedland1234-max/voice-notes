// Tiny wrapper around IndexedDB, the browser's built-in database.
// Notes are stored only on this device, in the "transcripts" store.
// Small app settings that must last (like word fixes) go in the "settings" store.
const DB = (() => {
  const NAME = 'voice-notes';
  const STORE = 'transcripts';
  const SETTINGS = 'settings';
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, 2);
        req.onupgradeneeded = e => {
          const db = req.result;
          if (e.oldVersion < 1) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('createdAt', 'createdAt');
          }
          if (e.oldVersion < 2) db.createObjectStore(SETTINGS, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const result = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    async all() {
      const items = await run(STORE, 'readonly', s => s.getAll());
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get: id => run(STORE, 'readonly', s => s.get(id)),
    put: item => run(STORE, 'readwrite', s => s.put(item)),
    remove: id => run(STORE, 'readwrite', s => s.delete(id)),
    async getSetting(key) {
      const row = await run(SETTINGS, 'readonly', s => s.get(key));
      return row ? row.value : undefined;
    },
    setSetting: (key, value) => run(SETTINGS, 'readwrite', s => s.put({ key, value })),
  };
})();
