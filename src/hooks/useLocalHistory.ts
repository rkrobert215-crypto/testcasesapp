import { useState, useEffect } from 'react';
import { HistoryEntry, TestCase, InputType } from '@/types/testCase';

const STORAGE_KEY = 'testcase-generator-history';
const MAX_HISTORY = 20;

export function useLocalHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setHistory(JSON.parse(stored));
      } catch {
        setHistory([]);
      }
    }
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

    const newHistory = [entry, ...history].slice(0, MAX_HISTORY);
    setHistory(newHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  };

  const deleteEntry = (id: string) => {
    const newHistory = history.filter(h => h.id !== id);
    setHistory(newHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    history,
    saveToHistory,
    deleteEntry,
    clearHistory,
  };
}
