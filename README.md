# Barbearia · Agendamento (PWA)

App de agendamento para barbearia: página pública de agendamento, área do cliente com cartão fidelidade, painel PWA do barbeiro com Web Push e painel admin.

**Stack:** React 19 + TypeScript (Vite 8), React Router, TanStack Query, Tailwind CSS 4, react-hook-form + zod · Supabase (Postgres + Auth + RLS + Edge Functions em Deno) · vite-plugin-pwa (injectManifest).

> Status: **Fases 1–6 implementadas** (banco + RLS, Edge Functions, agendamento público, conta do cliente com fidelidade, painel do barbeiro com Web Push/PWA e painel admin). Testado localmente; o projeto remoto ainda precisa do deploy das functions novas, de um admin e do catálogo.

---

## Setup local

Pré-requisitos: Node 22+, Docker rodando.

```bash
npm install
npm run db:start          # supabase start (sobe Postgres, Auth, REST, Realtime...)
npm run db:reset          # aplica migrations + seed
cp .env.example .env.local
npx supabase status -o env   # copie API_URL e ANON_KEY para o .env.local
npm run dev               # http://localhost:5173
```

O Supabase CLI é dependência de dev (`npx supabase ...`), não precisa instalar global.

### Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | Vite em modo dev |
| `npm run typecheck` | `tsc -b` (strict) |
| `npm run lint` | oxlint, warnings contam como erro |
| `npm run check` | typecheck + lint |
| `npm run db:reset` | recria o banco local com migrations + seed |
| `npm run db:test` | testes pgTAP (`supabase/tests/database`) |
| `npm run db:types` | regenera os tipos do banco (frontend e functions) |
| `npm test` | testes unitários (Vitest): cálculo de slots, fuso, telefone |
| `npm run fn:serve` | Edge Functions locais (`supabase functions serve`) |
| `npm run fn:check` | `deno check` + `deno lint` das functions (Deno vem como devDependency) |
| `npm run test:integration` | concorrência/anti-overbooking + fluxo HTTP (precisa de `db:start` e `fn:serve`) |
| `npm run fn:deploy` | deploy das functions no projeto vinculado |

### Usuários do seed (só dev — senha `Senha@123`)

| E-mail | Papel |
| --- | --- |
| `admin@barbearia.dev` | admin |
| `rafael@barbearia.dev` | barbeiro (faz todos os serviços) |
| `lucas@barbearia.dev` | barbeiro (sem pigmentação) |
| `cliente@barbearia.dev` | cliente |

Seed também cria 4 serviços, horários seg–sex 09:00–19:00 (almoço 12–13) e sáb 09:00–14:00, e regra de fidelidade de 10 selos.

### Projeto remoto

Projeto Supabase: `lttdrjzhtjjvqjpawtuj` (já vinculado com `supabase link`). Credenciais do CLI ficam em arquivos locais fora do git:

- `.supabase-access-token` — token de acesso da conta dona do projeto
- `.supabase-db-password` — senha do banco

```bash
export SUPABASE_ACCESS_TOKEN=$(cat .supabase-access-token)
npx supabase db push                                   # migrations (sem seed)
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy                          # a partir da Fase 2
```

Não use `supabase config push` sem revisar o diff: o `config.toml` local desliga a confirmação de e-mail e o MFA (conveniente em dev) e isso seria enviado para produção. Ajustes de auth no remoto foram feitos pontualmente via Management API (Site URL, redirects, senha mínima 8).

Chaves VAPID: geradas em `supabase/functions/.env` (fora do git) e cadastradas como secrets. A chave pública vai também no `VITE_VAPID_PUBLIC_KEY` do frontend.

---

## Banco de dados

Migrations em `supabase/migrations`:

1. `..._extensions_and_types` — `btree_gist`, `pgcrypto`, enums, domínio `phone_e164`, schema `private`.
2. `..._tables` — todas as tabelas, incluindo a constraint **anti-overbooking**:
   ```sql
   exclude using gist (barber_id with =, tstzrange(starts_at, ends_at, '[)') with &&)
   where (status = 'scheduled')
   ```
3. `..._functions_triggers` — helpers de autorização, trigger de signup, transições de status, geração de selo, `redeem_loyalty`.
4. `..._rls_and_grants` — GRANTs mínimos por tabela/coluna + RLS em todas as tabelas.

### Modelo de acesso

| Quem | Acesso |
| --- | --- |
| anon | só leitura de catálogo: `services`/`barbers` ativos (colunas públicas), `barber_services`, `loyalty_rules` ativas, `app_settings`. **Sem acesso** a clientes, agendamentos, perfis etc. — fluxo público passa pelas Edge Functions. |
| cliente | lê o próprio `profile`, `customer`, agendamentos, serviços do agendamento, selos e resgates. Edita só `name`/`phone` do profile. |
| barbeiro | lê/atualiza (só `status`) agendamentos com o seu `barber_id`; lê clientes que já atendeu e os selos deles; lê seus horários e bloqueios. |
| admin | leitura total; escrita no catálogo, horários, bloqueios, regras e configurações. |
| service role | Edge Functions (criação de agendamento, cancelamento por token, push, resgate). |

Testes: `npm run db:test` (44 asserções pgTAP) provam, entre outros, que anon e cliente A não leem dados do cliente B, que role não pode ser escalado, que o barbeiro só vê/edita a própria agenda e que o banco rejeita sobreposição de horários.

---

## Edge Functions

Código em `supabase/functions`; módulos compartilhados em `_shared` (o cálculo de horários é puro, sem I/O, e roda igual no Deno e no Vitest).

Todas: só `POST`, CORS restrito a `APP_ORIGINS` (origem fora da lista recebe 403), validação zod com mensagens em pt-BR, erros no formato `{ "error": { "code", "message", "details?" } }`, logs só com ids internos (nunca nome, telefone, IP ou token).

### `get-availability` (pública)

```json
{ "barber_id": "uuid | any", "service_ids": ["uuid"], "date": "2026-11-10" }
```
Resposta: `duration_min`, `total_price_cents`, `services`, `barbers` e `slots: [{ starts_at (UTC), time ("HH:MM" local), barber_ids }]`. Considera expediente, intervalo, bloqueios, agendamentos, duração somada, antecedência mínima, janela máxima e passo da grade (`app_settings`).

### `create-appointment` (pública, JWT de cliente opcional)

```json
{
  "barber_id": "uuid | any", "service_ids": ["uuid"], "starts_at": "2026-11-10T18:00:00.000Z",
  "customer": { "name": "João", "phone": "(11) 98765-4321" },
  "website": "", "turnstile_token": "opcional"
}
```
Fluxo: honeypot → telefone para E.164 → rate limit (IP: 10/10 min; telefone: 5/h) → Turnstile (se `TURNSTILE_SECRET_KEY` existir) → sessão do Supabase Auth, se houver → revalida o horário com a mesma regra da listagem → `book_appointment` (transação: customer, agendamento, snapshot dos serviços) → push ao barbeiro → `201` com o **token em claro (única vez)**. Horário tomado: `409 slot_unavailable` ("Esse horário não está mais disponível").

Com "qualquer disponível", escolhe o barbeiro menos ocupado no dia e, se perder a corrida, tenta o próximo.

---

### Demais functions (Fases 3–6)

| Function | Quem | O que faz |
| --- | --- | --- |
| `get-appointment` | pública (token) | detalhes do agendamento pelo link da confirmação |
| `cancel-appointment` | token **ou** cliente dono (`appointment_id`) | cancela respeitando `cancel_min_notice_hours`; avisa o barbeiro por push |
| `push` | barbeiro/admin | `subscribe` (salva a assinatura Web Push) e `test` |
| `redeem-loyalty` | barbeiro (clientes que atendeu) / admin | consome os selos da regra ativa |
| `admin-create-barber` | admin | cria login + barbeiro + expediente padrão |
| `admin-set-password` | admin | define uma nova senha (não há "esqueci a senha" por e-mail) |

Barbeiro/admin mudam status direto na tabela (RLS + trigger de transição). Push real usa `npm:web-push` com as chaves VAPID dos secrets.

## Frontend

| Rota | Quem |
| --- | --- |
| `/` | agendamento (serviços → barbeiro → dia/horário → dados) |
| `/agendamento/:token` | ver, cancelar, pôr na agenda (.ics), compartilhar |
| `/entrar`, `/cadastro` | auth (senha esquecida: o admin troca no cadastro do barbeiro) |
| `/minha-conta` | cartão fidelidade, próximos horários, histórico, dados |
| `/barbeiro` | agenda do dia, atendido/faltou/cancelar, resgate de prêmio, ativar push |
| `/admin` | agenda geral, serviços, barbeiros (serviços, expediente, folgas), fidelidade, ajustes |

PWA: `src/sw.ts` (injectManifest) faz precache e recebe os pushes. No iPhone, push só funciona com o app adicionado à Tela de Início.

### Primeiro admin (produção)

Crie a conta pelo `/cadastro` e promova pelo SQL Editor:
```sql
update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'SEU_EMAIL');
```

## Decisões registradas

Escolhas feitas onde a especificação deixava margem (padrão mais simples/seguro):

1. **Linter: oxlint** (padrão do template atual do Vite) em vez de ESLint, com `no-explicit-any` e `no-non-null-assertion` como erro e `--deny-warnings`.
2. **Configurações em `app_settings`** (linha única): fuso, antecedência mínima para agendar (60 min), janela máxima (30 dias), antecedência mínima para cancelar pelo link (2 h), passo da grade de horários (15 min). Leitura pública, edição só admin.
3. **`weekday` 0 = domingo** (mesma convenção do `Date#getDay`). `working_hours` guarda horário local da barbearia (`time`); instantes são sempre `timestamptz` em UTC.
4. **Um turno por dia por barbeiro** (`unique (barber_id, weekday)`) com um intervalo opcional.
5. **Visitante e cliente cadastrado nunca compartilham a linha de `customers`.** Visitantes são únicos por telefone (`is_guest = true`); cadastrados têm uma linha por `auth_user_id`. Um visitante digitando o telefone de um cliente cadastrado não "entra" no histórico/fidelidade dele, e quem cria conta não herda histórico de visitante sem verificação.
6. **Role nunca vem do usuário.** O trigger de signup só lê role de `raw_app_meta_data` (que só a service role define); `raw_user_meta_data` é ignorado. A coluna `role` não tem GRANT de UPDATE para `authenticated`.
7. **Telefone obrigatório no cadastro:** o trigger só cria o `customer` com telefone E.164 válido. Se alguém criar conta pela API sem telefone, o profile fica sem telefone e o app exige completar antes de agendar (não bloqueia convites de barbeiro, que não têm telefone).
8. **Selo de fidelidade via trigger no banco** (ao virar `completed`), não só na edge function: assim a regra vale para qualquer caminho de atualização e é idempotente (`unique(appointment_id)`). Só gera selo se o customer é de usuário cadastrado.
9. **Selos consumidos são marcados** (`loyalty_stamps.redemption_id`) em vez de apagados, mantendo histórico. `redeem_loyalty` trava a linha do cliente e os selos (`FOR UPDATE`) para serializar resgates concorrentes; só a service role executa.
10. **Transições de status:** só `scheduled → cancelled | completed | no_show`. `completed`/`no_show` só depois do horário de início. `cancelled_by` é derivado do role de quem está logado (não confiável vindo do cliente).
11. **Snapshot do nome do serviço** em `appointment_services.service_name` (além de preço e duração) para histórico e texto de push mesmo se o serviço for renomeado.
12. **Default privileges revogados** no schema `public`: tabelas/funções novas não ficam acessíveis a anon/authenticated sem GRANT explícito.
13. **Reservas serializadas por barbeiro** (`pg_advisory_xact_lock` em `book_appointment`). Teste de estresse mostrou que inserts concorrentes na constraint `EXCLUDE` geram deadlock (`40P01`) e às vezes ninguém fica com o horário. Com o lock, a constraint segue como garantia final e os perdedores recebem conflito limpo. Teste: 6 rodadas × 20 reservas simultâneas, sempre exatamente 1 vencedora.
14. **Preço, duração e `ends_at` calculados no banco** (`book_appointment` relê `services` e confere `barber_services`); o cliente manda só ids e horário de início.
15. **Rate limit em tabela Postgres** (`private.rate_limits`, janela fixa, chaves com hash salgado de IP/telefone). Se a checagem falhar por erro de banco, a requisição segue (fail-open) e o erro fica no log, para o agendamento não cair junto. O IP vem de `cf-connecting-ip`/`x-forwarded-for`; por isso também há limite por telefone.
16. **Honeypot preenchido devolve 400 `bot_detected`** (sem sucesso falso), para simplificar.
17. **Push ao barbeiro:** `notifyBarber` envia Web Push (VAPID) em novo agendamento e cancelamento pelo cliente. Falha de push nunca derruba o fluxo; assinaturas expiradas (404/410) são apagadas.
18. **Edge Functions públicas com `verify_jwt = false`**: visitante não tem sessão. Quando o app manda a sessão de um cliente logado, quem valida é o Supabase Auth (`auth.getUser`).
19. **Barbeiro criado pela API tem o role gravado pela function.** O GoTrue grava `app_metadata` depois do INSERT em `auth.users`, então o trigger de signup não enxerga o role; `admin-create-barber` atualiza `profiles.role` com a service role.
20. **Cancelamento pelo cliente só via Edge Function** (token ou sessão + dono), para aplicar a antecedência mínima no servidor.
