import { useState, useRef } from 'react';
import { Loader2, Zap, ImagePlus, X, Upload, FileSpreadsheet, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { loadSpreadsheetModule, parseSheet } from '@/lib/fileParser';

interface AuditEnhanceProps {
  onAudit: (requirement: string, existingTestCases: Record<string, string>[], imagesBase64?: string[]) => Promise<void>;
  isAuditing: boolean;
  onClear: () => void;
}

const MAX_IMAGES = 5;

export function AuditEnhance({ onAudit, isAuditing, onClear }: AuditEnhanceProps) {
  const [requirement, setRequirement] = useState('');
  const [images, setImages] = useState<{ preview: string; base64: string }[]>([]);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast({ title: 'Max images reached', description: `You can upload up to ${MAX_IMAGES} images.`, variant: 'destructive' });
      return;
    }

    const toProcess = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
    
    toProcess.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setImages(prev => [...prev, { preview: result, base64: result }]);
      };
      reader.readAsDataURL(file);
    });

    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllImages = () => {
    setImages([]);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const processFile = async (file: File) => {
    try {
      const XLSX = await loadSpreadsheetModule();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = parseSheet(firstSheet, XLSX);
      
      if (rows.length === 0) {
        toast({ title: 'Empty file', description: `"${file.name}" has no data rows.`, variant: 'destructive' });
        return;
      }
      setUploadedFile({ name: file.name, rows });
      toast({ title: 'File loaded', description: `Loaded ${rows.length} test cases to audit.` });
    } catch (err) {
      console.error('File parse error:', err);
      toast({ title: 'Parse error', description: `Could not read "${file.name}".`, variant: 'destructive' });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.[0]) {
      const file = e.dataTransfer.files[0];
      const validExts = ['.xlsx', '.xls', '.csv'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (validExts.includes(ext)) {
        processFile(file);
      } else {
        toast({ title: 'Invalid file type', description: 'Please drop a valid XLSX or CSV file.', variant: 'destructive' });
      }
    }
  };

  const handleAudit = async () => {
    const imagesBase64 = images.length > 0 ? images.map(img => img.base64) : undefined;
    await onAudit(requirement, uploadedFile?.rows || [], imagesBase64);
  };

  const handleClear = () => {
    setRequirement('');
    clearAllImages();
    setUploadedFile(null);
    onClear();
  };

  const hasContent = (requirement.trim() || images.length > 0) && uploadedFile;

  return (
    <div className="relative group">
      <div className="absolute -inset-[1px] gradient-primary rounded-2xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500" />
      
      <div className="relative gradient-card rounded-2xl border border-border/60 p-6 space-y-6 shadow-md">
        
        <div>
          <h3 className="text-lg font-bold font-display text-foreground mb-1">Audit & Enhance</h3>
          <p className="text-sm text-muted-foreground">Provide requirement/story, attach design sketches, and upload existing test cases to find gaps and generate missing scenarios.</p>
        </div>

        {/* Story / Requirement Input */}
        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full gradient-primary" />
            Paste User Story / Requirement:
          </label>
          <Textarea
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder="As a user I want to..."
            className="min-h-[120px] resize-y font-mono text-sm bg-muted/30 border-border/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-xl transition-all"
            disabled={isAuditing}
          />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* File Upload Section */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent" />
              Upload Existing Test Cases (XLSX/CSV):
            </label>
            
            {uploadedFile ? (
              <div className="flex items-center justify-between bg-muted/30 rounded-xl p-4 border border-border/40 min-h-[120px]">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <FileSpreadsheet className="h-5 w-5 text-primary flex-shrink-0" />
                    <span className="text-sm font-medium truncate">{uploadedFile.name}</span>
                  </div>
                  <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-md font-bold self-start">
                    {uploadedFile.rows.length} test cases
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setUploadedFile(null)}
                  disabled={isAuditing}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-xl min-h-[120px] flex flex-col items-center justify-center cursor-pointer transition-all p-4 text-center',
                  dragOver ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-primary/40 hover:bg-muted/30'
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={isAuditing}
                />
                <Upload className="h-6 w-6 mb-2 text-muted-foreground" />
                <p className="text-sm font-semibold text-foreground">Drop file or click</p>
                <p className="text-xs text-muted-foreground mt-1">XLSX / CSV</p>
              </div>
            )}
          </div>

          {/* Multiple Image Upload Section */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
              Attach Sketches / Mockups (Up to {MAX_IMAGES}):
            </label>
            
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
              disabled={isAuditing}
            />
            
            {images.length > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  {images.map((img, index) => (
                    <div key={index} className="relative aspect-square">
                      <img
                        src={img.preview}
                        alt={`Uploaded ${index + 1}`}
                        className="h-full w-full rounded-lg border border-border/60 object-cover bg-muted/30"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full shadow-md"
                        onClick={() => removeImage(index)}
                        disabled={isAuditing}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <Button
                      variant="outline"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isAuditing}
                      className="aspect-square border-dashed border-border/60 hover:bg-muted/50 rounded-lg flex-col gap-1 h-auto"
                    >
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">Add more</span>
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {images.length}/{MAX_IMAGES} images
                </p>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => imageInputRef.current?.click()}
                disabled={isAuditing}
                className="w-full gap-2 border-dashed border-border/60 hover:bg-muted/50 min-h-[120px] rounded-xl flex-col"
              >
                <ImagePlus className="h-6 w-6 text-muted-foreground mb-1" />
                <span className="text-sm text-foreground">Upload Images</span>
                <span className="text-xs text-muted-foreground font-normal">Up to {MAX_IMAGES} sketches or mockups</span>
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleAudit}
            disabled={isAuditing || !hasContent}
            size="lg"
            className="flex-1 gap-2 gradient-primary hover:opacity-90 transition-all shadow-md hover:shadow-glow font-semibold h-12 rounded-xl"
          >
            {isAuditing ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Analyzing gaps...</span>
              </>
            ) : (
              <>
                <Zap className="h-5 w-5" />
                <span>Audit & Generate Missing Cases</span>
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            size="lg"
            onClick={handleClear} 
            className="gap-2 border-border/60 hover:bg-muted/50 h-12 rounded-xl px-5"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>

        {isAuditing && (
          <div className="p-4 gradient-subtle border border-primary/20 rounded-xl animate-fade-in">
            <p className="text-sm font-medium flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 gradient-primary"></span>
              </span>
              <span className="text-foreground">AI is reading the story & {images.length > 0 ? `${images.length} image(s)` : 'input'}, reviewing existing tests, and finding what's missing...</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
