// ── Pagination ──
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ── Tickets ──
export interface TicketListItem {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  team: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  org_name: string;
  confidence: number | null;
  sla_policy_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_type: string;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface TicketPrediction {
  id: string;
  predicted_category: string;
  predicted_priority: string;
  predicted_team: string;
  escalation_suggested: boolean;
  escalation_reason: string | null;
  confidence: number;
  created_at: string;
}

export interface TicketDraft {
  id: string;
  body: string;
  evidence_chunk_ids: string[];
  confidence: number;
  unresolved_questions: string[];
  send_ready: boolean;
  approval_outcome: string;
  created_at: string;
}

export interface TicketDetail {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string | null;
  team: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  org_name: string;
  messages: TicketMessage[];
  latest_prediction: TicketPrediction | null;
  latest_draft: TicketDraft | null;
  created_at: string;
  updated_at: string;
}

// ── Knowledge ──
export interface KnowledgeSearchResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  similarity: number;
  chunk_index: number;
}

// ── Review Queue ──
export interface DraftQueueItem {
  draft_generation_id: string;
  ticket_id: string;
  ticket_subject: string;
  body: string;
  confidence: number;
  approval_outcome: string;
  created_at: string;
}

// ── Triage ──
export interface TriageResult {
  id: string;
  ticket_id: string;
  predicted_category: string;
  predicted_priority: string;
  predicted_team: string;
  escalation_suggested: boolean;
  escalation_reason: string | null;
  confidence: number;
  latency_ms: number;
  created_at: string;
}

// ── Draft Generation ──
export interface DraftResult {
  id: string;
  ticket_id: string;
  body: string;
  evidence_chunk_ids: string[];
  confidence: number;
  unresolved_questions: string[];
  send_ready: boolean;
  approval_outcome: string;
  latency_ms: number;
  created_at: string;
}

// ── Review ──
export interface ReviewResult {
  id: string;
  action: string;
  acted_by: string;
  reason: string | null;
  created_at: string;
}
