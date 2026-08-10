import { useState } from 'react';
import { Clock3, History, ScrollText } from 'lucide-react';
import { ArtifactHistoryPanel } from '@/components/ArtifactHistoryPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ArtifactHistoryEntry } from '@/types/artifactHistory';
import type { HistoryEntry } from '@/types/testCase';

interface HistoryDrawerProps {
  history: HistoryEntry[];
  artifactHistory: ArtifactHistoryEntry[];
  onLoad: (entry: HistoryEntry) => Promise<void>;
  onDelete: (id: string) => void;
  onClear: () => void;
  onDeleteArtifact: (id: string) => void;
  onClearArtifacts: () => void;
  restoreDisabled?: boolean;
}

export function HistoryDrawer({
  history,
  artifactHistory,
  onLoad,
  onDelete,
  onClear,
  onDeleteArtifact,
  onClearArtifacts,
  restoreDisabled = false,
}: HistoryDrawerProps) {
  const [open, setOpen] = useState(false);
  const totalEntries = history.length + artifactHistory.length;

  const handleLoad = async (entry: HistoryEntry) => {
    await onLoad(entry);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="h-11 shrink-0 gap-2 rounded-xl border-border/60 bg-card/80 px-4 shadow-sm hover:border-primary/40 hover:bg-card"
        >
          <History className="h-4 w-4 text-primary" />
          <span className="font-semibold">History</span>
          <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-bold text-primary">
            {totalEntries}
          </span>
        </Button>
      </SheetTrigger>

      <SheetContent className="flex h-full w-[min(94vw,640px)] flex-col gap-0 overflow-hidden border-border/70 bg-background p-0 sm:max-w-[640px]">
        <SheetHeader className="border-b border-border/60 bg-card/70 px-6 py-5 pr-14 text-left">
          <div className="flex items-center gap-3">
            <div className="rounded-xl gradient-primary p-2.5 shadow-glow">
              <Clock3 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <SheetTitle className="font-display text-xl">QA Workspace History</SheetTitle>
              <SheetDescription>
                Restore generated suites or reuse saved planning artifacts without reducing the result-table width.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {restoreDisabled && (
          <div className="border-b border-accent/30 bg-accent/10 px-6 py-3 text-xs font-medium text-accent-foreground">
            History restore is paused until the current generation and automatic quality gate finish.
          </div>
        )}

        <Tabs defaultValue="suites" className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border/60 px-5 py-3">
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl bg-muted/60 p-1">
              <TabsTrigger value="suites" className="gap-2 rounded-lg font-semibold">
                <History className="h-4 w-4" />
                Test Suites ({history.length})
              </TabsTrigger>
              <TabsTrigger value="artifacts" className="gap-2 rounded-lg font-semibold">
                <ScrollText className="h-4 w-4" />
                Artifacts ({artifactHistory.length})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="suites" className="mt-0 min-h-0 flex-1 overflow-y-auto p-5">
            <HistoryPanel
              history={history}
              onLoad={handleLoad}
              onDelete={onDelete}
              onClear={onClear}
              disabled={restoreDisabled}
            />
          </TabsContent>
          <TabsContent value="artifacts" className="mt-0 min-h-0 flex-1 overflow-y-auto p-5">
            <ArtifactHistoryPanel
              history={artifactHistory}
              onDelete={onDeleteArtifact}
              onClear={onClearArtifacts}
            />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
