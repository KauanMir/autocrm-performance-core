// ── TypeScript interfaces ─────────────────────────────────────────────

export interface TimelineEntry {
  icon: string;
  c: string;
  t: string;
  d?: string;
  when: string;
}

export interface Seller {
  id: string;
  name: string;
  first: string;
  team: string;
  leads: number;
  scheduled: number;
  visits: number;
  sales: number;
  conv: number;
  growth: number;
  move: number;
  revenue: string;
}

// The authenticated user, as returned by AuthService (M1-B: backed by
// Supabase Auth + the `profiles` table — id is auth.users.id/profiles.id,
// never the old hardcoded 'u1'..'u4'). No `password` field on purpose —
// Supabase Auth owns credentials entirely; this object never carries one.
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'seller';
  sellerId: string | null;
  companyId: string | null;
  // M1-F S3-B: platform_role da profile (independente de `role`/`companyId`
  // — um Super Admin não tem empresa). Opcional (não `| null` obrigatório)
  // de propósito: dezenas de fixtures de teste pré-existentes constroem
  // User sem este campo — undefined e null são equivalentes em todo check
  // (`=== 'super_admin'`), então tornar obrigatório só quebraria testes
  // sem relação nenhuma com o S3-B, sem ganho de segurança real (a
  // autoridade nunca foi este campo, sempre RLS/is_platform_super_admin()
  // no banco). null para todo usuário comum carregado via _loadProfile.
  platformRole?: 'super_admin' | null;
}

// LEGACY — kept only so a couple of display-name lookups (FlowVerCliente's
// "Criado por", exportResultadosCSV's userName()) can still resolve
// createdByUserId/approvedByUserId values that predate Supabase Auth (M1-B).
// Never used for authentication anymore — AuthService.login talks to
// Supabase Auth exclusively, and this list intentionally carries no
// passwords (that would defeat the entire point of removing them from the
// client bundle). New records created after M1-B carry a real profile uuid
// that won't be found here — the lookups just fall back to '-' for those,
// which is a known, accepted limitation until M1-C+ migrates profiles too.
export interface LegacyUserRef {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'seller';
  sellerId: string | null;
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  car: string;
  stage: string;
  seller: string;
  sellerId: string | null;
  // Operational health — driven by the Lead Health Engine (lib/services.ts),
  // never set directly from the customer's buying intent. See `temperature`.
  urgency: 'red' | 'amber' | 'green';
  last: string;
  alert: string;
  pay: string;
  value: string;
  origem?: string;
  timeline?: TimelineEntry[];
  // Buying-intent classification ("Quente/Morno/Frio" in the UI) — independent from
  // `urgency`. A hot lead can still be operationally red if nobody has called yet.
  temperature?: 'hot' | 'warm' | 'cold';
  // Who cadastrou this lead (may differ from sellerId when a manager/admin
  // creates it on behalf of a seller) and when. Optional — seed leads and
  // anything created before M0-K3.1 won't have these; callers must fall back.
  createdByUserId?: string | null;
  createdAt?: string;
}

export interface Visit {
  id: string;
  time: string;
  client: string;
  seller: string;
  sellerId: string | null;
  leadId: string | null;
  car: string;
  status: string;
  day: string;
  vehicles?: string[];
  note?: string;
  createdAt?: string;
}

export interface Deal {
  id: string;
  client: string;
  car: string;
  value: string;
  seller: string;
  sellerId: string | null;
  leadId: string | null;
  status: string;
  disc?: string;
  last: string;
  payment?: string;
  downPayment?: string;
  installments?: string;
  note?: string;
  createdByUserId?: string | null;
  createdAt?: string;
  approvedByUserId?: string | null;
  approvedAt?: string;
  rejectedByUserId?: string | null;
  rejectedAt?: string;
}

export interface Sale {
  id: string;
  client: string;
  car: string;
  value: string;
  seller: string;
  sellerId: string | null;
  leadId: string | null;
  dealId: string | null;
  date: string;
  status: string;
  pay: string;
  createdByUserId?: string | null;
  createdAt?: string;
}

export interface Task {
  id: string;
  title: string;
  lead: string;
  leadId?: string | null;
  assignedTo: string | null;
  when: string;
  prio: string;
  state: string;
  note: string;
  createdAt?: string;
}

// ── SELLERS ───────────────────────────────────────────────────────────

export const SELLERS: Seller[] = [
  { id: 's1',  name: 'Marcos Silva',    first: 'Marcos',   team: 'Seminovos', leads: 38, scheduled: 14, visits: 12, sales: 11, conv: 29, growth: +18, move: +1,  revenue: 'R$ 1,32M' },
  { id: 's2',  name: 'Ana Souza',       first: 'Ana',      team: 'Seminovos', leads: 34, scheduled: 13, visits: 11, sales: 9,  conv: 26, growth: +12, move: +2,  revenue: 'R$ 1,08M' },
  { id: 's3',  name: 'João Ferreira',   first: 'João',     team: 'Novos',     leads: 31, scheduled: 11, visits: 9,  sales: 8,  conv: 26, growth: -4,  move: -1,  revenue: 'R$ 0,96M' },
  { id: 's4',  name: 'Lucas Martins',   first: 'Lucas',    team: 'Novos',     leads: 28, scheduled: 9,  visits: 7,  sales: 6,  conv: 21, growth: +6,  move: 0,   revenue: 'R$ 0,74M' },
  { id: 's5',  name: 'Beatriz Lima',    first: 'Beatriz',  team: 'Seminovos', leads: 26, scheduled: 8,  visits: 7,  sales: 6,  conv: 23, growth: +9,  move: +3,  revenue: 'R$ 0,70M' },
  { id: 's6',  name: 'Rafael Nunes',    first: 'Rafael',   team: 'Novos',     leads: 24, scheduled: 7,  visits: 5,  sales: 5,  conv: 21, growth: +2,  move: 0,   revenue: 'R$ 0,61M' },
  { id: 's7',  name: 'Carla Mendes',    first: 'Carla',    team: 'Seminovos', leads: 22, scheduled: 6,  visits: 5,  sales: 4,  conv: 18, growth: -2,  move: -2,  revenue: 'R$ 0,48M' },
  { id: 's8',  name: 'Diego Alves',     first: 'Diego',    team: 'Novos',     leads: 21, scheduled: 6,  visits: 4,  sales: 4,  conv: 19, growth: +5,  move: +1,  revenue: 'R$ 0,47M' },
  { id: 's9',  name: 'Patrícia Rocha',  first: 'Patrícia', team: 'Seminovos', leads: 19, scheduled: 5,  visits: 4,  sales: 3,  conv: 16, growth: 0,   move: 0,   revenue: 'R$ 0,36M' },
  { id: 's10', name: 'Bruno Castro',    first: 'Bruno',    team: 'Novos',     leads: 17, scheduled: 4,  visits: 3,  sales: 3,  conv: 18, growth: +3,  move: +2,  revenue: 'R$ 0,35M' },
  { id: 's11', name: 'Fernanda Dias',   first: 'Fernanda', team: 'Seminovos', leads: 15, scheduled: 4,  visits: 3,  sales: 2,  conv: 13, growth: -1,  move: -1,  revenue: 'R$ 0,24M' },
  { id: 's12', name: 'Thiago Moraes',   first: 'Thiago',   team: 'Novos',     leads: 13, scheduled: 3,  visits: 2,  sales: 2,  conv: 15, growth: +1,  move: 0,   revenue: 'R$ 0,23M' },
];

// ── USERS — legacy display-name reference, NOT used for auth (see LegacyUserRef) ──

export const USERS: LegacyUserRef[] = [
  { id: 'u1', name: 'Admin',          email: 'admin@autocrm.com',     role: 'admin',   sellerId: null },
  { id: 'u2', name: 'Carlos Mendes',  email: 'gerente@autocrm.com',   role: 'manager', sellerId: null },
  { id: 'u3', name: 'Lucas Martins',  email: 'vendedor1@autocrm.com', role: 'seller',  sellerId: 's4' },
  { id: 'u4', name: 'Fernanda Costa', email: 'vendedor2@autocrm.com', role: 'seller',  sellerId: 's11' },
];

// ── NAV_ROLES — role-based navigation permissions ─────────────────────

export const NAV_ROLES: Record<'admin' | 'manager' | 'seller', string[]> = {
  admin:   ['home', 'clientes', 'andamento', 'pendencias', 'visitas', 'propostas', 'vendas', 'resultados', 'ajustes'],
  manager: ['home', 'clientes', 'andamento', 'pendencias', 'visitas', 'propostas', 'vendas', 'resultados'],
  seller:  ['home', 'clientes', 'andamento', 'pendencias', 'visitas', 'propostas', 'vendas'],
};

// ── Color helpers ─────────────────────────────────────────────────────

export const RING_COLORS = ['#D4AF37', '#E23744', '#1DB954', '#3B82F6', '#A855F7', '#FF8A00', '#06B6D4', '#EC4899'];

export function ringFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % RING_COLORS.length;
  return RING_COLORS[h];
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

// ── LEADS — sellerId → SELLERS.id FK ─────────────────────────────────

export const LEADS: Lead[] = [
  { id: 'l1',  name: 'Carlos Andrade', phone: '(11) 99421-1190', car: 'Golf GTI 2022',        stage: 'Em negociação',  seller: 'Marcos Silva',  sellerId: 's1', urgency: 'red',   last: 'Sem contato há 3 dias',       alert: 'Responder agora',              pay: 'Financiamento', value: 'R$ 120.000' },
  { id: 'l2',  name: 'Juliana Prado',  phone: '(11) 98810-2231', car: 'Honda HR-V 2023',      stage: 'Visita agendada', seller: 'Ana Souza',     sellerId: 's2', urgency: 'red',   last: 'Visita não confirmada',        alert: 'Confirmar visita hoje',        pay: 'À vista',       value: 'R$ 158.000' },
  { id: 'l3',  name: 'Pedro Santos',   phone: '(11) 97712-4456', car: 'Toyota Corolla 2023',  stage: 'Qualificado',    seller: 'João Ferreira', sellerId: 's3', urgency: 'amber', last: 'Aguardando documentação',      alert: 'Cliente aguardando resposta',  pay: 'Financiamento', value: 'R$ 142.000' },
  { id: 'l4',  name: 'Mariana Luz',    phone: '(11) 96655-7789', car: 'VW Polo 2023',         stage: 'Novo',           seller: 'Lucas Martins', sellerId: 's4', urgency: 'green', last: 'Primeiro contato feito',       alert: 'No prazo',                     pay: 'Financiamento', value: 'R$ 98.000'  },
  { id: 'l5',  name: 'Roberto Dias',   phone: '(11) 95541-3320', car: 'Jeep Compass 2022',    stage: 'Em negociação',  seller: 'Lucas Martins', sellerId: 's4', urgency: 'red',   last: 'Proposta parada há 48h',       alert: 'Retomar proposta',             pay: 'Financiamento', value: 'R$ 165.000' },
  { id: 'l6',  name: 'Sandra Lopes',   phone: '(11) 94430-9981', car: 'Hyundai Creta 2023',   stage: 'Visita agendada', seller: 'Beatriz Lima',  sellerId: 's5', urgency: 'amber', last: 'Aguardando confirmação',       alert: 'Confirmar presença',           pay: 'À vista',       value: 'R$ 134.000' },
  { id: 'l7',  name: 'Eduardo Reis',   phone: '(11) 93320-1145', car: 'Fiat Pulse 2023',      stage: 'Qualificado',    seller: 'Lucas Martins', sellerId: 's4', urgency: 'green', last: 'Lead progredindo bem',         alert: 'No prazo',                     pay: 'Financiamento', value: 'R$ 109.000' },
  { id: 'l8',  name: 'Camila Freitas', phone: '(11) 92218-6677', car: 'Chevrolet Onix 2023',  stage: 'Novo',           seller: 'Rafael Nunes',  sellerId: 's6', urgency: 'green', last: 'Cadastrado hoje',              alert: 'No prazo',                     pay: 'Financiamento', value: 'R$ 92.000'  },
  { id: 'l9',  name: 'Anderson Melo',  phone: '(11) 91102-8843', car: 'Renault Kardian 2024', stage: 'Em negociação',  seller: 'Ana Souza',     sellerId: 's2', urgency: 'amber', last: 'Aguardando contraproposta',   alert: 'Cliente aguardando',           pay: 'À vista',       value: 'R$ 121.000' },
  { id: 'l10', name: 'Larissa Gomes',  phone: '(11) 90091-7755', car: 'Nissan Kicks 2023',    stage: 'Qualificado',    seller: 'Lucas Martins', sellerId: 's4', urgency: 'red',   last: 'Sem contato há 4 dias',        alert: 'Ligar imediatamente',          pay: 'Financiamento', value: 'R$ 128.000' },
  { id: 'l11', name: 'Felipe Barros',  phone: '(11) 98123-4567', car: 'Golf GTI 2021',        stage: 'Novo',           seller: 'Diego Alves',   sellerId: 's8', urgency: 'green', last: 'Primeiro contato feito',       alert: 'No prazo',                     pay: 'À vista',       value: 'R$ 112.000' },
  { id: 'l12', name: 'Tatiane Vidal',  phone: '(11) 97234-1188', car: 'Jeep Renegade 2022',   stage: 'Visita agendada', seller: 'Beatriz Lima',  sellerId: 's5', urgency: 'green', last: 'Visita confirmada p/ amanhã', alert: 'No prazo',                     pay: 'Financiamento', value: 'R$ 124.000' },
];

export const STAGES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

// ── Status contracts ──────────────────────────────────────────────────
// Single source of truth for every status string a flow is allowed to write.
// A screen that renders a status must recognize every value here — writing
// a status outside its own contract is what caused Visitas to crash and
// Propostas to silently disappear (see M0-J audit).

export const VISIT_STATUS = {
  PENDING:         'pendente',       // agendada, aguardando confirmação do cliente
  SCHEDULED:       'agendada',       // agendada, confirmação ainda não necessária
  CONFIRMED:       'confirmada',     // cliente confirmou presença
  RESCHEDULED:     'remarcada',      // remarcada para outro dia/horário
  CANCELED:        'cancelada',      // cliente cancelou
  AWAITING_RESULT: 'sem_resultado',  // aconteceu, resultado ainda não registrado
  DONE:            'realizada',      // resultado registrado (venda/negociação/follow-up)
  NO_INTEREST:     'sem_interesse',  // resultado registrado, cliente sem interesse
} as const;
export type VisitStatus = typeof VISIT_STATUS[keyof typeof VISIT_STATUS];

export const DEAL_STATUS = {
  OPEN:     'aberta',     // em negociação, sem pendência de aprovação
  APPROVAL: 'aprovacao',  // desconto acima do limite, aguardando gestor
  APPROVED: 'aprovada',   // gestor aprovou
  REJECTED: 'recusada',   // gestor recusou
  SOLD:     'vendida',    // já virou uma Sale — não pode gerar outra venda
} as const;
export type DealStatus = typeof DEAL_STATUS[keyof typeof DEAL_STATUS];

export const SALE_STATUS = {
  PENDING:   'aguardando', // registrada, entrega ainda não realizada
  DELIVERED: 'entregue',
  CANCELED:  'cancelada',  // venda desfeita — não conta como ativa, libera o Lead para nova venda
} as const;
export type SaleStatus = typeof SALE_STATUS[keyof typeof SALE_STATUS];

export const TASK_STATE = {
  LATE:     'atrasada', // venceu e ninguém agiu
  TODAY:    'hoje',
  UPCOMING: 'proxima',
  DONE:     'concluida', // resolvida — some das 3 filas ativas (Atrasadas/Hoje/Próximas)
} as const;
export type TaskState = typeof TASK_STATE[keyof typeof TASK_STATE];

// ── COMPANY — Ajustes → Empresa (objeto plano, sem relações) ─────────

export interface Company {
  name: string;
  cnpj: string;
  phone: string;
  timezone: string;
}
export const DEFAULT_COMPANY: Company = {
  name: 'Revenda Premium Veículos',
  cnpj: '00.000.000/0001-00',
  phone: '(11) 3000-0000',
  timezone: 'América/São Paulo (GMT-3)',
};

// ── TASKS — assignedTo → SELLERS.id FK ───────────────────────────────

export const TASKS: Task[] = [
  { id: 't1', title: 'Ligar para Carlos Andrade',              lead: 'Carlos Andrade',  assignedTo: 's1', when: 'Venceu há 3 dias', prio: 'alta',  state: 'atrasada', note: 'Primeiro contato pós-qualificação' },
  { id: 't2', title: 'Retomar proposta — Roberto Dias',        lead: 'Roberto Dias',    assignedTo: 's4', when: 'Venceu há 2 dias', prio: 'alta',  state: 'atrasada', note: 'Proposta parada, cliente esfriando' },
  { id: 't3', title: 'Ligar para Larissa Gomes',               lead: 'Larissa Gomes',   assignedTo: 's4', when: 'Venceu ontem',     prio: 'alta',  state: 'atrasada', note: 'Sem contato há 4 dias' },
  { id: 't4', title: 'Confirmar visita — Mariana Luz',         lead: 'Mariana Luz',     assignedTo: 's4', when: 'Hoje, 14:00',      prio: 'media', state: 'hoje',     note: 'Confirmar presença na visita' },
  { id: 't5', title: 'Enviar simulação — Eduardo Reis',        lead: 'Eduardo Reis',    assignedTo: 's4', when: 'Hoje, 16:30',      prio: 'media', state: 'hoje',     note: 'Cliente pediu simulação de financiamento' },
  { id: 't6', title: 'Follow-up pós-visita — Tatiane Vidal',  lead: 'Tatiane Vidal',   assignedTo: 's5', when: 'Amanhã, 10:00',    prio: 'baixa', state: 'proxima',  note: 'Verificar interesse após visita' },
  { id: 't7', title: 'Enviar fotos do Pulse — Camila Freitas', lead: 'Camila Freitas',  assignedTo: 's6', when: 'Amanhã, 11:00',    prio: 'baixa', state: 'proxima',  note: 'Cliente pediu fotos adicionais' },
];

// ── VISITS — sellerId → SELLERS.id FK, leadId → LEADS.id FK ──────────

export const VISITS: Visit[] = [
  { id: 'v1', time: '09:00',  client: 'Carlos Andrade', seller: 'Marcos Silva',  sellerId: 's1', leadId: 'l1',  car: 'Golf GTI 2022',   status: 'confirmada',    day: 'hoje'    },
  { id: 'v2', time: '11:00',  client: 'Pedro Santos',   seller: 'João Ferreira', sellerId: 's3', leadId: 'l3',  car: 'Corolla 2023',    status: 'realizada',     day: 'hoje'    },
  { id: 'v3', time: '14:00',  client: 'Mariana Luz',    seller: 'Lucas Martins', sellerId: 's4', leadId: 'l4',  car: 'VW Polo 2023',    status: 'pendente',      day: 'hoje'    },
  { id: 'v4', time: '16:00',  client: 'Juliana Prado',  seller: 'Ana Souza',     sellerId: 's2', leadId: 'l2',  car: 'Honda HR-V 2023', status: 'pendente',      day: 'hoje'    },
  { id: 'v5', time: '10:00',  client: 'Tatiane Vidal',  seller: 'Beatriz Lima',  sellerId: 's5', leadId: 'l12', car: 'Renegade 2022',   status: 'agendada',      day: 'amanha'  },
  { id: 'v6', time: '15:00',  client: 'Felipe Barros',  seller: 'Diego Alves',   sellerId: 's8', leadId: 'l11', car: 'Golf GTI 2021',   status: 'agendada',      day: 'amanha'  },
  { id: 'v7', time: '28 mai', client: 'Anderson Melo',  seller: 'Ana Souza',     sellerId: 's2', leadId: 'l9',  car: 'Kardian 2024',    status: 'sem_resultado', day: 'passado' },
];

// ── DEALS — sellerId → SELLERS.id FK, leadId → LEADS.id FK ──────────

export const DEALS: Deal[] = [
  { id: 'd1', client: 'Carlos Andrade', car: 'Golf GTI 2022',        value: 'R$ 120.000', seller: 'Marcos Silva',  sellerId: 's1', leadId: 'l1',  status: 'aberta',    last: 'hoje'      },
  { id: 'd2', client: 'Roberto Dias',   car: 'Jeep Compass 2022',    value: 'R$ 165.000', seller: 'Lucas Martins', sellerId: 's4', leadId: 'l5',  status: 'aberta',    last: 'há 2 dias' },
  { id: 'd3', client: 'Anderson Melo',  car: 'Renault Kardian 2024', value: 'R$ 121.000', seller: 'Ana Souza',     sellerId: 's2', leadId: 'l9',  status: 'aberta',    last: 'ontem'     },
  { id: 'd4', client: 'Pedro Santos',   car: 'Toyota Corolla 2023',  value: 'R$ 138.000', seller: 'João Ferreira', sellerId: 's3', leadId: 'l3',  status: 'aprovacao', disc: 'Desconto 8% (acima do limite 5%)', last: 'hoje'  },
  { id: 'd5', client: 'Larissa Gomes',  car: 'Nissan Kicks 2023',    value: 'R$ 124.000', seller: 'Lucas Martins', sellerId: 's4', leadId: 'l10', status: 'aprovacao', disc: 'Desconto 6% (acima do limite 5%)', last: 'ontem' },
];

// ── SALES — sellerId → SELLERS.id FK, leadId/dealId nullable ────────

export const SALES: Sale[] = [
  { id: 'sa1', client: 'Fernando Costa', car: 'Golf GTI 2022',      value: 'R$ 120.000', seller: 'Marcos Silva',  sellerId: 's1', leadId: null, dealId: null, date: '12 jun', status: 'entregue',   pay: 'Financiamento 48x' },
  { id: 'sa2', client: 'Renata Alves',   car: 'VW Polo 2023',       value: 'R$ 98.000',  seller: 'Ana Souza',     sellerId: 's2', leadId: null, dealId: null, date: '11 jun', status: 'aguardando', pay: 'À vista'           },
  { id: 'sa3', client: 'Marcelo Pinto',  car: 'Honda HR-V 2023',    value: 'R$ 158.000', seller: 'João Ferreira', sellerId: 's3', leadId: null, dealId: null, date: '10 jun', status: 'entregue',   pay: 'Financiamento 60x' },
  { id: 'sa4', client: 'Aline Souza',    car: 'Jeep Compass 2022',  value: 'R$ 165.000', seller: 'Lucas Martins', sellerId: 's4', leadId: null, dealId: null, date: '09 jun', status: 'entregue',   pay: 'À vista'           },
  { id: 'sa5', client: 'Gustavo Ramos',  car: 'Hyundai Creta 2023', value: 'R$ 134.000', seller: 'Beatriz Lima',  sellerId: 's5', leadId: null, dealId: null, date: '08 jun', status: 'aguardando', pay: 'Financiamento 36x' },
];

