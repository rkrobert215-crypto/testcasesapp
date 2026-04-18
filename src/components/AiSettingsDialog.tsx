import { useEffect, useMemo, useState } from 'react';
import { Bot, KeyRound, Settings2 } from 'lucide-react';
import {
  AiProvider,
  AiSettings,
  CLAUDE_MODEL_OPTIONS,
  DEFAULT_AI_SETTINGS,
  GEMINI_MODEL_OPTIONS,
  GENERATION_MODE_OPTIONS,
  OPENROUTER_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  PROVIDER_MODEL_LABELS,
  PROVIDER_OPTIONS,
} from '@/lib/aiSettings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface AiSettingsDialogProps {
  settings: AiSettings;
  migrationNotices?: string[];
  isReady: boolean;
  onSave: (settings: AiSettings) => void;
}

export function AiSettingsDialog({ settings, migrationNotices = [], isReady, onSave }: AiSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AiSettings>(settings);

  useEffect(() => {
    if (open) {
      setDraft(settings);
    }
  }, [open, settings]);

  const providerLabel = useMemo(
    () => PROVIDER_OPTIONS.find((option) => option.value === settings.provider)?.label ?? 'OpenAI',
    [settings.provider]
  );
  const currentGeminiOption = useMemo(
    () => GEMINI_MODEL_OPTIONS.find((option) => option.value === draft.geminiModel) ?? GEMINI_MODEL_OPTIONS[0],
    [draft.geminiModel]
  );
  const currentOpenAiOption = useMemo(
    () => OPENAI_MODEL_OPTIONS.find((option) => option.value === draft.openaiModel) ?? OPENAI_MODEL_OPTIONS[0],
    [draft.openaiModel]
  );
  const currentClaudeOption = useMemo(
    () => CLAUDE_MODEL_OPTIONS.find((option) => option.value === draft.claudeModel) ?? CLAUDE_MODEL_OPTIONS[0],
    [draft.claudeModel]
  );
  const currentOpenRouterOption = useMemo(
    () => OPENROUTER_MODEL_OPTIONS.find((option) => option.value === draft.openrouterModel) ?? null,
    [draft.openrouterModel]
  );

  const handleSave = () => {
    onSave(draft);
    setOpen(false);
  };

  const handleReset = () => {
    setDraft(DEFAULT_AI_SETTINGS);
  };

  const currentModelLabel =
    draft.provider === 'openai'
      ? currentOpenAiOption.label
      : draft.provider === 'claude'
        ? currentClaudeOption.label
        : draft.provider === 'gemini'
          ? currentGeminiOption.label
          : draft.provider === 'openrouter'
            ? currentOpenRouterOption?.label ?? draft.openrouterModel
          : PROVIDER_MODEL_LABELS[draft.provider];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 border-border/60 hover:bg-muted/50">
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">AI Settings</span>
          <Badge variant="secondary" className="hidden md:inline-flex capitalize">
            {providerLabel}
          </Badge>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden border-border/60 bg-background/95 p-0 backdrop-blur">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="shrink-0 px-6 pb-4 pt-6">
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-primary" />
              AI Provider Settings
            </DialogTitle>
            <DialogDescription>
              Save your provider choice, models, and optional browser-side API keys. The selected provider is used for
              generation, audit, merge, coverage validation, and requirement analysis. Generation style now applies
              across all AI tabs.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <div className="space-y-6">
              {migrationNotices.length > 0 && (
                <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
                  <p className="font-medium text-foreground">Settings updated</p>
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    {migrationNotices.map((notice) => (
                      <p key={notice}>{notice}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3">
                <Label htmlFor="generation-mode">Generation style</Label>
                <Select
                  value={draft.generationMode}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      generationMode: value as AiSettings['generationMode'],
                    }))
                  }
                  disabled={!isReady}
                >
                  <SelectTrigger id="generation-mode" className="h-11 border-border/60 bg-muted/20">
                    <SelectValue placeholder="Choose a generation style" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENERATION_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {GENERATION_MODE_OPTIONS.find((option) => option.value === draft.generationMode)?.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  `Rob` keeps the AI tabs closer to clean permission-aware `Verify that the user...` QA wording.
                  `Yuv` pushes broader module, page, UI, and navigation coverage. `SWAG` applies a benchmark-style
                  web-app checklist. `Professional Standard` keeps the output formal, complete, and audit-ready.
                </p>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="space-y-1">
                  <Label htmlFor="strict-requirement-mode">Strict exact requirement mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Keeps AI output closer to exact labels, config keys, fixed logic terms, and stated acceptance
                    criteria. It also blocks invented setup screens, modals, or config-management flows unless the
                    requirement explicitly mentions them.
                  </p>
                </div>
                <Switch
                  id="strict-requirement-mode"
                  checked={draft.strictRequirementMode}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      strictRequirementMode: checked,
                    }))
                  }
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="provider">Primary provider</Label>
                <Select
                  value={draft.provider}
                  onValueChange={(value) => setDraft((current) => ({ ...current, provider: value as AiProvider }))}
                  disabled={!isReady}
                >
                  <SelectTrigger id="provider" className="h-11 border-border/60 bg-muted/20">
                    <SelectValue placeholder="Choose an AI provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {PROVIDER_OPTIONS.find((option) => option.value === draft.provider)?.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  Current model: <span className="font-mono text-foreground">{currentModelLabel}</span>
                </p>
              </div>

              {draft.provider === 'openai' && (
                <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                  <ApiKeyField
                    id="openai-key"
                    label="OpenAI API key"
                    value={draft.openaiApiKey}
                    onChange={(value) => setDraft((current) => ({ ...current, openaiApiKey: value }))}
                    placeholder="sk-..."
                  />

                  <div className="grid gap-3">
                    <Label htmlFor="openai-model">OpenAI model</Label>
                    <Select
                      value={draft.openaiModel}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          openaiModel: value as AiSettings['openaiModel'],
                        }))
                      }
                    >
                      <SelectTrigger id="openai-model" className="h-11 border-border/60 bg-background">
                        <SelectValue placeholder="Choose an OpenAI model" />
                      </SelectTrigger>
                      <SelectContent>
                        {OPENAI_MODEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{currentOpenAiOption.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Selected OpenAI model ID:{' '}
                      <span className="font-mono text-foreground">{currentOpenAiOption.value}</span>.
                    </p>
                  </div>
                </div>
              )}

              {draft.provider === 'claude' && (
                <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                  <ApiKeyField
                    id="claude-key"
                    label="Anthropic Claude API key"
                    value={draft.claudeApiKey}
                    onChange={(value) => setDraft((current) => ({ ...current, claudeApiKey: value }))}
                    placeholder="sk-ant-..."
                  />

                  <div className="grid gap-3">
                    <Label htmlFor="claude-model">Claude model</Label>
                    <Select
                      value={draft.claudeModel}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          claudeModel: value as AiSettings['claudeModel'],
                        }))
                      }
                    >
                      <SelectTrigger id="claude-model" className="h-11 border-border/60 bg-background">
                        <SelectValue placeholder="Choose a Claude model" />
                      </SelectTrigger>
                      <SelectContent>
                        {CLAUDE_MODEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{currentClaudeOption.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Selected Claude model ID:{' '}
                      <span className="font-mono text-foreground">{currentClaudeOption.value}</span>.
                    </p>
                  </div>
                </div>
              )}

              {draft.provider === 'gemini' && (
                <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                  <ApiKeyField
                    id="gemini-key"
                    label="Google Gemini API key"
                    value={draft.geminiApiKey}
                    onChange={(value) => setDraft((current) => ({ ...current, geminiApiKey: value }))}
                    placeholder="AIza..."
                  />

                  <div className="grid gap-3">
                    <Label htmlFor="gemini-model">Gemini model</Label>
                    <Select
                      value={draft.geminiModel}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          geminiModel: value as AiSettings['geminiModel'],
                        }))
                      }
                    >
                      <SelectTrigger id="gemini-model" className="h-11 border-border/60 bg-background">
                        <SelectValue placeholder="Choose a Gemini model" />
                      </SelectTrigger>
                      <SelectContent>
                        {GEMINI_MODEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{currentGeminiOption.description}</p>
                    <p className="text-xs text-muted-foreground">
                      Selected Gemini model ID:{' '}
                      <span className="font-mono text-foreground">{currentGeminiOption.value}</span>
                      {currentGeminiOption.value === 'gemini-3-flash-preview' ? ' (preview).' : '.'}
                    </p>
                  </div>
                </div>
              )}

              {draft.provider === 'groq' && (
                <ApiKeyField
                  id="groq-key"
                  label="Groq API key"
                  value={draft.groqApiKey}
                  onChange={(value) => setDraft((current) => ({ ...current, groqApiKey: value }))}
                  placeholder="gsk_..."
                />
              )}

              {draft.provider === 'openrouter' && (
                <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
                  <ApiKeyField
                    id="openrouter-key"
                    label="OpenRouter API key"
                    value={draft.openrouterApiKey}
                    onChange={(value) => setDraft((current) => ({ ...current, openrouterApiKey: value }))}
                    placeholder="sk-or-..."
                  />

                  <div className="grid gap-3">
                    <Label htmlFor="openrouter-model">OpenRouter router/model</Label>
                    <Select
                      value={currentOpenRouterOption?.value ?? '__custom__'}
                      onValueChange={(value) => {
                        if (value === '__custom__') {
                          return;
                        }

                        setDraft((current) => ({
                          ...current,
                          openrouterModel: value,
                        }));
                      }}
                    >
                      <SelectTrigger id="openrouter-model" className="h-11 border-border/60 bg-background">
                        <SelectValue placeholder="Choose an OpenRouter router or model" />
                      </SelectTrigger>
                      <SelectContent>
                        {OPENROUTER_MODEL_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">Custom model slug</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {currentOpenRouterOption?.description ?? 'Use any valid OpenRouter model slug if you want a specific provider/model through one key.'}
                    </p>
                  </div>

                  <div className="grid gap-3">
                    <Label htmlFor="openrouter-model-custom">Custom OpenRouter model slug</Label>
                    <Input
                      id="openrouter-model-custom"
                      value={draft.openrouterModel}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          openrouterModel: event.target.value,
                        }))
                      }
                      placeholder="openrouter/free or anthropic/claude-sonnet-4"
                      autoComplete="off"
                      spellCheck={false}
                      className="h-11 border-border/60 bg-background font-mono"
                    />
                    <p className="text-xs text-muted-foreground">
                      Selected OpenRouter model ID:{' '}
                      <span className="font-mono text-foreground">{draft.openrouterModel || 'openrouter/free'}</span>.
                    </p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Stored locally</p>
                <p className="mt-1">
                  These keys are saved only in your browser&apos;s local storage. In localhost mode with your local
                  backend, they are sent with each AI request so the edge functions can use your chosen provider.
                </p>
                <p className="mt-2">
                  In a hosted deployment, the app sends your provider, model, and style selection but expects the real
                  provider key to come from Supabase Edge Function secrets.
                </p>
                <p className="mt-2">
                  Use this only on your own machine. Browser local storage is convenient for personal local use, not a
                  secure secret vault for shared or public devices.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t border-border/60 bg-background/95 px-6 py-4">
            <Button variant="outline" onClick={handleReset}>
              Reset
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isReady}>
              Save Locally
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ApiKeyFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

function ApiKeyField({ id, label, value, onChange, placeholder }: ApiKeyFieldProps) {
  return (
    <div className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
      <Label htmlFor={id} className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="h-11 border-border/60 bg-background font-mono"
      />
    </div>
  );
}
