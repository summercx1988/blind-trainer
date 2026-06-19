/**
 * IndexedDB 轻量封装：只支持存取单个 Uint8Array snapshot。
 * 用于持久化 sql.js 导出的数据库快照。
 */

function openDb(dbName: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSnapshot(
  dbName: string,
  store: string,
  key: string,
  data: Uint8Array
): Promise<void> {
  const db = await openDb(dbName, store)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(data, key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}

export async function loadSnapshot(
  dbName: string,
  store: string,
  key: string
): Promise<Uint8Array | null> {
  const db = await openDb(dbName, store)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).get(key)
    req.onsuccess = () => {
      db.close()
      resolve(req.result ? new Uint8Array(req.result as ArrayBuffer) : null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error)
    }
  })
}

export async function clearSnapshot(
  dbName: string,
  store: string,
  key: string
): Promise<void> {
  const db = await openDb(dbName, store)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
  })
}
