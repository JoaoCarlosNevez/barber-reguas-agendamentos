-- =============================================================================
-- Lembrete de retorno: 20 dias depois de um corte concluído, se o cliente não
-- marcou outro horário, o barbeiro recebe um push para chamar no WhatsApp.
--   * return_reminded_at: o atendimento já foi avaliado (enviado ou pulado).
--   * return_pending: aparece em "Chamar de volta" no app até o barbeiro
--     mandar a mensagem ou dispensar.
-- O envio roda junto do completion-reminders (pg_cron a cada 5 min).
-- =============================================================================

alter table public.appointments
  add column return_reminded_at timestamptz,
  add column return_pending boolean not null default false;

create index appointments_return_due_idx on public.appointments (starts_at)
  where status = 'completed' and return_reminded_at is null;
create index appointments_return_pending_idx on public.appointments (barber_id)
  where return_pending;

-- barbeiro/dono marca como resolvido (RLS appointments_staff_update limita a quem)
grant update (return_pending) on public.appointments to authenticated;
