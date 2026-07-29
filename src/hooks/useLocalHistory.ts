import { useEffect, useState } from 'react';
import { HistoryEntry, TestCase, InputType } from '@/types/testCase';

const STORAGE_KEY = 'testcase-generator-history';
const IMAGE_DB_NAME = 'testcase-generator-history-images';
const IMAGE_STORE_NAME = 'images';
const MAX_HISTORY = 20;

export function useLocalHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const storedEntries = readStoredHistory();
    setHistory(storedEntries);

    void hydrateHistoryImages(storedEntries).then((hydratedEntries) => {
      if (!cancelled) {
        setHistory((currentHistory) => {
          const hydratedById = new Map(hydratedEntries.map((entry) => [entry.id, entry]));
          const currentIds = new Set(currentHistory.map((entry) => entry.id));
          return [
            ...currentHistory.map((entry) => hydratedById.get(entry.id) || entry),
            ...hydratedEntries.filter((entry) => !currentIds.has(entry.id)),
          ].slice(0, MAX_HISTORY);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const saveToHistory = (
    inputType: InputType,
    inputText: string,
    testCases: TestCase[],
    options?: { inputSummary?: string; imagesBase64?: string[] }
  ) => {
    if (testCases.length === 0) return;

    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      inputType,
      inputSummary: options?.inputSummary || inputText.slice(0, 100) + (inputText.length > 100 ? '...' : ''),
      inputText,
      imagesBase64: options?.imagesBase64,
      testCases,
    };

    setHistory((currentHistory) => {
      const nextHistory = [entry, ...currentHistory].slice(0, MAX_HISTORY);
      const persistedHistory = persistHistoryMetadata(nextHistory);
      const retainedIds = new Set(persistedHistory.map((item) => item.id));
      for (const removedEntry of currentHistory.filter((item) => !retainedIds.has(item.id))) {
        void deleteHistoryImages(removedEntry.id);
      }
      return persistedHistory;
    });

    if (entry.imagesBase64?.length) {
      void saveHistoryImages(entry.id, entry.imagesBase64);
    }
  };

  const deleteEntry = (id: string) => {
    setHistory((currentHistory) => {
      const nextHistory = currentHistory.filter((entry) => entry.id !== id);
      persistHistoryMetadata(nextHistory);
      return nextHistory;
    });
    void deleteHistoryImages(id);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    void clearHistoryImages();
  };

  return {
    history,
    saveToHistory,
    deleteEntry,
    clearHistory,
  };
}

function readStoredHistory(): HistoryEntry[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const entries = parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY);
    const legacyEntriesWithImages = entries.filter((entry) => entry.imagesBase64?.length);
    if (legacyEntriesWithImages.length > 0) {
      for (const entry of legacyEntriesWithImages) {
        void saveHistoryImages(entry.id, entry.imagesBase64 || []);
      }
      persistHistoryMetadata(entries);
    }
    return entries;
  } catch {
    return [];
  }
}

function persistHistoryMetadata(entries: HistoryEntry[]) {
  for (let retainedCount = entries.length; retainedCount >= 0; retainedCount -= 1) {
    const retainedEntries = entries.slice(0, retainedCount);
    const metadataOnly = retainedEntries.map((entry) => {
      const metadata = { ...entry };
      delete metadata.imagesBase64;
      return metadata;
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(metadataOnly));
      return retainedEntries;
    } catch (error) {
      if (!isStorageQuotaError(error)) {
        console.warn('Unable to persist testcase history:', error);
        return retainedEntries;
      }
    }
  }
  return [];
}

async function hydrateHistoryImages(entries: HistoryEntry[]) {
  if (!supportsIndexedDb()) {
    return entries;
  }

  return await Promise.all(
    entries.map(async (entry) => {
      if (entry.imagesBase64?.length) {
        return entry;
      }
      const imagesBase64 = await getHistoryImages(entry.id);
      return imagesBase64?.length ? { ...entry, imagesBase64 } : entry;
    })
  );
}

function saveHistoryImages(id: string, imagesBase64: string[]) {
  return withImageStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(imagesBase64, id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getHistoryImages(id: string) {
  return withImageStore<string[] | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () =>
      resolve(Array.isArray(request.result) ? request.result.filter((item) => typeof item === 'string') : undefined);
    request.onerror = () => reject(request.error);
  });
}

function deleteHistoryImages(id: string) {
  return withImageStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearHistoryImages() {
  return withImageStore<void>('readwrite', (store, resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function withImageStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> {
  if (!supportsIndexedDb()) {
    return Promise.resolve(undefined as T);
  }

  return new Promise<T>((resolve, reject) => {
    const openRequest = indexedDB.open(IMAGE_DB_NAME, 1);
    openRequest.onupgradeneeded = () => {
      if (!openRequest.result.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        openRequest.result.createObjectStore(IMAGE_STORE_NAME);
      }
    };
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(IMAGE_STORE_NAME, mode);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      action(transaction.objectStore(IMAGE_STORE_NAME), resolve, reject);
    };
  }).catch((error) => {
    console.warn('Unable to persist testcase history images:', error);
    return undefined as T;
  });
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.timestamp === 'number' &&
    typeof entry.inputType === 'string' &&
    typeof entry.inputSummary === 'string' &&
    Array.isArray(entry.testCases)
  );
}

function supportsIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function isStorageQuotaError(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}
