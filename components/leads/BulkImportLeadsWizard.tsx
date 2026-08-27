'use client';
// components/leads/BulkImportLeadsWizard.tsx — wizard de importação em
// massa de Leads via CSV (CRM-BULK-IMPORT-B2). Usa exclusivamente
// bulk_import_leads (B1, já verificado no backend) como autoridade de
// valid/duplicate/error/imported — este componente nunca recalcula essas
// decisões, só orquestra parsing/mapeamento client-side (UX) e exibe a
// resposta do servidor. Compartilhado entre a superfície Manager/Seller
// (ScreenClientes) e a superfície Platform do Super Admin
// (PlatformCommercialClientsView) — `isSuperAdmin` decide só QUAL fonte de
// Sellers/queryKeys usar, nunca uma regra de negócio própria.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { LBtn, LBadge, LCard } from '@/components/ui/kit';
import { FlowShell, StepRail, SellerPicker, type SellerPickerItem } from '@/components/flows/FlowsShared';
import { TableScroller } from '@/components/ui/primitives';
import { useViewport } from '@/lib/hooks/useViewport';
import { useCurrentCompanyAssignableSellers } from '@/lib/hooks/useCurrentCompanyAssignableSellers';
import { usePlatformSellers } from '@/lib/hooks/usePlatformSellers';
import { useBulkImportLeads } from '@/lib/hooks/useBulkImportLeads';
import {
  parseCsvFile,
  validateCsvFileBeforeParse,
  CsvParseError,
  csvParseErrorMessage,
  type ParsedCsv,
} from '@/lib/leads/csvImportParsing';
import {
  CRM_FIELDS,
  CRM_FIELD_LABELS,
  REQUIRED_CRM_FIELDS,
  autoDetectMapping,
  detectUnsupportedHeaders,
  availableColumnsForField,
  isMappingComplete,
  hasCarSource,
  distinctSellerValues,
  matchSellerByName,
  buildBulkImportRows,
  buildRejectedCsv,
  type BulkImportCrmField,
  type FieldMapping,
  type SellerResolution,
} from '@/lib/leads/bulkImportMapping';
import {
  bulkImportBatchErrorMessage,
  bulkImportRowCodeMessage,
  bulkImportStatusLabel,
} from '@/lib/leads/bulkImportCopy';
import { BulkImportLeadsError, type BulkImportPreviewResponse, type BulkImportCommitResponse } from '@/lib/leads/bulkImportRepository';

export type BulkImportLeadsWizardProps = {
  companyId: string;
  isSuperAdmin: boolean;
  // Só usado no ramo Manager (useCurrentCompanyAssignableSellers exige um
  // userId não vazio para habilitar a query, mesmo contrato de
  // ScreenClientesLegacy) — irrelevante/ignorado no ramo Super Admin.
  userId: string | null;
  onClose: () => void;
};

type WizardStep = 'file' | 'mapping' | 'preview' | 'result';

const STEP_LABELS = ['Arquivo', 'Colunas', 'Conferir', 'Resultado'];
const STEP_INDEX: Record<WizardStep, number> = { file: 0, mapping: 1, preview: 2, result: 3 };
const PREVIEW_PAGE_SIZE = 50;

function badgeToneForStatus(status: string): string {
  if (status === 'valid' || status === 'imported') return 'green';
  if (status === 'duplicate') return 'amber';
  return 'red';
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function BulkImportLeadsWizard({ companyId, isSuperAdmin, userId, onClose }: BulkImportLeadsWizardProps) {
  // clientRequestId: UMA vez por tentativa de importação, gerado no mount
  // deste componente — fechar o wizard e abrir de novo é sempre uma NOVA
  // tentativa (novo componente montado = novo id), nunca reaproveitado
  // entre chamadas de preview e sempre o MESMO na chamada de commit real.
  const clientRequestIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
  );

  // MOBILE-RESPONSIVENESS-V1-B3-EXEC §33 — footers com CTA longo
  // ("Importar 1.234 clientes") viram full-width em < md.
  const { isMd } = useViewport();
  const footerBlock = !isMd;

  const [step, setStep] = useState<WizardStep>('file');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [mapping, setMapping] = useState<FieldMapping>({});
  const [carFallbackEnabled, setCarFallbackEnabled] = useState(false);
  const [sellerResolution, setSellerResolution] = useState<SellerResolution>({});

  const [previewResponse, setPreviewResponse] = useState<BulkImportPreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [previewPage, setPreviewPage] = useState(0);

  const [commitResponse, setCommitResponse] = useState<BulkImportCommitResponse | null>(null);
  const [commitError, setCommitError] = useState<unknown>(null);

  // ── Sellers: SEMPRE os dois hooks montados (Rules of Hooks) — só um
  // deles fica `authorized`/`enabled`, conforme o ator real (mesmo molde
  // de ScreenClientesLegacy/PlatformCommercialClientsView). ──────────────
  const assignableSellersQuery = useCurrentCompanyAssignableSellers({
    userId, companyId, membershipRole: isSuperAdmin ? null : 'manager', userIsActive: !isSuperAdmin,
  });
  const platformSellersQuery = usePlatformSellers({ companyId, authorized: isSuperAdmin });
  const sellerOptions: SellerPickerItem[] = useMemo(() => {
    const rows = isSuperAdmin ? platformSellersQuery.sellers : assignableSellersQuery.assignableSellers;
    return rows.map((s) => ({ id: s.seller_id, name: s.name }));
  }, [isSuperAdmin, platformSellersQuery.sellers, assignableSellersQuery.assignableSellers]);
  const sellersLoading = isSuperAdmin ? platformSellersQuery.isLoading : assignableSellersQuery.isLoading;
  const sellersError = isSuperAdmin ? platformSellersQuery.isError : assignableSellersQuery.isError;

  const { preview, commit, isPreviewPending, isCommitPending } = useBulkImportLeads({
    authorized: true,
    isSuperAdmin,
    companyId,
  });

  // ── Etapa 1: Arquivo ────────────────────────────────────────────────────
  async function handleFileSelected(selected: File) {
    setFileError(null);
    setFile(selected);
    setParsed(null);
    try {
      validateCsvFileBeforeParse(selected);
      const result = await parseCsvFile(selected);
      setParsed(result);
      const detected = autoDetectMapping(result.headers);
      setMapping(detected);
    } catch (err) {
      const code = err instanceof CsvParseError ? err.code : 'parse_failed';
      setFileError(csvParseErrorMessage(code as any));
      setFile(null);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) void handleFileSelected(dropped);
  }

  // ── Etapa 2: Mapeamento ──────────────────────────────────────────────────
  const unsupportedHeaders = useMemo(
    () => (parsed ? detectUnsupportedHeaders(parsed.headers, mapping) : []),
    [parsed, mapping],
  );
  const distinctSellers = useMemo(
    () => (parsed ? distinctSellerValues(parsed.rows, mapping.seller) : []),
    [parsed, mapping.seller],
  );

  // Pré-preenche automaticamente só os matches ÚNICOS (nunca ambíguos/sem
  // match) — nunca sobrescreve uma escolha que o usuário já fez (inclusive
  // "Sem vendedor" explícito, que fica gravado como null, nunca undefined).
  useEffect(() => {
    if (distinctSellers.length === 0 || sellerOptions.length === 0) return;
    setSellerResolution((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const value of distinctSellers) {
        if (next[value] !== undefined) continue;
        const match = matchSellerByName(value, sellerOptions);
        if (match.kind === 'unique') {
          next[value] = match.sellerId;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [distinctSellers, sellerOptions]);

  const hasPendingSellerResolution = distinctSellers.some((v) => sellerResolution[v] === undefined);
  const mappingReady =
    isMappingComplete(mapping) && hasCarSource(mapping, carFallbackEnabled) && !hasPendingSellerResolution;

  // ── Etapa 3: Conferir (dry-run) ──────────────────────────────────────────
  async function goToPreview() {
    if (!parsed || !mappingReady) return;
    setPreviewError(null);
    setPreviewPage(0);
    try {
      const rows = buildBulkImportRows(parsed, mapping, carFallbackEnabled, sellerResolution);
      const response = await preview({
        rows,
        clientRequestId: clientRequestIdRef.current,
        filename: file?.name ?? 'import.csv',
        carFallbackEnabled,
        companyId: isSuperAdmin ? companyId : undefined,
      });
      setPreviewResponse(response);
      setStep('preview');
    } catch (err) {
      setPreviewError(err);
      setStep('preview');
    }
  }

  const previewRowsPage = previewResponse
    ? previewResponse.rows.slice(previewPage * PREVIEW_PAGE_SIZE, (previewPage + 1) * PREVIEW_PAGE_SIZE)
    : [];
  const previewPageCount = previewResponse ? Math.ceil(previewResponse.rows.length / PREVIEW_PAGE_SIZE) : 0;
  const sellersById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of sellerOptions) map[s.id] = s.name;
    return map;
  }, [sellerOptions]);

  // ── Etapa 4: Confirmar (commit) ──────────────────────────────────────────
  const submittingRef = useRef(false);
  async function handleConfirmImport() {
    if (!parsed || submittingRef.current || previewResponse === null) return;
    submittingRef.current = true;
    setCommitError(null);
    try {
      const rows = buildBulkImportRows(parsed, mapping, carFallbackEnabled, sellerResolution);
      const response = await commit({
        rows,
        clientRequestId: clientRequestIdRef.current,
        filename: file?.name ?? 'import.csv',
        carFallbackEnabled,
        companyId: isSuperAdmin ? companyId : undefined,
      });
      // A partir daqui os números do preview deixam de importar — o
      // resultado exibido é SEMPRE o desta resposta (B2 §34).
      setCommitResponse(response);
      setStep('result');
    } catch (err) {
      setCommitError(err);
      setStep('result');
    } finally {
      submittingRef.current = false;
    }
  }

  function handleDownloadRejected() {
    if (!parsed) return;
    const rows = commitResponse ? commitResponse.rows : previewResponse ? previewResponse.rows : [];
    const csv = buildRejectedCsv(parsed, rows as any);
    downloadTextFile('nao-importados.csv', csv);
  }

  const stepIndex = STEP_INDEX[step];

  return (
    <FlowShell
      eyebrow="CLIENTES"
      title="Importar clientes via CSV"
      sub="Importação em lote de Leads a partir de uma planilha CSV. O servidor valida e decide o que é válido, duplicado ou inválido."
      icon="upload"
      accent="#E8CE72"
      onClose={onClose}
      footer={renderFooter()}
    >
      <StepRail steps={STEP_LABELS} current={stepIndex} />
      {step === 'file' && renderFileStep()}
      {step === 'mapping' && renderMappingStep()}
      {step === 'preview' && renderPreviewStep()}
      {step === 'result' && renderResultStep()}
    </FlowShell>
  );

  function renderFileStep() {
    return (
      <div>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragOver ? '#E8CE72' : 'var(--border)'}`,
            borderRadius: 16, padding: '48px 24px', textAlign: 'center',
            background: dragOver ? 'rgba(232,206,114,.06)' : 'rgba(255,255,255,.02)',
            transition: 'all .15s',
          }}
        >
          <Icon name="upload" size={34} stroke={2} style={{ color: 'var(--t-500)' }} />
          <div style={{ marginTop: 14, fontSize: 15, fontWeight: 700, color: 'var(--t-900)' }}>
            Arraste um arquivo CSV aqui
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--t-500)' }}>ou</div>
          <label style={{ display: 'inline-block', marginTop: 14, cursor: 'pointer' }}>
            <input
              type="file"
              accept=".csv"
              data-testid="bulk-import-file-input"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFileSelected(f); }}
            />
            <span style={{ display: 'inline-block' }}>
              <LBtn kind="gold" icon="file">Escolher arquivo</LBtn>
            </span>
          </label>
          <div style={{ marginTop: 14, fontSize: 11.5, color: 'var(--t-400)' }}>
            Somente .csv, até 2 MB, até 2.000 linhas e 15 colunas.
          </div>
        </div>

        {fileError && (
          <div role="alert" style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))', color: 'var(--red, #FF3B3B)', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="alert" size={16} stroke={2.2} />
            {fileError}
          </div>
        )}

        {file && parsed && !fileError && (
          <LCard style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Icon name="file" size={20} stroke={2} style={{ color: '#27C75F' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t-900)' }}>{file.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--t-500)' }}>
                  {(file.size / 1024).toFixed(1)} KB · {parsed.rows.length.toLocaleString('pt-BR')} linhas · {parsed.headers.length} colunas
                </div>
              </div>
              <Icon name="checkCircle" size={20} stroke={2.2} style={{ color: '#27C75F' }} />
            </div>
          </LCard>
        )}
      </div>
    );
  }

  function renderMappingStep() {
    if (!parsed) return null;
    return (
      <div>
        {unsupportedHeaders.length > 0 && (
          <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)', fontSize: 13 }}>
            <div style={{ fontWeight: 700, color: 'var(--t-700)', marginBottom: 4 }}>Campos não suportados nesta versão</div>
            <div style={{ color: 'var(--t-500)' }}>
              {unsupportedHeaders.join(', ')}: {unsupportedHeaders.length === 1 ? 'esta coluna' : 'estas colunas'} não será importada.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {CRM_FIELDS.map((field) => (
            <FieldMappingRow
              key={field}
              field={field}
              headers={parsed.headers}
              mapping={mapping}
              onChange={(header) => setMapping((prev) => ({ ...prev, [field]: header || undefined }))}
            />
          ))}
        </div>

        {!mapping.car && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(255,255,255,.02)' }}>
            <input
              type="checkbox"
              id="bulk-import-car-fallback"
              checked={carFallbackEnabled}
              onChange={(e) => setCarFallbackEnabled(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <label htmlFor="bulk-import-car-fallback" style={{ fontSize: 13.5, color: 'var(--t-700)', cursor: 'pointer' }}>
              Usar &quot;Não informado&quot; quando não houver veículo
            </label>
          </div>
        )}
        {!hasCarSource(mapping, carFallbackEnabled) && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--amber, #FFA31F)' }}>
            Mapeie uma coluna para Veículo ou marque a opção acima para continuar.
          </div>
        )}

        {mapping.seller && distinctSellers.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t-700)', marginBottom: 10 }}>
              Vendedores encontrados na planilha
            </div>
            {sellersError && (
              <div style={{ fontSize: 12.5, color: 'var(--red, #FF3B3B)', marginBottom: 10 }}>Não foi possível carregar os vendedores.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {distinctSellers.map((value) => (
                <div key={value} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
                  <div style={{ padding: '13px 15px', fontSize: 13.5, color: 'var(--t-500)' }}>&quot;{value}&quot;</div>
                  <SellerPicker
                    items={sellerOptions}
                    value={sellerResolution[value]}
                    onChange={(id) => setSellerResolution((prev) => ({ ...prev, [value]: id }))}
                    loading={sellersLoading}
                    allowNone
                    noneLabel="Sem vendedor"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderPreviewStep() {
    if (previewError) {
      const message = previewError instanceof BulkImportLeadsError
        ? bulkImportBatchErrorMessage(previewError.code)
        : 'Não foi possível validar o arquivo.';
      return (
        <div role="alert" style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))', color: 'var(--red, #FF3B3B)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={18} stroke={2.2} />
          {message}
        </div>
      );
    }
    if (!previewResponse) return null;

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
          <SummaryTile label="Total" value={previewResponse.totalRows} />
          <SummaryTile label="Válidos" value={previewResponse.validCount} tone="#27C75F" />
          <SummaryTile label="Duplicados" value={previewResponse.duplicateCount} tone="#FFA31F" />
          <SummaryTile label="Erros" value={previewResponse.errorCount} tone="#FF3B3B" />
        </div>

        <PreviewTable rows={previewRowsPage} sellersById={sellersById} />

        {previewPageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 }}>
            <LBtn kind="ghost" size="sm" onClick={() => setPreviewPage((p) => Math.max(0, p - 1))} style={{ opacity: previewPage === 0 ? 0.5 : 1 }}>Anterior</LBtn>
            <span style={{ fontSize: 12.5, color: 'var(--t-500)' }}>Página {previewPage + 1} de {previewPageCount}</span>
            <LBtn kind="ghost" size="sm" onClick={() => setPreviewPage((p) => Math.min(previewPageCount - 1, p + 1))} style={{ opacity: previewPage >= previewPageCount - 1 ? 0.5 : 1 }}>Próxima</LBtn>
          </div>
        )}
      </div>
    );
  }

  function renderResultStep() {
    if (commitError) {
      const message = commitError instanceof BulkImportLeadsError
        ? bulkImportBatchErrorMessage(commitError.code)
        : 'Não foi possível importar os clientes.';
      return (
        <div role="alert" data-testid="bulk-import-result-failed" style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--red-bg, rgba(255,59,59,.08))', border: '1px solid var(--red-line, rgba(255,59,59,.3))', color: 'var(--red, #FF3B3B)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="alert" size={18} stroke={2.2} />
          {message}
        </div>
      );
    }
    if (!commitResponse) return null;

    const allDuplicates = commitResponse.importedCount === 0 && commitResponse.duplicateCount > 0 && commitResponse.errorCount === 0;
    const title = commitResponse.status === 'completed'
      ? (allDuplicates ? 'Nenhum novo cliente foi importado' : 'Importação concluída')
      : commitResponse.status === 'partial'
        ? 'Concluído com pendências'
        : 'Não foi possível importar os clientes';
    const sub = allDuplicates
      ? 'Todos os registros já estavam cadastrados.'
      : undefined;
    const accent = commitResponse.status === 'failed' ? '#FF3B3B' : commitResponse.status === 'partial' ? '#FFA31F' : '#27C75F';
    const hasRejected = commitResponse.duplicateCount > 0 || commitResponse.errorCount > 0;

    return (
      <div data-testid="bulk-import-result" style={{ textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, margin: '0 auto 18px', borderRadius: '50%', background: `${accent}22`, display: 'grid', placeItems: 'center' }}>
          <Icon name={commitResponse.status === 'failed' ? 'xCircle' : 'checkCircle'} size={30} stroke={2.2} style={{ color: accent }} />
        </div>
        <h3 className="display" style={{ fontSize: 21, fontWeight: 800, color: '#fff', margin: '0 0 8px' }}>{title}</h3>
        {sub && <p style={{ color: 'var(--t-500)', fontSize: 14, margin: '0 0 20px' }}>{sub}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, margin: '20px 0', textAlign: 'left' }}>
          <SummaryTile label="Importados" value={commitResponse.importedCount} tone="#27C75F" />
          <SummaryTile label="Duplicados ignorados" value={commitResponse.duplicateCount} tone="#FFA31F" />
          <SummaryTile label="Não importados por erro" value={commitResponse.errorCount} tone="#FF3B3B" />
        </div>

        {hasRejected && (
          <div style={{ marginBottom: 8 }}>
            <LBtn kind="ghost" icon="file" onClick={handleDownloadRejected}>Baixar não importados</LBtn>
          </div>
        )}
      </div>
    );
  }

  function renderFooter() {
    if (step === 'file') {
      return (
        <>
          <LBtn kind="ghost" block={footerBlock} onClick={onClose}>Cancelar</LBtn>
          <LBtn kind="gold" icon="arrowRight" block={footerBlock} onClick={() => setStep('mapping')}
            style={{ marginLeft: isMd ? 'auto' : undefined, opacity: parsed && !fileError ? 1 : 0.5 }}>
            Avançar
          </LBtn>
        </>
      );
    }
    if (step === 'mapping') {
      return (
        <>
          <LBtn kind="ghost" block={footerBlock} onClick={() => setStep('file')}>Voltar</LBtn>
          <LBtn kind="gold" icon={isPreviewPending ? 'refresh' : 'arrowRight'} block={footerBlock} onClick={goToPreview}
            style={{ marginLeft: isMd ? 'auto' : undefined, opacity: mappingReady && !isPreviewPending ? 1 : 0.5, cursor: mappingReady ? 'pointer' : 'not-allowed' }}>
            {isPreviewPending ? 'Validando…' : 'Avançar para Conferir'}
          </LBtn>
        </>
      );
    }
    if (step === 'preview') {
      const validCount = previewResponse?.validCount ?? 0;
      return (
        <>
          <LBtn kind="ghost" block={footerBlock} onClick={() => setStep('mapping')}>Voltar</LBtn>
          <span data-testid="bulk-import-confirm" style={{ marginLeft: isMd ? 'auto' : undefined, display: isMd ? undefined : 'block' }}>
            <LBtn
              kind="gold"
              icon={isCommitPending ? 'refresh' : 'check'}
              block={footerBlock}
              onClick={handleConfirmImport}
              style={{ opacity: validCount > 0 && !isCommitPending ? 1 : 0.5, cursor: validCount > 0 ? 'pointer' : 'not-allowed' }}
            >
              {isCommitPending ? 'Importando…' : `Importar ${validCount.toLocaleString('pt-BR')} clientes`}
            </LBtn>
          </span>
        </>
      );
    }
    return (
      <LBtn kind="gold" icon="check" block={footerBlock} onClick={onClose} style={{ marginLeft: isMd ? 'auto' : undefined }}>Concluir</LBtn>
    );
  }
}

function FieldMappingRow({ field, headers, mapping, onChange }: {
  field: BulkImportCrmField; headers: string[]; mapping: FieldMapping; onChange: (header: string) => void;
}) {
  const required = REQUIRED_CRM_FIELDS.includes(field) || (field === 'car' && !mapping.car);
  const isCarField = field === 'car';
  const options = availableColumnsForField(field, headers, mapping);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, alignItems: 'center' }}>
      <label style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--t-700)' }}>
        {CRM_FIELD_LABELS[field]}{(REQUIRED_CRM_FIELDS.includes(field) || isCarField) && ' *'}
      </label>
      <select
        value={mapping[field] ?? ''}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`bulk-import-mapping-${field}`}
        style={{
          width: '100%', padding: '11px 14px', borderRadius: 10, border: `1px solid ${required && !mapping[field] ? 'rgba(255,59,59,.4)' : 'var(--border)'}`,
          background: '#1a1a1d', color: mapping[field] ? '#fff' : 'var(--t-400)', fontFamily: 'inherit', fontSize: 14,
        }}
      >
        <option value="">{isCarField ? 'Não mapear (usar fallback)' : 'Não mapear'}</option>
        {options.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 11.5, color: 'var(--t-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div className="display tnum" style={{ fontSize: 24, fontWeight: 800, color: tone || 'var(--t-900)', marginTop: 4 }}>{value.toLocaleString('pt-BR')}</div>
    </div>
  );
}

function PreviewTable({ rows, sellersById }: {
  rows: Array<{ rowNumber: number; status: string; code: string | null; normalized?: any; leadId?: string | null }>;
  sellersById: Record<string, string>;
}) {
  return (
    // MOBILE-RESPONSIVENESS-V1-B3-EXEC §31 — 50 linhas continuam TABELA
    // (nunca 50 cards); scroll horizontal só DENTRO do componente, nunca no
    // host/página.
    <TableScroller ariaLabel="Prévia da importação" style={{ border: '1px solid var(--border)', borderRadius: 12 }}>
      <table data-testid="bulk-import-preview-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
        <thead>
          <tr style={{ background: 'rgba(255,255,255,.03)' }}>
            {['Linha', 'Nome', 'Telefone', 'Veículo', 'Vendedor', 'Status'].map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--t-500)', fontWeight: 700, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1px solid var(--border)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const normalized = row.normalized;
            const sellerId = normalized ? normalized.sellerId : null;
            return (
              <tr key={row.rowNumber} data-testid={`bulk-import-row-${row.rowNumber}`}>
                <td style={{ padding: '10px 14px', color: 'var(--t-500)', borderBottom: '1px solid var(--border-2, var(--border))' }}>{row.rowNumber}</td>
                <td style={{ padding: '10px 14px', color: 'var(--t-900)', borderBottom: '1px solid var(--border-2, var(--border))' }}>{normalized?.name ?? '-'}</td>
                <td style={{ padding: '10px 14px', color: 'var(--t-700)', borderBottom: '1px solid var(--border-2, var(--border))' }}>{normalized?.phone ?? '-'}</td>
                <td style={{ padding: '10px 14px', color: 'var(--t-700)', borderBottom: '1px solid var(--border-2, var(--border))' }}>{normalized?.car ?? '-'}</td>
                <td style={{ padding: '10px 14px', color: 'var(--t-700)', borderBottom: '1px solid var(--border-2, var(--border))' }}>{sellerId ? (sellersById[sellerId] ?? sellerId) : 'Sem vendedor'}</td>
                <td style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-2, var(--border))' }}>
                  <LBadge tone={badgeToneForStatus(row.status)}>
                    {bulkImportStatusLabel((row.status === 'valid' && row.code) ? 'warning' : (row.status as any))}
                  </LBadge>
                  {row.code && (
                    <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--t-500)' }}>{bulkImportRowCodeMessage(row.code)}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
