/**
 * Typed HTTP client for the Agent Service Desk API.
 *
 * Design:
 * - Every method maps 1:1 to an ASD API endpoint
 * - JWT is attached as Bearer token on every request
 * - Errors are thrown as AsdApiError with status code and message
 * - No MCP awareness — this is a pure HTTP client
 */

import type { Config } from '../config.js';
import type {
  PaginatedResponse,
  TicketListItem,
  TicketDetail,
  KnowledgeSearchResult,
  DraftQueueItem,
  TriageResult,
  DraftResult,
  ReviewResult,
} from './types.js';

export class AsdApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public endpoint: string,
  ) {
    super(`ASD API error [${status}] on ${endpoint}: ${detail}`);
    this.name = 'AsdApiError';
  }
}

export class AsdClient {
  private baseUrl: string;
  private jwt: string;

  constructor(config: Config) {
    this.baseUrl = config.asdApiUrl;
    this.jwt = config.asdJwt;
  }

  // ── Private helpers ──

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.jwt}`,
      'Content-Type': 'application/json',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const rawText = await response.text();
      let detail: string;
      try {
        const errorBody = JSON.parse(rawText);
        detail = errorBody.detail || JSON.stringify(errorBody);
      } catch {
        detail = rawText || `HTTP ${response.status}`;
      }
      throw new AsdApiError(response.status, detail, `${method} ${path}`);
    }

    // 204 No Content
    if (response.status === 204) return undefined as T;

    return response.json() as Promise<T>;
  }

  private buildQuery(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    return qs ? `?${qs}` : '';
  }

  // ── Ticket endpoints ──

  async searchTickets(params: {
    page?: number;
    per_page?: number;
    status?: string;
    priority?: string;
    category?: string;
    team?: string;
    assignee_id?: string;
    sort_by?: string;
    sort_order?: string;
  }): Promise<PaginatedResponse<TicketListItem>> {
    const query = this.buildQuery(params);
    return this.request('GET', `/tickets${query}`);
  }

  async getTicket(ticketId: string): Promise<TicketDetail> {
    return this.request('GET', `/tickets/${ticketId}`);
  }

  async updateTicket(ticketId: string, updates: {
    status?: string;
    priority?: string;
    category?: string;
    team?: string;
    assignee_id?: string;
  }): Promise<TicketDetail> {
    return this.request('PATCH', `/tickets/${ticketId}`, updates);
  }

  // ── AI Pipeline endpoints ──

  async triageTicket(ticketId: string): Promise<TriageResult> {
    return this.request('POST', `/tickets/${ticketId}/triage`);
  }

  async generateDraft(ticketId: string): Promise<DraftResult> {
    return this.request('POST', `/tickets/${ticketId}/draft`);
  }

  // ── Knowledge endpoints ──

  async searchKnowledge(query: string, topK?: number): Promise<KnowledgeSearchResult[]> {
    const params = this.buildQuery({ q: query, top_k: topK });
    return this.request('GET', `/knowledge/search${params}`);
  }

  // ── Review Queue endpoints ──

  async getReviewQueue(params?: {
    page?: number;
    per_page?: number;
  }): Promise<PaginatedResponse<DraftQueueItem>> {
    const query = this.buildQuery(params || {});
    return this.request('GET', `/drafts/review-queue${query}`);
  }

  async reviewDraft(draftId: string, review: {
    action: 'approved' | 'edited_and_approved' | 'rejected' | 'escalated';
    edited_body?: string;
    reason?: string;
  }): Promise<ReviewResult> {
    return this.request('POST', `/drafts/${draftId}/review`, review);
  }

  // ── Health check (useful for server startup validation) ──

  async healthCheck(): Promise<{ status: string; database: string }> {
    return this.request('GET', '/health');
  }
}
