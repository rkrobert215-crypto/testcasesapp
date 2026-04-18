import React, { useState } from 'react';
import { Copy, Download, Check, Table2, Shield, Loader2, FileSpreadsheet, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TestCase } from '@/types/testCase';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { loadSpreadsheetModule } from '@/lib/fileParser';

interface TestCaseTableProps {
  testCases: TestCase[];
  onValidateCoverage?: () => void;
  isValidating?: boolean;
  inputSummary?: string;
  onDeleteTestCase?: (index: number) => void;
}

const TYPE_COLORS: Record<string, string> = {
  Positive: 'bg-positive/15 text-positive border-positive/40',
  Negative: 'bg-negative/15 text-negative border-negative/40',
  Edge: 'bg-edge/15 text-edge border-edge/40',
  Security: 'bg-security/15 text-security border-security/40',
};

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-negative/15 text-negative border-negative/40',
  High: 'bg-primary/15 text-primary border-primary/40',
  Medium: 'bg-accent/15 text-accent border-accent/40',
  Low: 'bg-muted text-muted-foreground border-border/60',
};

type ColumnKey = keyof TestCase;

const COLUMNS: { key: ColumnKey; label: string; width: string }[] = [
  { key: 'id', label: 'TC ID', width: 'w-24' },
  { key: 'requirementReference', label: 'Requirement Ref', width: 'w-32' },
  { key: 'module', label: 'Module', width: 'w-32' },
  { key: 'priority', label: 'Priority', width: 'w-24' },
  { key: 'coverageArea', label: 'Coverage Area', width: 'w-36' },
  { key: 'scenario', label: 'Scenario', width: 'w-40' },
  { key: 'testCase', label: 'Test Case', width: 'w-48' },
  { key: 'testData', label: 'Test Data', width: 'w-40' },
  { key: 'preconditions', label: 'Preconditions', width: 'w-40' },
  { key: 'testSteps', label: 'Test Steps', width: 'w-64' },
  { key: 'expectedResult', label: 'Expected Result', width: 'w-48' },
  { key: 'postCondition', label: 'Post Condition', width: 'w-40' },
  { key: 'type', label: 'Type', width: 'w-24' },
];

export function TestCaseTable({
  testCases,
  onValidateCoverage,
  isValidating,
  inputSummary,
  onDeleteTestCase,
}: TestCaseTableProps) {
  const [copiedColumn, setCopiedColumn] = useState<string | null>(null);
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [copiedRow, setCopiedRow] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [isExportingXlsx, setIsExportingXlsx] = useState(false);

  const copyCell = (value: string, cellKey: string) => {
    navigator.clipboard.writeText(value);
    setCopiedCell(cellKey);
    setTimeout(() => setCopiedCell(null), 1500);
  };

  const copyColumn = (columnKey: ColumnKey, label: string) => {
    const values = testCases.map((tc) => String(tc[columnKey] ?? '')).join('\r\n');
    navigator.clipboard.writeText(values);
    setCopiedColumn(columnKey);
    setTimeout(() => setCopiedColumn(null), 2000);
    toast({ title: 'Column Copied!', description: `All "${label}" values copied for Excel/Sheets.` });
  };

  const copyRow = (tc: TestCase) => {
    const rowText = COLUMNS.map((column) => String(tc[column.key] ?? '')).join('\t');
    navigator.clipboard.writeText(rowText);
    setCopiedRow(tc.id);
    setTimeout(() => setCopiedRow(null), 1500);
  };

  const copyAll = () => {
    const headers = COLUMNS.map((column) => column.label).join('\t');
    const rows = testCases
      .map((tc) => COLUMNS.map((column) => String(tc[column.key] ?? '')).join('\t'))
      .join('\r\n');
    navigator.clipboard.writeText(`${headers}\r\n${rows}`);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
    toast({ title: 'All Copied!', description: 'All test cases copied (Excel/Sheets compatible).' });
  };

  const generateFileName = (ext: string) => {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5).replace(':', '');

    let smartName = 'TestCases';
    if (inputSummary) {
      const cleaned = inputSummary
        .replace(/^(story[:\s]*|as an?\s|i want to\s|so that\s|acceptance criteria[:\s]*|requirement[:\s]*)/gi, '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 2 && !['the', 'and', 'for', 'that', 'can', 'from', 'with', 'this', 'user', 'want', 'able'].includes(word.toLowerCase()))
        .slice(0, 4)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
      if (cleaned.length > 2) smartName = cleaned;
    }

    return `${smartName} - ${date}_${time}.${ext}`;
  };

  const exportCSV = () => {
    const escape = (str: string) => `"${str.replace(/"/g, '""')}"`;
    const headers = COLUMNS.map((column) => escape(column.label)).join(',');
    const rows = testCases
      .map((tc) => COLUMNS.map((column) => escape(String(tc[column.key] ?? ''))).join(','))
      .join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = generateFileName('csv');
    link.click();
    URL.revokeObjectURL(url);

    toast({ title: 'Exported!', description: 'Downloaded as CSV' });
  };

  const exportXLSX = async () => {
    setIsExportingXlsx(true);

    try {
      const XLSX = await loadSpreadsheetModule();
      const wsData = [
        COLUMNS.map((column) => column.label),
        ...testCases.map((tc) => COLUMNS.map((column) => String(tc[column.key] ?? ''))),
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(wsData);

      worksheet['!cols'] = COLUMNS.map((column) => ({
        wch: Math.min(
          50,
          Math.max(
            column.label.length,
            ...testCases.map((tc) => String(tc[column.key] ?? '').substring(0, 50).length)
          )
        ),
      }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Test Cases');
      XLSX.writeFile(workbook, generateFileName('xlsx'));

      toast({ title: 'Exported!', description: 'Downloaded as XLSX' });
    } catch (error) {
      console.error('XLSX export error:', error);
      toast({
        title: 'Export failed',
        description: 'Could not create the XLSX file.',
        variant: 'destructive',
      });
    } finally {
      setIsExportingXlsx(false);
    }
  };

  if (testCases.length === 0) {
    return null;
  }

  return (
    <div className="gradient-card w-full max-w-full overflow-hidden rounded-2xl border border-border/60 shadow-lg animate-slide-up">
      <div className="px-5 py-4 gradient-primary flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-foreground/20 rounded-lg backdrop-blur-sm">
            <Table2 className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-bold font-display text-primary-foreground">Generated Test Cases</h2>
            <p className="text-xs text-primary-foreground/80">Click column headers to copy for Excel/Sheets</p>
          </div>
          <span className="px-3 py-1.5 bg-primary-foreground/20 backdrop-blur-sm text-primary-foreground rounded-full text-sm font-bold">
            {testCases.length} TCs
          </span>
        </div>
        <div className="flex gap-2">
          {onValidateCoverage && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onValidateCoverage}
              disabled={isValidating}
              className="gap-2 font-semibold"
            >
              {isValidating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4" /> Check Coverage
                </>
              )}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={copyAll}
            className={cn('gap-2 font-semibold transition-all', copiedAll && 'bg-positive text-primary-foreground border-positive')}
          >
            {copiedAll ? (
              <>
                <Check className="h-4 w-4" /> Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" /> Copy All
              </>
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCSV} className="gap-2 font-semibold">
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={exportXLSX}
            disabled={isExportingXlsx}
            className="gap-2 font-semibold"
          >
            {isExportingXlsx ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
            {isExportingXlsx ? 'Preparing...' : 'XLSX'}
          </Button>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-16 font-bold text-foreground">Row</TableHead>
              {COLUMNS.map((column, columnIndex) => (
                <React.Fragment key={column.key}>
                  {columnIndex === 6 && onDeleteTestCase && <TableHead className="w-10 font-bold text-foreground"></TableHead>}
                  <TableHead className={cn(column.width, 'font-bold text-foreground')}>
                    <div className="flex items-center gap-2">
                      <span>{column.label}</span>
                      <button
                        onClick={() => copyColumn(column.key, column.label)}
                        className={cn(
                          'px-2 py-1 text-[10px] font-bold uppercase tracking-wide rounded-md transition-all whitespace-nowrap',
                          copiedColumn === column.key
                            ? 'bg-positive text-primary-foreground'
                            : 'bg-primary/10 text-primary hover:bg-primary/20'
                        )}
                      >
                        {copiedColumn === column.key ? 'Copied' : 'Copy All'}
                      </button>
                    </div>
                  </TableHead>
                </React.Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {testCases.map((tc, index) => (
              <TableRow key={tc.id || index} className="hover:bg-muted/30 transition-colors group">
                <TableCell>
                  <button
                    onClick={() => copyRow(tc)}
                    className={cn(
                      'px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap',
                      copiedRow === tc.id
                        ? 'bg-positive text-primary-foreground'
                        : 'bg-primary/10 text-primary hover:bg-primary/20'
                    )}
                  >
                    {copiedRow === tc.id ? 'Done' : `#${index + 1}`}
                  </button>
                </TableCell>
                {COLUMNS.map((column, columnIndex) => {
                  const cellKey = `${index}-${column.key}`;
                  const value = String(tc[column.key] ?? '');

                  const deleteCell = columnIndex === 6 && onDeleteTestCase ? (
                    <TableCell key="__delete">
                      <button
                        onClick={() => onDeleteTestCase(index)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all opacity-0 group-hover:opacity-100"
                        title="Remove test case"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </TableCell>
                  ) : null;

                  if (column.key === 'type' || column.key === 'priority') {
                    const chipColors =
                      column.key === 'type'
                        ? TYPE_COLORS[value] || 'bg-muted text-muted-foreground'
                        : PRIORITY_COLORS[value] || 'bg-muted text-muted-foreground';

                    return (
                      <React.Fragment key={column.key}>
                        {deleteCell}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className={cn('px-2.5 py-1 rounded-full text-xs font-bold border', chipColors)}>
                              {value || 'N/A'}
                            </span>
                            <button
                              onClick={() => copyCell(value, cellKey)}
                              className={cn(
                                'px-1.5 py-1 text-[10px] font-bold rounded transition-all opacity-0 group-hover:opacity-100',
                                copiedCell === cellKey
                                  ? 'bg-positive text-primary-foreground opacity-100'
                                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                              )}
                            >
                              {copiedCell === cellKey ? 'Done' : 'Copy'}
                            </button>
                          </div>
                        </TableCell>
                      </React.Fragment>
                    );
                  }

                  return (
                    <React.Fragment key={column.key}>
                      {deleteCell}
                      <TableCell
                        className={cn(
                          'text-sm',
                          column.key === 'id' && 'font-mono font-bold text-primary',
                          column.key === 'requirementReference' && 'font-mono text-primary/90',
                          column.key === 'module' && 'font-semibold text-foreground',
                          column.key === 'coverageArea' && 'font-semibold text-accent-foreground',
                          column.key === 'testCase' && 'font-medium',
                          column.key === 'testData' && 'text-muted-foreground',
                          column.key === 'testSteps' && 'whitespace-pre-line text-muted-foreground'
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className="flex-1">{value || 'N/A'}</span>
                          <button
                            onClick={() => copyCell(value, cellKey)}
                            className={cn(
                              'px-1.5 py-1 text-[10px] font-bold rounded transition-all flex-shrink-0 opacity-0 group-hover:opacity-100',
                              copiedCell === cellKey
                                ? 'bg-positive text-primary-foreground opacity-100'
                                : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                            )}
                          >
                            {copiedCell === cellKey ? 'Done' : 'Copy'}
                          </button>
                        </div>
                      </TableCell>
                    </React.Fragment>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
