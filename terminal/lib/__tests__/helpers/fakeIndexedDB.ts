/**
 * A minimal in-memory `indexedDB` for vitest, shared by every suite that must exercise the REAL
 * dataCache / idbJsonStore persistence paths (Node and jsdom both lack IndexedDB).
 *
 * Covers only the request surface dataCache/idbJsonStore actually use:
 *   open + upgradeneeded(createObjectStore/createIndex),
 *   transaction/objectStore, get, put, delete, clear, count,
 *   index("ts").openCursor() (ascending).
 * It validates WIRING against real code, not IDB spec conformance. Install it on
 * `globalThis.indexedDB` and load idbJsonStore/dataCache fresh (`vi.resetModules()`), so the
 * module-level open-promise cache starts clean.
 */
export type Rec = { url: string; data: unknown; ts: number };

type Handler = ((event: { target: unknown }) => void) | null;
type FakeRequest = { onsuccess: Handler; onerror: Handler; result: unknown };
type FakeOpenRequest = FakeRequest & { onupgradeneeded: Handler; onblocked: Handler };
type FakeTransaction = { oncomplete: Handler; onerror: Handler; onabort: Handler; objectStore: () => unknown };

export function makeFakeIndexedDB() {
  const data = new Map<string, Rec>();

  // Microtask-defer a request's success so on* handlers (assigned after the call
  // returns, exactly like real IDB) are already attached when they fire.
  function fire<T>(makeResult: () => T) {
    const req: FakeRequest = { onsuccess: null, onerror: null, result: undefined };
    queueMicrotask(() => {
      try {
        req.result = makeResult();
        req.onsuccess?.({ target: req });
      } catch {
        req.onerror?.({ target: req });
      }
    });
    return req;
  }

  function makeStore() {
    return {
      get: (url: string) => fire(() => data.get(url)),
      put: (rec: Rec) => fire(() => {
        data.set(rec.url, rec);
        return rec.url;
      }),
      delete: (url: string) => fire(() => {
        data.delete(url);
        return undefined;
      }),
      clear: () => fire(() => {
        data.clear();
        return undefined;
      }),
      count: () => fire(() => data.size),
      index: () => ({
        openCursor: () => {
          // Ascending-by-ts cursor.
          const sorted = [...data.values()].sort((a, b) => a.ts - b.ts);
          let i = 0;
          const req: FakeRequest = { onsuccess: null, onerror: null, result: undefined };
          const step = () => {
            queueMicrotask(() => {
              if (i >= sorted.length) {
                req.result = null;
                req.onsuccess?.({ target: req });
                return;
              }
              const rec = sorted[i];
              req.result = {
                value: rec,
                delete: () => data.delete(rec.url),
                continue: () => {
                  i++;
                  step();
                },
              };
              req.onsuccess?.({ target: req });
            });
          };
          step();
          return req;
        },
      }),
      createIndex: () => {},
    };
  }

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => makeStore(),
    transaction: () => {
      const tx: FakeTransaction = { oncomplete: null, onerror: null, onabort: null, objectStore: () => makeStore() };
      // Resolve the transaction as complete after pending request microtasks.
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.({ target: tx })));
      return tx;
    },
    close: () => {},
    onversionchange: null,
  };

  return {
    _data: data,
    open: () => {
      const req: FakeOpenRequest = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: db };
      queueMicrotask(() => {
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}
