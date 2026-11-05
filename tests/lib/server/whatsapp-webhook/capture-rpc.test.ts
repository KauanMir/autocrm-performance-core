// tests/lib/server/whatsapp-webhook/capture-rpc.test.ts — W2B-5. Adaptador das RPCs
// de captura: nomes, parâmetros e falha fechada. Supabase mockado.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('@/lib/server/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));

import {
  captureInboundMessage,
  fetchWhatsAppDiagnosticsSummary,
  loadWhatsAppCaptureContext,
  markInboundEventFailed,
} from '@/lib/server/whatsapp-webhook/capture-rpc';

const OCCURRED = new Date('2026-11-05T10:00:00.000Z');
const RECEIVED = new Date('2026-11-05T10:00:01.000Z');

const captureInput = {
  connectionId: 'conn', companyId: 'company', phoneNumberId: '123', wabaId: '456', messageIdHash: 'h', messageType: 'text',
  occurredAt: OCCURRED, receivedAt: RECEIVED, requestId: 'req', bsuidHmac: null, phoneHmac: 'p', piiCiphertext: 'pii',
  piiRef: 'ref', piiHasPhone: true, contentCiphertext: 'content', keyVersion: 1,
};

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('loadWhatsAppCaptureContext', () => {
  it('normaliza a conexão', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ out_connection_id: 'c', out_company_id: 'e', out_waba_id: 'w', out_capture_allowed: true }],
      error: null,
    });
    expect(await loadWhatsAppCaptureContext('123')).toEqual({
      ok: true, value: { connectionId: 'c', companyId: 'e', wabaId: 'w', captureAllowed: true },
    });
    expect(mocks.rpc).toHaveBeenCalledWith('whatsapp_connection_capture_context', { p_phone_number_id: '123' });
  });

  it('sem linha → número desconhecido', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await loadWhatsAppCaptureContext('123')).toEqual({ ok: true, value: null });
  });

  it('captura só é permitida com true exato', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ out_connection_id: 'c', out_company_id: 'e', out_waba_id: 'w', out_capture_allowed: 'true' }],
      error: null,
    });
    expect(await loadWhatsAppCaptureContext('123')).toMatchObject({ value: { captureAllowed: false } });
  });

  it.each([
    ['erro', { data: null, error: { code: '42501' } }],
    ['linha incompleta', { data: [{ out_connection_id: 'c' }], error: null }],
  ])('%s → falha', async (_label, response) => {
    mocks.rpc.mockResolvedValue(response);
    expect(await loadWhatsAppCaptureContext('123')).toEqual({ ok: false });
  });

  it('exceção → falha', async () => {
    mocks.rpc.mockRejectedValue(new Error('down'));
    expect(await loadWhatsAppCaptureContext('123')).toEqual({ ok: false });
  });
});

describe('captureInboundMessage', () => {
  it('envia só hashes e ciphertext, com a RPC certa', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_outcome: 'captured' }], error: null });
    expect(await captureInboundMessage(captureInput)).toEqual({ ok: true, outcome: 'captured' });
    expect(mocks.rpc).toHaveBeenCalledWith('whatsapp_inbound_message_capture', {
      p_connection_id: 'conn', p_expected_company_id: 'company', p_phone_number_id: '123', p_waba_id: '456',
      p_message_id_hash: 'h', p_message_type: 'text', p_occurred_at: OCCURRED.toISOString(),
      p_received_at: RECEIVED.toISOString(), p_request_id: 'req', p_bsuid_hmac: null, p_phone_hmac: 'p',
      p_hmac_key_version: 1, p_pii_ciphertext: 'pii', p_pii_ref: 'ref', p_pii_key_version: 1, p_pii_has_phone: true,
      p_content_ciphertext: 'content', p_content_key_version: 1,
    });
  });

  it('horário ausente vai como null', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_outcome: 'captured' }], error: null });
    await captureInboundMessage({ ...captureInput, occurredAt: null });
    expect(mocks.rpc.mock.calls[0][1].p_occurred_at).toBeNull();
  });

  it.each([
    ['resultado fora do catálogo', { data: [{ out_outcome: 'sucesso' }], error: null }],
    ['sem linha', { data: [], error: null }],
    ['erro do banco', { data: null, error: { code: '23505' } }],
  ])('%s → falha, nunca sucesso', async (_label, response) => {
    mocks.rpc.mockResolvedValue(response);
    expect(await captureInboundMessage(captureInput)).toEqual({ ok: false });
  });

  it('exceção → falha', async () => {
    mocks.rpc.mockRejectedValue(new Error('down'));
    expect(await captureInboundMessage(captureInput)).toEqual({ ok: false });
  });
});

describe('markInboundEventFailed', () => {
  const input = {
    connectionId: 'conn', companyId: 'company', phoneNumberId: '123', wabaId: '456', messageIdHash: 'h', messageType: 'text',
    errorCode: 'contact_unresolved' as const, occurredAt: null, receivedAt: RECEIVED, requestId: 'req',
  };

  it('registra com o código fechado', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ out_outcome: 'recorded' }], error: null });
    expect(await markInboundEventFailed(input)).toEqual({ ok: true });
    expect(mocks.rpc.mock.calls[0][0]).toBe('whatsapp_inbound_event_mark_failed');
    expect(mocks.rpc.mock.calls[0][1].p_error_code).toBe('contact_unresolved');
  });

  it('erro → falha', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    expect(await markInboundEventFailed(input)).toEqual({ ok: false });
  });
});

describe('fetchWhatsAppDiagnosticsSummary', () => {
  const row = {
    out_events_total: 5, out_events_received: 1, out_events_failed: 3, out_events_waba_mismatch: 1,
    out_events_contact_unresolved: 1, out_events_group_message: 1, out_last_event_at: '2026-11-05T10:00:00+00:00',
    out_messages_total: 3, out_capture_enabled_connections: 1,
  };

  it('devolve só contagens e data', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...row, extra: 'ignorado' }], error: null });
    expect(await fetchWhatsAppDiagnosticsSummary('company')).toEqual({
      eventsTotal: 5, eventsReceived: 1, eventsFailed: 3, eventsWabaMismatch: 1, eventsContactUnresolved: 1,
      eventsGroupMessage: 1, lastEventAt: '2026-11-05T10:00:00+00:00', messagesTotal: 3, captureEnabledConnections: 1,
    });
  });

  it('RPC ausente no banco → indisponível, nunca 0', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    expect(await fetchWhatsAppDiagnosticsSummary('company')).toBeNull();
  });

  it('valor não numérico → indisponível', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...row, out_events_total: '5' }], error: null });
    expect(await fetchWhatsAppDiagnosticsSummary('company')).toBeNull();
  });
});
