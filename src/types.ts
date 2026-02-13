export interface GitHubSource {
  type: "github";
  url: string;
  owner: string;
  repo: string;
  branch: string;
  subpath: string;
  localPath: string;
  addedAt: string;
}

export interface FileSource {
  type: "file";
  url: string;
  localPath: string;
  addedAt: string;
}

export type Source = GitHubSource | FileSource;

export interface RefdocsConfig {
  paths: string[];
  manifest: string;
  sources?: Source[];
}

export interface ManifestEntry {
  file: string;
  headings: string[];
  lines: number;
  summary: string;
}

export interface Manifest {
  generated: string;
  sources: number;
  files: number;
  entries: ManifestEntry[];
}
