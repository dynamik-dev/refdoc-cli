export interface Source {
  url: string;
  owner: string;
  repo: string;
  branch: string;
  subpath: string;
  localPath: string;
  addedAt: string;
}

export interface RefdocsConfig {
  paths: string[];
  index: string;
  chunkMaxTokens: number;
  chunkMinTokens: number;
  boostFields: {
    title: number;
    headings: number;
    body: number;
  };
  sources?: Source[];
}

export interface Chunk {
  id: string;
  file: string;
  title: string;
  headings: string;
  body: string;
  startLine: number;
  endLine: number;
  tokenEstimate: number;
}

export interface SearchResult {
  score: number;
  file: string;
  lines: [number, number];
  headings: string[];
  body: string;
}

export interface SearchOptions {
  maxResults: number;
  fileFilter?: string;
}

export interface IndexSummary {
  filesIndexed: number;
  chunksCreated: number;
  indexSizeBytes: number;
  elapsedMs: number;
}
