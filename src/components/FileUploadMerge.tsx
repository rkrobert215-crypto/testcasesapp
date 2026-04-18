import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X, Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TestCase } from '@/types/testCase';
import { toast } from '@/hooks/use-toast';
import { loadSpreadsheetModule, parseSheet } from '@/lib/fileParser';

interface FileUploadMergeProps {
  onMergedResult: (testCases: TestCase[], inputSummary: string) => void;
  isProcessing: boolean;
  onProcess: (parsedRows: Record<string, string>[][]) => Promise<void>;
}

interface UploadedFile {
  name: string;
  rows: Record<string, string>[];
}

const MAX_FILES = 5;

export function FileUploadMerge({ onMergedResult: _onMergedResult, isProcessing, onProcess }: FileUploadMergeProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File): Promise<UploadedFile | null> => {
    try {
      const XLSX = await loadSpreadsheetModule();
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = parseSheet(firstSheet, XLSX);

      if (rows.length === 0) {
        toast({
          title: 'Empty file',
          description: `"${file.name}" has no data rows.`,
          variant: 'destructive',
        });
        return null;
      }

      return { name: file.name, rows };
    } catch (err) {
      console.error('File parse error:', err);
      toast({
        title: 'Parse error',
        description: `Could not read "${file.name}". Ensure it's a valid XLSX or CSV file.`,
        variant: 'destructive',
      });
      return null;
    }
  };

  const handleFiles = async (fileList: FileList) => {
    const remaining = MAX_FILES - files.length;
    if (remaining <= 0) {
      toast({ title: 'Max files reached', description: `You can upload up to ${MAX_FILES} files.`, variant: 'destructive' });
      return;
    }

    const toProcess = Array.from(fileList).slice(0, remaining);
    const validExts = ['.xlsx', '.xls', '.csv'];

    const results: UploadedFile[] = [];
    for (const file of toProcess) {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      if (!validExts.includes(ext)) {
        toast({ title: 'Invalid file type', description: `"${file.name}" is not XLSX or CSV.`, variant: 'destructive' });
        continue;
      }
      const parsed = await processFile(file);
      if (parsed) results.push(parsed);
    }

    if (results.length > 0) {
      setFiles((prev) => [...prev, ...results]);
      toast({
        title: 'Files loaded',
        description: `Loaded ${results.length} file(s) with ${results.reduce((sum, file) => sum + file.rows.length, 0)} total rows.`,
      });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) handleFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSmartMerge = async () => {
    if (files.length === 0) return;
    await onProcess(files.map((file) => file.rows));
  };

  const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0);

  return (
    <div className="relative group">
      <div className="absolute -inset-[1px] gradient-primary rounded-2xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500" />

      <div className="relative gradient-card rounded-2xl border border-border/60 p-6 space-y-5 shadow-md">
        <div className="flex items-center gap-3">
          <div className="p-2 gradient-primary rounded-lg">
            <FileSpreadsheet className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-lg font-bold font-display text-foreground">Smart Merge & Refine</h3>
            <p className="text-xs text-muted-foreground">Upload XLSX/CSV test case files - AI deduplicates and generates smarter test cases</p>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
            dragOver ? 'border-primary bg-primary/10' : 'border-border/60 hover:border-primary/40 hover:bg-muted/30'
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={handleInputChange}
            className="hidden"
            disabled={isProcessing}
          />
          <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Drop XLSX/CSV files here or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">Up to {MAX_FILES} files - Supports .xlsx, .xls, .csv</p>
        </div>

        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((file, index) => (
              <div key={index} className="flex items-center justify-between bg-muted/30 rounded-lg px-4 py-2.5 border border-border/40">
                <div className="flex items-center gap-3 min-w-0">
                  <FileSpreadsheet className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-sm font-medium truncate">{file.name}</span>
                  <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-bold flex-shrink-0">
                    {file.rows.length} rows
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => removeFile(index)}
                  disabled={isProcessing}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>Total: {totalRows} test case rows across {files.length} file(s)</span>
            </div>
          </div>
        )}

        <Button
          onClick={handleSmartMerge}
          disabled={files.length === 0 || isProcessing}
          size="lg"
          className="w-full gap-2 gradient-primary hover:opacity-90 transition-all shadow-md hover:shadow-glow font-semibold h-12 rounded-xl"
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>AI is analyzing and merging...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" />
              <span>Smart Merge & Refine ({totalRows} test cases)</span>
            </>
          )}
        </Button>

        {isProcessing && (
          <div className="p-4 gradient-subtle border border-primary/20 rounded-xl animate-fade-in">
            <p className="text-sm font-medium flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 gradient-primary"></span>
              </span>
              <span className="text-foreground">AI is comparing all files, removing duplicates, and generating smarter test cases...</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
