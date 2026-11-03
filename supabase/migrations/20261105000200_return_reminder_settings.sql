-- =============================================================================
-- Lembrete de retorno configurável pelo dono (Gestão > Configurações):
-- liga/desliga, dias depois do corte, horário de envio, mensagem do WhatsApp
-- e quais serviços contam (services.return_reminder).
-- =============================================================================

alter table public.app_settings
  add column return_reminder_enabled boolean not null default true,
  add column return_reminder_days integer not null default 20
    check (return_reminder_days between 1 and 180),
  add column return_reminder_from_hour integer not null default 9
    check (return_reminder_from_hour between 0 and 23),
  add column return_reminder_until_hour integer not null default 20
    check (return_reminder_until_hour between 1 and 24),
  -- {nome} = primeiro nome, {dias} = dias desde o corte, {link} = site de agendamento
  add column return_reminder_message text not null
    default 'Oi, {nome}! Aqui é do Studio Réguas ✂️ Já faz {dias} dias do seu último corte. Vamos agendar seu corte? É só escolher o horário: {link}'
    check (char_length(return_reminder_message) between 5 and 600),
  add constraint app_settings_return_hours check (return_reminder_until_hour > return_reminder_from_hour);

alter table public.services
  add column return_reminder boolean not null default false;

-- até aqui contava serviço com "corte" no nome
update public.services set return_reminder = true where name ilike '%corte%';
