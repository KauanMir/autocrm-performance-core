'use client';
// components/leads/LeadFormSubmissionsSection.tsx — META-MVP1. Respostas do
// formulário Meta Lead Ads preservadas para um lead. Leitura pela RPC
// list_lead_form_submissions, que aplica a MESMA visibilidade do lead (Seller
// só vê lead próprio não arquivado; Manager vê a company; Super Admin com
// acesso). Lead sem formulário: a seção não aparece.
//
// Os dados exibidos são exatamente os enviados pelo cliente: nada é inventado
// e o cadastro do lead nunca é alterado por uma nova submissão.
import { useLeadFormSubmissions } from '@/lib/hooks/useMetaLeadOps';
import type { LeadFormSubmission } from '@/lib/integrations/metaLeadOps';

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

export function formatBrazilPhoneDigits(digits: string): string {
  if (/^\d{11}$/.test(digits)) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (/^\d{10}$/.test(digits)) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

const label: React.CSSProperties = { fontSize: 12, color: 'var(--t-500)' };
const value: React.CSSProperties = { fontSize: 13, color: 'var(--t-900)', wordBreak: 'break-word' };

function SubmissionCard({ submission }: { submission: LeadFormSubmission }) {
  return (
    <div data-testid="lead-form-submission"
      style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>
          {submission.outcome === 'created' ? 'Lead criado por este formulário' : 'Novo envio para lead já existente'}
        </strong>
        <span style={label}>{formatDateTime(submission.submittedAt ?? submission.receivedAt)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) 1fr', gap: '4px 10px' }}>
        <span style={label}>Nome</span><span style={value}>{submission.contactName}</span>
        <span style={label}>Telefone</span><span style={value}>{formatBrazilPhoneDigits(submission.contactPhone)}</span>
        <span style={label}>E-mail</span><span style={value}>{submission.contactEmail ?? 'Não informado no formulário'}</span>
        <span style={label}>Veículo de interesse</span>
        <span style={value}>{submission.vehicleInterest ?? 'Não informado no formulário'}</span>
        {submission.answers.map((answer) => (
          <FragmentRow key={answer.key} name={answer.key} values={answer.values} />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({ name, values }: { name: string; values: string[] }) {
  return (
    <>
      <span style={label}>{name}</span>
      <span style={value}>{values.join(', ')}</span>
    </>
  );
}

export function LeadFormSubmissionsSection({ leadId, companyId, authorized }: {
  leadId: string;
  companyId: string | null;
  authorized: boolean;
}) {
  const query = useLeadFormSubmissions({ leadId, companyId, authorized });
  if (!authorized || query.isLoading) return null;
  if (query.isError) {
    return (
      <div role="alert" data-testid="lead-form-submissions-error" style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 12 }}>
        Não foi possível carregar as respostas do formulário.
      </div>
    );
  }
  const submissions = query.data ?? [];
  if (submissions.length === 0) return null;
  return (
    <section data-testid="lead-form-submissions" style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5 }}>Formulário Meta Lead Ads</div>
      {submissions.map((submission) => <SubmissionCard key={submission.id} submission={submission} />)}
    </section>
  );
}
