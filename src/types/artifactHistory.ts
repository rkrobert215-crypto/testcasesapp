export type ArtifactType =
  | 'requirement-analysis'
  | 'test-plan'
  | 'traceability-matrix'
  | 'test-data-plan'
  | 'scenario-map'
  | 'clarifications';

export interface ArtifactHistoryEntry {
  id: string;
  timestamp: number;
  type: ArtifactType;
  title: string;
  requirementSummary: string;
  copyText: string;
}

export interface SaveArtifactInput {
  type: ArtifactType;
  title: string;
  requirementText: string;
  copyText: string;
}
