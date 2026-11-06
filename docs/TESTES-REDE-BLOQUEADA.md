# Testes com rede bloqueada

A suíte não consegue abrir conexões de rede, exceto para os endpoints locais listados de
forma explícita. A regra existe porque, em 2026-11-05, um bloqueio feito com `vi.spyOn` foi
desfeito pelo `vi.restoreAllMocks()` de `tests/setup.ts` e um teste chegou à Graph real com
valores fictícios.

## Como funciona

| Peça | Papel |
|---|---|
| `tests/helpers/network-guard.cjs` | O bloqueio em si, sem spies |
| `tests/helpers/network-guard.preload.cjs` | Carregado com `--require` em cada worker, antes do teste |
| `tests/helpers/network-guard.global-setup.ts` | Protege o processo principal e reprova a execução se houve tentativa fora de um teste |
| `tests/setup.ts` | Recusa rodar sem o bloqueio e reprova o teste que tentou acessar a rede |
| `tests/helpers/localDatabaseGuard.ts` | Prova que o banco é local antes de um teste escrever nele |

O bloqueio fica em `net.Socket.prototype.connect`, por onde passam `fetch`, HTTP, HTTPS, TLS,
HTTP/2 e WebSocket. O código de produção transforma erro de rede em retorno, então bloquear não
bastaria: toda tentativa é registrada e o hook `afterEach` reprova o teste, mesmo com o erro
engolido. O código de erro é `ENETWORKGUARD`.

## Mecanismos cobertos

| Mecanismo | Comportamento |
|---|---|
| `fetch`, `http`, `https`, `http2`, `net`, `tls`, `WebSocket`, cliente Supabase | Bloqueados no socket, antes do DNS |
| Pipes nomeados | Bloqueados |
| `dns`, `dns.promises`, `dns.Resolver` | Bloqueados, exceto `localhost` e IP literal em `lookup`, que não geram consulta de rede |
| `dgram` (UDP) | `send` e `connect` bloqueados |
| `child_process` | Só `docker exec -i <pilha> psql` e `docker inspect` de uma pilha `kapa-*`; shell nunca |
| `worker_threads` | `new Worker` bloqueado; o pool do Vitest usa processos |
| `process.binding` de rede | Bloqueado |

## Rodar a integração local

Nenhum endpoint é permitido por padrão, nem em loopback. Para usar o Supabase descartável:

```
KAPA_TEST_NETWORK_ALLOWLIST=127.0.0.1:57321
META_LOCAL_DB_CONTAINER=supabase_db_kapa-mvp1-sbx
```

A lista só aceita `127.0.0.1:<porta>` ou `[::1]:<porta>`. Qualquer outra coisa, inclusive
`localhost`, domínio, curinga ou rede privada, derruba o worker na partida. Não há como
permitir host externo por configuração.

Para testes que escrevem no banco, a flag de ativação não basta. O
`assertDisposableLocalDatabase()` exige, antes de criar o cliente:

- URL `http://127.0.0.1:<porta>`, sem credencial embutida;
- chaves JWT emitidas pela CLI local, sem `ref` de projeto;
- contêiner `supabase_db_kapa-*`, com a etiqueta do projeto confirmada no Docker;
- gateway da mesma pilha publicando exatamente a porta da URL.

## Limitações

- **Módulos nativos** podem abrir sockets sem passar pelo Node. O projeto não usa nenhum
  (`pg-native`, por exemplo), mas uma dependência nova poderia.
- **`docker exec` permitido** roda `psql` dentro do contêiner. O `psql` poderia, em tese, abrir
  conexão a partir do contêiner, fora do alcance do bloqueio. Os testes só enviam SQL fixo.
- **O processo principal do Vitest** tem socket e DNS bloqueados, mas não `child_process`, porque
  precisa criar os workers.
- **Código fora da suíte** não é coberto: `npm run dev`, `next build` e os scripts em `scripts/`.
- **Rotas com `fetch` injetado** continuam responsáveis pelo próprio fake. O bloqueio impede a
  saída, mas não substitui o fake.
- **Testes de integração antigos** (`leadgen-*-local`) têm só a trava de URL local. A prova completa
  está em `connection-local` e a trava de `sbx` em `mvp2-multicompany-local`.
