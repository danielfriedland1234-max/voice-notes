// Tiny wrapper around IndexedDB, the browser's built-in database.
// Transcripts are stored only on this device.
const DB = (() => {
  const NAME = 'voice-notes';
  const STORE = 'transcripts';
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  return {
    async all() {
      const items = await run('readonly', s => s.getAll());
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    get: id => run('readonly', s => s.get(id)),
    put: item => run('readwrite', s => s.put(item)),
    remove: id => run('readwrite', s => s.delete(id)),
  };
})();
