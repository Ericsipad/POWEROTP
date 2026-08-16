export const NODE_STALE_THRESHOLD_MS = 3 * 60_000;

export interface Node {
  id: string;
  ip: string;
  firstSeenAt: string;
  lastSeenAt: string;
  trunkStatus?: Array<{
    id: string;
    registrationState: "Registered" | "Rejected" | "Unknown" | "Unregistered";
    healthy: boolean;
    consecutiveFailures: number;
    downUntil?: number;
  }>;
  trunkStatusReportedAt?: string;
}

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export interface RecordingAsset {
  id: string;
  durationMs: number;
  checksumSha256: string;
  status: "published" | "retired";
  createdAt: string;
}

export interface ChallengeDefinition {
  id: string;
  recordingAssetId: string;
  question: string;
  options: Array<{ key: string; label: string }>;
  allowsMultiple: boolean;
  minSelections: number;
  maxSelections: number;
  status: "published" | "retired";
  createdAt: string;
}
