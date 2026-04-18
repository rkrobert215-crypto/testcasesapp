import { useEffect, useState } from 'react';
import {
  AiSettings,
  DEFAULT_AI_SETTINGS,
  loadStoredAiSettings,
  normalizeAiSettings,
  persistAiSettings,
} from '@/lib/aiSettings';

export function useAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [migrationNotices, setMigrationNotices] = useState<string[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const stored = loadStoredAiSettings();
    setSettings(stored.settings);
    setMigrationNotices(stored.migrationNotices);
    setIsReady(true);
  }, []);

  const saveSettings = (value: AiSettings) => {
    const normalized = normalizeAiSettings(value);
    setSettings(normalized);
    setMigrationNotices([]);
    persistAiSettings(normalized);
  };

  const resetSettings = () => {
    saveSettings(DEFAULT_AI_SETTINGS);
  };

  return {
    settings,
    migrationNotices,
    isReady,
    saveSettings,
    resetSettings,
  };
}
