export const SELLERS = [
  { id: 's1', name: 'Marcos Silva',    first: 'Marcos', team: 'Seminovos', leads: 38, scheduled: 14, visits: 12, sales: 11, conv: 29, growth: +18, move: +1, revenue: 'R$ 1,32M' },
  { id: 's2', name: 'Ana Souza',       first: 'Ana',    team: 'Seminovos', leads: 34, scheduled: 13, visits: 11, sales: 9,  conv: 26, growth: +12, move: +2, revenue: 'R$ 1,08M' },
  { id: 's3', name: 'João Ferreira',   first: 'João',   team: 'Novos',     leads: 31, scheduled: 11, visits: 9,  sales: 8,  conv: 26, growth: -4,  move: -1, revenue: 'R$ 0,96M' },
  { id: 's4', name: 'Lucas Martins',   first: 'Lucas',  team: 'Novos',     leads: 28, scheduled: 9,  visits: 7,  sales: 6,  conv: 21, growth: +6,  move: 0,  revenue: 'R$ 0,74M' },
  { id: 's5', name: 'Beatriz Lima',    first: 'Beatriz',team: 'Seminovos', leads: 26, scheduled: 8,  visits: 7,  sales: 6,  conv: 23, growth: +9,  move: +3, revenue: 'R$ 0,70M' },
  { id: 's6', name: 'Rafael Nunes',    first: 'Rafael', team: 'Novos',     leads: 24, scheduled: 7,  visits: 5,  sales: 5,  conv: 21, growth: +2,  move: 0,  revenue: 'R$ 0,61M' },
  { id: 's7', name: 'Carla Mendes',    first: 'Carla',  team: 'Seminovos', leads: 22, scheduled: 6,  visits: 5,  sales: 4,  conv: 18, growth: -2,  move: -2, revenue: 'R$ 0,48M' },
  { id: 's8', name: 'Diego Alves',     first: 'Diego',  team: 'Novos',     leads: 21, scheduled: 6,  visits: 4,  sales: 4,  conv: 19, growth: +5,  move: +1, revenue: 'R$ 0,47M' },
  { id: 's9', name: 'Patrícia Rocha',  first: 'Patrícia',team:'Seminovos', leads: 19, scheduled: 5,  visits: 4,  sales: 3,  conv: 16, growth: 0,   move: 0,  revenue: 'R$ 0,36M' },
  { id: 's10', name: 'Bruno Castro',   first: 'Bruno',  team: 'Novos',     leads: 17, scheduled: 4,  visits: 3,  sales: 3,  conv: 18, growth: +3,  move: +2, revenue: 'R$ 0,35M' },
  { id: 's11', name: 'Fernanda Dias',  first: 'Fernanda',team:'Seminovos', leads: 15, scheduled: 4,  visits: 3,  sales: 2,  conv: 13, growth: -1,  move: -1, revenue: 'R$ 0,24M' },
  { id: 's12', name: 'Thiago Moraes',  first: 'Thiago', team: 'Novos',     leads: 13, scheduled: 3,  visits: 2,  sales: 2,  conv: 15, growth: +1,  move: 0,  revenue: 'R$ 0,23M' },
];

export const ME_ID = 's4';

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

export const LEADS = [
  { id: 'l1', name: 'Carlos Andrade', phone: '(11) 99421-1190', car: 'Golf GTI 2022', stage: 'Em negociação', seller: 'Marcos Silva', urgency: 'red', last: 'Sem contato há 3 dias', alert: 'Responder agora', pay: 'Financiamento', value: 'R$ 120.000' },
  { id: 'l2', name: 'Juliana Prado',  phone: '(11) 98810-2231', car: 'Honda HR-V 2023', stage: 'Visita agendada', seller: 'Ana Souza', urgency: 'red', last: 'Visita não confirmada', alert: 'Confirmar visita hoje', pay: 'À vista', value: 'R$ 158.000' },
  { id: 'l3', name: 'Pedro Santos',   phone: '(11) 97712-4456', car: 'Toyota Corolla 2023', stage: 'Qualificado', seller: 'João Ferreira', urgency: 'amber', last: 'Aguardando documentação', alert: 'Cliente aguardando resposta', pay: 'Financiamento', value: 'R$ 142.000' },
  { id: 'l4', name: 'Mariana Luz',    phone: '(11) 96655-7789', car: 'VW Polo 2023', stage: 'Novo', seller: 'Lucas Martins', urgency: 'green', last: 'Primeiro contato feito', alert: 'No prazo', pay: 'Financiamento', value: 'R$ 98.000' },
  { id: 'l5', name: 'Roberto Dias',   phone: '(11) 95541-3320', car: 'Jeep Compass 2022', stage: 'Em negociação', seller: 'Lucas Martins', urgency: 'red', last: 'Proposta parada há 48h', alert: 'Retomar proposta', pay: 'Financiamento', value: 'R$ 165.000' },
  { id: 'l6', name: 'Sandra Lopes',   phone: '(11) 94430-9981', car: 'Hyundai Creta 2023', stage: 'Visita agendada', seller: 'Beatriz Lima', urgency: 'amber', last: 'Aguardando confirmação', alert: 'Confirmar presença', pay: 'À vista', value: 'R$ 134.000' },
  { id: 'l7', name: 'Eduardo Reis',   phone: '(11) 93320-1145', car: 'Fiat Pulse 2023', stage: 'Qualificado', seller: 'Lucas Martins', urgency: 'green', last: 'Lead progredindo bem', alert: 'No prazo', pay: 'Financiamento', value: 'R$ 109.000' },
  { id: 'l8', name: 'Camila Freitas', phone: '(11) 92218-6677', car: 'Chevrolet Onix 2023', stage: 'Novo', seller: 'Rafael Nunes', urgency: 'green', last: 'Cadastrado hoje', alert: 'No prazo', pay: 'Financiamento', value: 'R$ 92.000' },
  { id: 'l9', name: 'Anderson Melo',  phone: '(11) 91102-8843', car: 'Renault Kardian 2024', stage: 'Em negociação', seller: 'Ana Souza', urgency: 'amber', last: 'Aguardando contraproposta', alert: 'Cliente aguardando', pay: 'À vista', value: 'R$ 121.000' },
  { id: 'l10', name: 'Larissa Gomes', phone: '(11) 90091-7755', car: 'Nissan Kicks 2023', stage: 'Qualificado', seller: 'Lucas Martins', urgency: 'red', last: 'Sem contato há 4 dias', alert: 'Ligar imediatamente', pay: 'Financiamento', value: 'R$ 128.000' },
  { id: 'l11', name: 'Felipe Barros', phone: '(11) 98123-4567', car: 'Golf GTI 2021', stage: 'Novo', seller: 'Diego Alves', urgency: 'green', last: 'Primeiro contato feito', alert: 'No prazo', pay: 'À vista', value: 'R$ 112.000' },
  { id: 'l12', name: 'Tatiane Vidal', phone: '(11) 97234-1188', car: 'Jeep Renegade 2022', stage: 'Visita agendada', seller: 'Beatriz Lima', urgency: 'green', last: 'Visita confirmada p/ amanhã', alert: 'No prazo', pay: 'Financiamento', value: 'R$ 124.000' },
];

export const STAGES = ['Novo', 'Qualificado', 'Visita agendada', 'Em negociação', 'Fechamento'];

export const TASKS = [
  { id: 't1', title: 'Ligar para Carlos Andrade', lead: 'Carlos Andrade', when: 'Venceu há 3 dias', prio: 'alta', state: 'atrasada', note: 'Primeiro contato pós-qualificação' },
  { id: 't2', title: 'Retomar proposta — Roberto Dias', lead: 'Roberto Dias', when: 'Venceu há 2 dias', prio: 'alta', state: 'atrasada', note: 'Proposta parada, cliente esfriando' },
  { id: 't3', title: 'Ligar para Larissa Gomes', lead: 'Larissa Gomes', when: 'Venceu ontem', prio: 'alta', state: 'atrasada', note: 'Sem contato há 4 dias' },
  { id: 't4', title: 'Confirmar visita — Mariana Luz', lead: 'Mariana Luz', when: 'Hoje, 14:00', prio: 'media', state: 'hoje', note: 'Confirmar presença na visita' },
  { id: 't5', title: 'Enviar simulação — Eduardo Reis', lead: 'Eduardo Reis', when: 'Hoje, 16:30', prio: 'media', state: 'hoje', note: 'Cliente pediu simulação de financiamento' },
  { id: 't6', title: 'Follow-up pós-visita — Tatiane Vidal', lead: 'Tatiane Vidal', when: 'Amanhã, 10:00', prio: 'baixa', state: 'proxima', note: 'Verificar interesse após visita' },
  { id: 't7', title: 'Enviar fotos do Pulse — Camila Freitas', lead: 'Camila Freitas', when: 'Amanhã, 11:00', prio: 'baixa', state: 'proxima', note: 'Cliente pediu fotos adicionais' },
];

export const VISITS = [
  { id: 'v1', time: '09:00', client: 'Carlos Andrade', seller: 'Marcos Silva', car: 'Golf GTI 2022', status: 'confirmada', day: 'hoje' },
  { id: 'v2', time: '11:00', client: 'Pedro Santos', seller: 'João Ferreira', car: 'Corolla 2023', status: 'realizada', day: 'hoje' },
  { id: 'v3', time: '14:00', client: 'Mariana Luz', seller: 'Lucas Martins', car: 'VW Polo 2023', status: 'pendente', day: 'hoje' },
  { id: 'v4', time: '16:00', client: 'Juliana Prado', seller: 'Ana Souza', car: 'Honda HR-V 2023', status: 'pendente', day: 'hoje' },
  { id: 'v5', time: '10:00', client: 'Tatiane Vidal', seller: 'Beatriz Lima', car: 'Renegade 2022', status: 'agendada', day: 'amanha' },
  { id: 'v6', time: '15:00', client: 'Felipe Barros', seller: 'Diego Alves', car: 'Golf GTI 2021', status: 'agendada', day: 'amanha' },
  { id: 'v7', time: '28 mai', client: 'Anderson Melo', seller: 'Ana Souza', car: 'Kardian 2024', status: 'sem_resultado', day: 'passado' },
];

export const DEALS = [
  { id: 'd1', client: 'Carlos Andrade', car: 'Golf GTI 2022', value: 'R$ 120.000', seller: 'Marcos Silva', status: 'aberta', last: 'hoje' },
  { id: 'd2', client: 'Roberto Dias', car: 'Jeep Compass 2022', value: 'R$ 165.000', seller: 'Lucas Martins', status: 'aberta', last: 'há 2 dias' },
  { id: 'd3', client: 'Anderson Melo', car: 'Renault Kardian 2024', value: 'R$ 121.000', seller: 'Ana Souza', status: 'aberta', last: 'ontem' },
  { id: 'd4', client: 'Pedro Santos', car: 'Toyota Corolla 2023', value: 'R$ 138.000', seller: 'João Ferreira', status: 'aprovacao', disc: 'Desconto 8% (acima do limite 5%)', last: 'hoje' },
  { id: 'd5', client: 'Larissa Gomes', car: 'Nissan Kicks 2023', value: 'R$ 124.000', seller: 'Lucas Martins', status: 'aprovacao', disc: 'Desconto 6% (acima do limite 5%)', last: 'ontem' },
];

export const SALES = [
  { id: 'sa1', client: 'Fernando Costa', car: 'Golf GTI 2022', value: 'R$ 120.000', seller: 'Marcos Silva', date: '12 jun', status: 'entregue', pay: 'Financiamento 48x' },
  { id: 'sa2', client: 'Renata Alves', car: 'VW Polo 2023', value: 'R$ 98.000', seller: 'Ana Souza', date: '11 jun', status: 'aguardando', pay: 'À vista' },
  { id: 'sa3', client: 'Marcelo Pinto', car: 'Honda HR-V 2023', value: 'R$ 158.000', seller: 'João Ferreira', date: '10 jun', status: 'entregue', pay: 'Financiamento 60x' },
  { id: 'sa4', client: 'Aline Souza', car: 'Jeep Compass 2022', value: 'R$ 165.000', seller: 'Lucas Martins', date: '09 jun', status: 'entregue', pay: 'À vista' },
  { id: 'sa5', client: 'Gustavo Ramos', car: 'Hyundai Creta 2023', value: 'R$ 134.000', seller: 'Beatriz Lima', date: '08 jun', status: 'aguardando', pay: 'Financiamento 36x' },
];
