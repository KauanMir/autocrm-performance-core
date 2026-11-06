# Trabalho neste repositório

- O usuário quer execução direta: investigar, implementar, revisar e validar sem intermediar prompts entre agentes.
- Leia `docs/DEVELOPMENT-STATUS.md` para retomar o trabalho e atualize-o ao concluir uma entrega.
- Preserve alterações locais anteriores. Não inclua arquivos alheios à entrega em commits.
- Prefira alterações pequenas e branches `codex/` para implementação. Não faça push em `main` presumindo que não dispara deploy.
- Valide com os testes pertinentes e `npx tsc --noEmit --incremental false`. A suíte completa usa `npm run test:run -- --maxWorkers=2`.
- Nunca imprima ou versione segredos de `.env.local`, tokens, ciphertext ou dados pessoais. Testes usam mocks/dados fictícios.
- Diferencie código local, histórico relatado e estado remoto comprovado. Ter migrations no Git não prova que foram aplicadas.
- Preserve isolamento por empresa, RLS, idempotência e flags de integração desligadas por padrão.
- WhatsApp: respeite o congelamento de produção documentado em `docs/WHATSAPP-CLOUD-API.md`; backup real e restauração comprovada são pré-requisitos das liberações bloqueadas.
- Não enfraqueça testes, tipos ou controles para obter uma validação verde. Registre falhas anteriores separadamente.
