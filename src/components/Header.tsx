import { FlaskConical, Sparkles } from 'lucide-react';
import { AiSettingsDialog } from './AiSettingsDialog';
import { ThemeToggle } from './ThemeToggle';
import { useAiSettings } from '@/hooks/useAiSettings';

export function Header() {
  const { settings, migrationNotices, isReady, saveSettings } = useAiSettings();

  return (
    <header className="border-b border-border/50 glass-strong sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 gradient-primary rounded-xl blur-lg opacity-50 animate-pulse-subtle" />
            <div className="relative p-2.5 rounded-xl gradient-primary shadow-glow">
              <FlaskConical className="h-6 w-6 text-primary-foreground" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold font-display text-foreground flex items-center gap-2 whitespace-nowrap">
              Test Case Generator
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider gradient-primary text-primary-foreground">
                <Sparkles className="h-3 w-3" />
                AI
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Transform requirements into comprehensive test coverage
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AiSettingsDialog
            settings={settings}
            migrationNotices={migrationNotices}
            isReady={isReady}
            onSave={saveSettings}
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
