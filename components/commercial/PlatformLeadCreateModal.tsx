'use client';
// components/commercial/PlatformLeadCreateModal.tsx — criação REAL de Lead
// pela superfície platform do Super Admin (M1-F S8-C2-C2). Formulário
// PRÓPRIO (nunca reaproveita o formulário mock de Flows2/Flows3) — só os
// campos reais de create_lead: p_name/p_phone/p_car obrigatórios,
// p_seller_id/p_temperature/p_payment_preference/p_source opcionais. Etapa
// inicial é SEMPRE resolvida pelo servidor (create_lead já recusa com
// initial_stage_missing se faltar) — nunca escolhida aqui.
//
// `company` é a empresa CAPTURADA no momento de abertura (nunca a
// selecionada no instante de uma resposta tardia) — exibida no cabeçalho,
// nunca editável dentro do formulário. Se `selectedCompanyId` mudar
// enquanto o modal está aberto, ele se fecha imediatamente (decisão §11 do
// design: nunca deixar um formulário aberto apontando para uma empresa que
// não é mais a atual).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn } from '@/components/ui/kit';
import { FField, FlowShell, Segmented } from '@/components/flows/FlowsShared';
import { useCommercialCompanyContext } from '@/lib/commercial/CommercialCompanyContext';
import { usePlatformSellers } from '@/lib/hooks/usePlatformSellers';
import { useCreatePlatformLead } from '@/lib/hooks/useCreatePlatformLead';
import { useCheckPlatformLeadPhoneDuplicate } from '@/lib/hooks/useCheckPlatformLeadPhoneDuplicate';
import { getPlatformCommercialErrorMessage } from '@/lib/commercial/errors';
import type { CommercialCompanyRow, PlatformLeadRecord } from '@/lib/commercial/repository';
import type { Database } from '@/lib/supabase/database.types';

type LeadTemperature = Database['public']['Enums']['lead_temperature'];

const TEMPERATURE_OPTIONS: [LeadTemperature, string][] = [
  ['hot', 'Quente'],
  ['warm', 'Morno'],
  ['cold', 'Frio'],
];

export type PlatformLeadCreateModalProps = {
  company: CommercialCompanyRow;
  onClose: () => void;
  onCreated?: (lead: PlatformLeadRecord) => void;
};

export function PlatformLeadCreateModal({ company, onClose, onCreated }: PlatformLeadCreateModalProps) {
  const { selectedCompanyId } = useCommercialCompanyContext();

  // Valor SEMPRE atualizado da empresa selecionada, lido de dentro de um
  // submit() assíncrono (closure) sem depender de re-render — mesmo
  // problema/solução já usado por getQueryCacheGeneration em
  // useCreateCompany, aqui aplicado a companyId em vez de identidade.
  const liveCompanyIdRef = useRef(selectedCompanyId);
  useEffect(() => { liveCompanyIdRef.current = selectedCompanyId; }, [selectedCompanyId]);

  const isMountedRef = useRef(true);
  const submittingRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Troca de empresa em voo: fecha imediatamente, nunca reaponta o
  // formulário para a nova empresa.
  useEffect(() => {
    if (selectedCompanyId !== company.id) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, company.id]);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [temperature, setTemperature] = useState<LeadTemperature | null>(null);
  const [paymentPreference, setPaymentPreference] = useState('');
  const [source, setSource] = useState('');
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [showSellerList, setShowSellerList] = useState(false);
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [lastError, setLastError] = useState<unknown>(null);

  const sellersQuery = usePlatformSellers({ companyId: company.id, authorized: true });

  // Vendedor selecionado some da lista recarregada (troca de empresa em
  // outra aba, desativação concorrente etc.) — limpa a seleção, nunca envia
  // um seller_id que já não é válido (achado S8-C2-C2-SELLERS-B1).
  useEffect(() => {
    if (sellerId && sellersQuery.hasData && !sellersQuery.sellers.some((s) => s.seller_id === sellerId)) {
      setSellerId(null);
    }
  }, [sellersQuery.sellers, sellersQuery.hasData, sellerId]);

  const { createLead, isPending: isCreating } = useCreatePlatformLead({ authorized: true });
  const { checkDuplicate, isPending: isChecking } = useCheckPlatformLeadPhoneDuplicate();

  const nameBlank = name.trim() === '';
  const phoneBlank = phone.trim() === '';
  const carBlank = car.trim() === '';
  const isPending = isCreating || isChecking;
  const canSubmit = !isPending && !nameBlank && !phoneBlank && !carBlank;
  const selectedSeller = sellerId ? sellersQuery.sellers.find((s) => s.seller_id === sellerId) ?? null : null;

  const submit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setLastError(null);
    setDuplicateBlocked(false);
    try {
      // Duplicidade SEMPRE escopada à empresa capturada, nunca global — o
      // resultado detalhado (lead_id/lead_name) nunca é lido aqui, só o
      // status (decisão §9: dado de outro Lead nunca é revelado).
      const duplicateRows = await checkDuplicate({ companyId: company.id, phone });
      if (!isMountedRef.current) return;
      if (duplicateRows.some((row) => row.status !== 'none')) {
        setDuplicateBlocked(true);
        return;
      }

      if (liveCompanyIdRef.current !== company.id) return; // troca em voo — nunca envia

      const created = await createLead({
        companyId: company.id,
        name,
        phone,
        car,
        temperature: temperature ?? undefined,
        paymentPreference: paymentPreference.trim() || undefined,
        source: source.trim() || undefined,
        sellerId: sellerId ?? undefined,
        isContextStillValid: () => liveCompanyIdRef.current === company.id,
      });
      if (!isMountedRef.current) return;
      onCreated?.(created);
      onClose();
    } catch (err) {
      if (isMountedRef.current) setLastError(err);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <FlowShell
      eyebrow={`NOVO LEAD — ${company.name.toUpperCase()}`}
      title="Novo Lead"
      sub="Cadastro real na empresa selecionada. A etapa inicial do funil é definida automaticamente."
      icon="plus"
      accent="#27C75F"
      onClose={onClose}
      footer={
        <>
          <LBtn kind="ghost" onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon={isPending ? 'refresh' : 'check'} onClick={submit}
            style={{ marginLeft: 'auto', opacity: canSubmit ? 1 : 0.6, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
            {isChecking ? 'Verificando telefone…' : isCreating ? 'Criando…' : 'Criar Lead'}
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
        <div role="alert" data-testid="platform-lead-create-duplicate" style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg)', border: '1px solid var(--red-line)', color: 'var(--red)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
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

      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--t-500)', marginBottom: 7 }}>Vendedor (opcional)</span>
        <button type="button" onClick={() => setShowSellerList((s) => !s)} disabled={sellersQuery.isLoading}
          style={{
            width: '100%', padding: '13px 15px', borderRadius: 12, border: '1px solid var(--border)',
            fontFamily: 'inherit', fontSize: 15, color: 'var(--t-900)', background: 'rgba(255,255,255,.03)',
            display: 'flex', alignItems: 'center', gap: 10, cursor: sellersQuery.isLoading ? 'wait' : 'pointer', textAlign: 'left',
          }}>
          <Icon name="users" size={17} stroke={2} style={{ color: 'var(--t-400)' }} />
          <span style={{ flex: 1, color: selectedSeller ? 'var(--t-900)' : 'var(--t-400)' }}>
            {sellersQuery.isLoading ? 'Carregando vendedores…' : selectedSeller ? selectedSeller.name : 'Sem vendedor'}
          </span>
          <Icon name="arrowDown" size={16} stroke={2} style={{ color: 'var(--t-400)', transform: showSellerList ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
        {sellersQuery.isError && !sellersQuery.isLoading && (
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>Não foi possível carregar os vendedores.</span>
        )}
        {showSellerList && !sellersQuery.isLoading && (
          <div style={{ position: 'absolute', left: 0, right: 0, top: 74, zIndex: 5, maxHeight: 240, overflowY: 'auto', background: '#1a1a1d', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }}>
            <button type="button" onClick={() => { setSellerId(null); setShowSellerList(false); }}
              style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--t-500)', fontSize: 13.5 }}>
              Sem vendedor
            </button>
            {sellersQuery.sellers.map((s) => (
              <button key={s.seller_id} type="button" onClick={() => { setSellerId(s.seller_id); setShowSellerList(false); }}
                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: '#fff', fontSize: 13.5 }}>
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </FlowShell>
  );
}
