'use client';
// components/commercial/PlatformLeadEditModal.tsx — edição REAL de Lead pela
// superfície platform do Super Admin (M1-F S8-C2-C2). Formulário PRÓPRIO,
// nunca o mock "editar-cliente" — só os campos reais de update_lead
// (name/phone/car/temperature/payment_preference/source). NUNCA
// seller_id/stage/archived_at/timeline: a RPC nem os aceita (decisão #8 do
// design — editar nunca move Etapa nem atribui Vendedor).
//
// Duplicidade: check_lead_phone_duplicate não tem parâmetro de
// autoexclusão — resolvido pulando a checagem quando o telefone não mudou
// (o próprio Lead nunca é encontrado quando o telefone MUDA, porque a busca
// usa o valor NOVO contra o phone_digits ainda ANTIGO no banco).
//
// `lead`/`company` são o Lead e a empresa CAPTURADOS na abertura — nunca
// atualizados a partir de uma resposta tardia de outra empresa. Fecha
// imediatamente se a empresa selecionada mudar enquanto o modal está aberto.
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FField, FlowShell, Segmented } from '@/components/flows/FlowsShared';
import { useCommercialCompanyContext } from '@/lib/commercial/CommercialCompanyContext';
import { useUpdatePlatformLead } from '@/lib/hooks/useUpdatePlatformLead';
import { useCheckPlatformLeadPhoneDuplicate } from '@/lib/hooks/useCheckPlatformLeadPhoneDuplicate';
import { getPlatformCommercialErrorMessage } from '@/lib/commercial/errors';
import type { CommercialCompanyRow, PlatformLeadRecord, PlatformLeadRow } from '@/lib/commercial/repository';
import type { Database } from '@/lib/supabase/database.types';

type LeadTemperature = Database['public']['Enums']['lead_temperature'];

const TEMPERATURE_OPTIONS: [LeadTemperature, string][] = [
  ['hot', 'Quente'],
  ['warm', 'Morno'],
  ['cold', 'Frio'],
];

export type PlatformLeadEditModalProps = {
  lead: PlatformLeadRow;
  company: CommercialCompanyRow;
  onClose: () => void;
  onUpdated?: (lead: PlatformLeadRecord) => void;
};

export function PlatformLeadEditModal({ lead, company, onClose, onUpdated }: PlatformLeadEditModalProps) {
  const { selectedCompanyId } = useCommercialCompanyContext();

  const liveCompanyIdRef = useRef(selectedCompanyId);
  useEffect(() => { liveCompanyIdRef.current = selectedCompanyId; }, [selectedCompanyId]);

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (selectedCompanyId !== company.id) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, company.id]);

  const [name, setName] = useState(lead.name);
  const [phone, setPhone] = useState(lead.phone);
  const [car, setCar] = useState(lead.car);
  const [temperature, setTemperature] = useState<LeadTemperature | null>(lead.temperature);
  const [paymentPreference, setPaymentPreference] = useState(lead.payment_preference ?? '');
  const [source, setSource] = useState(lead.source ?? '');
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [lastError, setLastError] = useState<unknown>(null);

  const { updateLead, isPending: isUpdating } = useUpdatePlatformLead({ authorized: true });
  const { checkDuplicate, isPending: isChecking } = useCheckPlatformLeadPhoneDuplicate();

  const nameBlank = name.trim() === '';
  const phoneBlank = phone.trim() === '';
  const carBlank = car.trim() === '';
  const isPending = isUpdating || isChecking;
  const canSubmit = !isPending && !nameBlank && !phoneBlank && !carBlank;
  const phoneChanged = phone.trim() !== lead.phone;

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setLastError(null);
    setDuplicateBlocked(false);
    try {
      // Só verifica duplicidade quando o telefone MUDOU — check_lead_phone_
      // duplicate não tem parâmetro de autoexclusão; com o telefone
      // inalterado a checagem encontraria o próprio Lead.
      if (phoneChanged) {
        const duplicateRows = await checkDuplicate({ companyId: company.id, phone });
        if (!isMountedRef.current) return;
        if (duplicateRows.some((row) => row.status !== 'none')) {
          setDuplicateBlocked(true);
          return;
        }
      }

      if (liveCompanyIdRef.current !== company.id) return; // troca em voo — nunca envia

      const updated = await updateLead({
        companyId: company.id,
        leadId: lead.id,
        expectedVersion: lead.version,
        name,
        phone,
        car,
        temperature: temperature ?? undefined,
        paymentPreference: paymentPreference.trim() || undefined,
        source: source.trim() || undefined,
        isContextStillValid: () => liveCompanyIdRef.current === company.id,
      });
      if (!isMountedRef.current) return;
      onUpdated?.(updated);
      onClose();
    } catch (err) {
      if (isMountedRef.current) setLastError(err);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <FlowShell
      eyebrow={`EDITAR LEAD: ${company.name.toUpperCase()}`}
      title={lead.name}
      sub="Etapa, vendedor, arquivamento e histórico não são editáveis por aqui."
      icon="edit"
      accent="#3B82F6"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon={isPending ? 'refresh' : 'check'} onClick={submit}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {isChecking ? 'Verificando telefone…' : isUpdating ? 'Salvando…' : 'Salvar alterações'}
          </LBtn>
        </>
      }
    >
      {lastError != null && (
        <div role="alert" style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={16} stroke={2.2} />
          {getPlatformCommercialErrorMessage(lastError)}
        </div>
      )}
      {duplicateBlocked && (
        <div role="alert" data-testid="platform-lead-edit-duplicate" style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={16} stroke={2.2} />
          Já existe um Lead com este telefone nesta empresa.
        </div>
      )}

      <FField label="Nome" icon="user" placeholder="Nome completo" value={name} autoFocus
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
      <FField label="Telefone" icon="phone" placeholder="(11) 99999-9999" value={phone}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPhone(e.target.value); setDuplicateBlocked(false); }} />
      <FField label="Veículo de interesse" icon="car" placeholder="Ex.: Golf GTI 2022" value={car}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCar(e.target.value)} />

      <div style={{ marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Temperatura (opcional)</span>
        <Segmented options={TEMPERATURE_OPTIONS} value={temperature} onChange={setTemperature} />
      </div>

      <FField label="Forma de pagamento (opcional)" icon="card" placeholder="Ex.: Financiamento" value={paymentPreference}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPaymentPreference(e.target.value)} />
      <FField label="Origem (opcional)" icon="flag" placeholder="Ex.: WhatsApp" value={source}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSource(e.target.value)} />
    </FlowShell>
  );
}
