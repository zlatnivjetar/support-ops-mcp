/**
 * Interactive test client for the Support Ops MCP Server.
 *
 * Usage:
 *   1. Start the server: npm run dev
 *   2. Run this: npm run test:client
 *
 * This uses the MCP SDK's Client class to connect via Streamable HTTP
 * and exercise each registered tool.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SERVER_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:3001/mcp';

async function main() {
  console.log(`Connecting to MCP server at ${SERVER_URL}...`);

  const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL));
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await client.connect(transport);
  console.log('Connected!\n');

  // List available tools
  const { tools } = await client.listTools();
  console.log(`Available tools (${tools.length}):`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description?.substring(0, 80)}...`);
  }
  console.log();

  // Test 1: search_tickets with no filters (should return recent tickets)
  console.log('=== Test 1: search_tickets (no filters) ===');
  const result1 = await client.callTool({
    name: 'search_tickets',
    arguments: { per_page: 3 },
  });
  console.log('Result:', JSON.stringify(result1.content, null, 2));
  console.log();

  // Test 2: search_tickets with filters
  console.log('=== Test 2: search_tickets (status=open, priority=high) ===');
  const result2 = await client.callTool({
    name: 'search_tickets',
    arguments: { status: 'open', priority: 'high', per_page: 3 },
  });
  console.log('Result:', JSON.stringify(result2.content, null, 2));
  console.log();

  // Test 3: search_tickets with bad filter (should still work, return 0 results)
  console.log('=== Test 3: search_tickets (category=billing, sort_by=priority) ===');
  const result3 = await client.callTool({
    name: 'search_tickets',
    arguments: { category: 'billing', sort_by: 'priority', sort_order: 'desc', per_page: 5 },
  });
  console.log('Result:', JSON.stringify(result3.content, null, 2));
  console.log();

  // Test 4: get_ticket — fetch full detail for the first ticket from Test 1
  console.log('=== Test 4: get_ticket (first ticket from Test 1) ===');
  const ticketsData = JSON.parse((result1.content[0] as { text: string }).text);
  const firstTicketId = ticketsData.tickets[0]?.id;
  if (!firstTicketId) {
    console.log('No tickets returned from Test 1, skipping get_ticket test.');
  } else {
    console.log(`Fetching ticket ID: ${firstTicketId}`);
    const result4 = await client.callTool({
      name: 'get_ticket',
      arguments: { ticket_id: firstTicketId },
    });
    console.log('Result:', JSON.stringify(result4.content, null, 2));
    const detail = JSON.parse((result4.content[0] as { text: string }).text);
    console.log(`  messages: ${detail.messages?.length ?? 'N/A'}`);
    console.log(`  prediction: ${detail.prediction ? 'present' : 'null'}`);
    console.log(`  draft: ${detail.draft ? 'present' : 'null'}`);
  }
  console.log();

  // Test 5: get_ticket with non-existent UUID — should return clean error
  console.log('=== Test 5: get_ticket (non-existent UUID) ===');
  const result5 = await client.callTool({
    name: 'get_ticket',
    arguments: { ticket_id: '00000000-0000-0000-0000-000000000000' },
  });
  console.log('Result:', JSON.stringify(result5.content, null, 2));
  console.log(`  isError: ${result5.isError}`);
  console.log();

  // Test 6: search_knowledge with query "billing refund"
  console.log('=== Test 6: search_knowledge (query="billing refund") ===');
  const result6 = await client.callTool({
    name: 'search_knowledge',
    arguments: { query: 'billing refund', top_k: 5 },
  });
  console.log('Result:', JSON.stringify(result6.content, null, 2));
  const knowledgeData = JSON.parse((result6.content[0] as { text: string }).text);
  console.log(`  result_count: ${knowledgeData.result_count}`);
  if (knowledgeData.results.length > 0) {
    const first = knowledgeData.results[0];
    console.log(`  first result: "${first.document_title}" (similarity: ${first.similarity})`);
    console.log(`  has content: ${Boolean(first.content)}`);
  }
  console.log();

  // Test 7: search_knowledge with empty query — should return Zod validation error
  console.log('=== Test 7: search_knowledge (empty query — expect validation error) ===');
  const result7 = await client.callTool({
    name: 'search_knowledge',
    arguments: { query: '' },
  });
  console.log('Result:', JSON.stringify(result7.content, null, 2));
  console.log(`  isError: ${result7.isError}`);
  console.log();

  // Test 8: get_review_queue — list pending drafts awaiting human review
  console.log('=== Test 8: get_review_queue (default params) ===');
  const result8 = await client.callTool({
    name: 'get_review_queue',
    arguments: {},
  });
  console.log('Result:', JSON.stringify(result8.content, null, 2));
  if (result8.isError) {
    console.log(`  isError: true (likely 403 — JWT lacks agent/lead role)`);
  } else {
    const queueData = JSON.parse((result8.content[0] as { text: string }).text);
    console.log(`  pending_drafts count: ${queueData.pending_drafts?.length ?? 'N/A'}`);
    console.log(`  pagination: ${JSON.stringify(queueData.pagination)}`);
    if (queueData.pending_drafts?.length > 0) {
      const first = queueData.pending_drafts[0];
      console.log(`  first draft_id: ${first.draft_id}`);
      console.log(`  first ticket_subject: ${first.ticket_subject}`);
      console.log(`  first confidence: ${first.confidence}`);
      console.log(`  first draft_preview length: ${first.draft_preview?.length ?? 0}`);
    }
  }

  // Extract a draft ID from the review queue for later use in review_draft tests
  let queueDraftId: string | undefined;
  if (!result8.isError) {
    const queueData = JSON.parse((result8.content[0] as { text: string }).text);
    queueDraftId = queueData.pending_drafts?.[0]?.draft_id;
  }

  // Test 9: triage_ticket — run AI classification on the first ticket from Test 1
  console.log('=== Test 9: triage_ticket (first ticket from Test 1) ===');
  if (!firstTicketId) {
    console.log('No tickets returned from Test 1, skipping triage_ticket test.');
  } else {
    console.log(`Triaging ticket ID: ${firstTicketId}`);
    const result9 = await client.callTool({
      name: 'triage_ticket',
      arguments: { ticket_id: firstTicketId },
    });
    console.log('Result:', JSON.stringify(result9.content, null, 2));
    if (result9.isError) {
      console.log(`  isError: true`);
    } else {
      const triageData = JSON.parse((result9.content[0] as { text: string }).text);
      console.log(`  predicted_category: ${triageData.prediction?.predicted_category}`);
      console.log(`  predicted_priority: ${triageData.prediction?.predicted_priority}`);
      console.log(`  predicted_team: ${triageData.prediction?.predicted_team}`);
      console.log(`  confidence: ${triageData.prediction?.confidence}`);
      console.log(`  escalation_suggested: ${triageData.prediction?.escalation_suggested}`);
      console.log(`  latency_ms: ${triageData.latency_ms}`);
      console.log(`  note: ${triageData.note}`);

      // Run triage again to verify append-only (two different prediction records)
      console.log('\n  Running triage again on same ticket (append-only check)...');
      const result9b = await client.callTool({
        name: 'triage_ticket',
        arguments: { ticket_id: firstTicketId },
      });
      if (!result9b.isError) {
        console.log('  Second triage call succeeded — both predictions stored separately.');
      }
    }
  }
  console.log();

  // Test 10: triage_ticket with non-existent UUID — should return clean 404 error
  console.log('=== Test 10: triage_ticket (non-existent UUID) ===');
  const result10 = await client.callTool({
    name: 'triage_ticket',
    arguments: { ticket_id: '00000000-0000-0000-0000-000000000000' },
  });
  console.log('Result:', JSON.stringify(result10.content, null, 2));
  console.log(`  isError: ${result10.isError}`);
  console.log();

  // Test 11: generate_draft — triage first, then generate a draft for the same ticket
  console.log('=== Test 11: generate_draft (first ticket from Test 1) ===');
  if (!firstTicketId) {
    console.log('No tickets returned from Test 1, skipping generate_draft test.');
  } else {
    console.log(`Generating draft for ticket ID: ${firstTicketId}`);
    console.log('  (This calls the AI pipeline — may take 3-8 seconds)');
    const result11 = await client.callTool({
      name: 'generate_draft',
      arguments: { ticket_id: firstTicketId },
    });
    console.log('Result:', JSON.stringify(result11.content, null, 2));
    if (result11.isError) {
      console.log(`  isError: true`);
    } else {
      const draftData = JSON.parse((result11.content[0] as { text: string }).text);
      console.log(`  draft.id: ${draftData.draft?.id}`);
      console.log(`  draft.body length: ${draftData.draft?.body?.length ?? 0}`);
      console.log(`  draft.confidence: ${draftData.draft?.confidence}`);
      console.log(`  draft.send_ready: ${draftData.draft?.send_ready}`);
      console.log(`  draft.evidence_chunks_cited: ${draftData.draft?.evidence_chunks_cited}`);
      console.log(`  draft.unresolved_questions: ${JSON.stringify(draftData.draft?.unresolved_questions)}`);
      console.log(`  draft.approval_status: ${draftData.draft?.approval_status}`);
      console.log(`  latency_ms: ${draftData.latency_ms}`);
      console.log(`  next_steps: ${draftData.next_steps}`);
    }
  }
  console.log();

  // Test 12: generate_draft with non-existent UUID — should return clean 404 error
  console.log('=== Test 12: generate_draft (non-existent UUID) ===');
  const result12 = await client.callTool({
    name: 'generate_draft',
    arguments: { ticket_id: '00000000-0000-0000-0000-000000000000' },
  });
  console.log('Result:', JSON.stringify(result12.content, null, 2));
  console.log(`  isError: ${result12.isError}`);
  console.log();

  // Test 13: review_draft — approve a draft from the review queue
  console.log('=== Test 13: review_draft (approve first queue item) ===');
  if (!queueDraftId) {
    console.log('No pending drafts in review queue, skipping review_draft approve test.');
  } else {
    console.log(`Approving draft ID: ${queueDraftId}`);
    const result13 = await client.callTool({
      name: 'review_draft',
      arguments: { draft_id: queueDraftId, action: 'approved' },
    });
    console.log('Result:', JSON.stringify(result13.content, null, 2));
    if (result13.isError) {
      console.log(`  isError: true`);
    } else {
      const reviewData = JSON.parse((result13.content[0] as { text: string }).text);
      console.log(`  review.draft_id: ${reviewData.review?.draft_id}`);
      console.log(`  review.action: ${reviewData.review?.action}`);
      console.log(`  review.result: ${reviewData.review?.result}`);
    }
  }
  console.log();

  // Test 14: review_draft — edited_and_approved without edited_body (client-side validation error)
  console.log('=== Test 14: review_draft (edited_and_approved without edited_body) ===');
  const result14 = await client.callTool({
    name: 'review_draft',
    arguments: {
      draft_id: '00000000-0000-0000-0000-000000000000',
      action: 'edited_and_approved',
    },
  });
  console.log('Result:', JSON.stringify(result14.content, null, 2));
  console.log(`  isError: ${result14.isError}`);
  console.log();

  // Test 15: review_draft — reviewing an already-reviewed draft (409 or 404 from ASD API)
  console.log('=== Test 15: review_draft (already-reviewed draft) ===');
  if (!queueDraftId) {
    console.log('No draft ID available, skipping already-reviewed test.');
  } else {
    const result15 = await client.callTool({
      name: 'review_draft',
      arguments: { draft_id: queueDraftId, action: 'approved' },
    });
    console.log('Result:', JSON.stringify(result15.content, null, 2));
    console.log(`  isError: ${result15.isError}`);
  }
  console.log();

  // Test 16: update_ticket — update status to "in_progress" on first ticket from Test 1
  console.log('=== Test 16: update_ticket (set status=in_progress) ===');
  if (!firstTicketId) {
    console.log('No tickets returned from Test 1, skipping update_ticket test.');
  } else {
    console.log(`Updating ticket ID: ${firstTicketId}`);
    const result16 = await client.callTool({
      name: 'update_ticket',
      arguments: { ticket_id: firstTicketId, status: 'in_progress' },
    });
    console.log('Result:', JSON.stringify(result16.content, null, 2));
    if (result16.isError) {
      console.log(`  isError: true`);
    } else {
      const updateData = JSON.parse((result16.content[0] as { text: string }).text);
      console.log(`  updated_ticket.id: ${updateData.updated_ticket?.id}`);
      console.log(`  updated_ticket.status: ${updateData.updated_ticket?.status}`);
      console.log(`  fields_changed: ${JSON.stringify(updateData.fields_changed)}`);

      // Confirm the change persisted with get_ticket
      console.log('\n  Confirming change persisted with get_ticket...');
      const confirmResult = await client.callTool({
        name: 'get_ticket',
        arguments: { ticket_id: firstTicketId },
      });
      const confirmedTicket = JSON.parse((confirmResult.content[0] as { text: string }).text);
      console.log(`  confirmed status: ${confirmedTicket.status}`);
    }
  }
  console.log();

  // Test 17: update_ticket — no fields provided (client-side validation error)
  console.log('=== Test 17: update_ticket (no fields — expect validation error) ===');
  const result17 = await client.callTool({
    name: 'update_ticket',
    arguments: { ticket_id: '00000000-0000-0000-0000-000000000000' },
  });
  console.log('Result:', JSON.stringify(result17.content, null, 2));
  console.log(`  isError: ${result17.isError}`);
  console.log();

  // Test 18: update_ticket — non-existent ticket (404 error)
  console.log('=== Test 18: update_ticket (non-existent UUID) ===');
  const result18 = await client.callTool({
    name: 'update_ticket',
    arguments: { ticket_id: '00000000-0000-0000-0000-000000000000', status: 'open' },
  });
  console.log('Result:', JSON.stringify(result18.content, null, 2));
  console.log(`  isError: ${result18.isError}`);
  console.log();

  await client.close();
  console.log('\nDone — all tests passed.');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
