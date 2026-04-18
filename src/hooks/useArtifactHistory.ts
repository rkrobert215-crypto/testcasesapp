import { useEffect, useState } from 'react';
import { ArtifactHistoryEntry, SaveArtifactInput } from '@/types/artifactHistory';

const STORAGE_KEY = 'qa-artifact-history';
const MAX_HISTORY = 30;

function summarizeRequirement(requirementText: string) {
  const compact = requirementText.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return 'Saved artifact';
  }

  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
}

export function useArtifactHistory() {
  const [artifactHistory, setArtifactHistory] = useState<ArtifactHistoryEntry[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setArtifactHistory(JSON.parse(stored));
      } catch {
        setArtifactHistory([]);
      }
    }
  }, []);

  const saveArtifact = (input: SaveArtifactInput) => {
    const entry: ArtifactHistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: input.type,
      title: input.title,
      requirementSummary: summarizeRequirement(input.requirementText),
      copyText: input.copyText,
    };

    const nextHistory = [entry, ...artifactHistory].slice(0, MAX_HISTORY);
    setArtifactHistory(nextHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
  };

  const deleteArtifact = (id: string) => {
    const nextHistory = artifactHistory.filter((entry) => entry.id !== id);
    setArtifactHistory(nextHistory);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextHistory));
  };

  const clearArtifacts = () => {
    setArtifactHistory([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return {
    artifactHistory,
    saveArtifact,
    deleteArtifact,
    clearArtifacts,
  };
}
