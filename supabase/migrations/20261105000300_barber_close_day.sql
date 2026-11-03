-- =============================================================================
-- Barbeiro fecha (e reabre) a própria agenda de um dia pelo app: cria/remove
-- bloqueios (time_off) só na própria agenda. Dono continua podendo tudo.
-- =============================================================================

create policy time_off_barber_insert on public.time_off
  for insert to authenticated
  with check (barber_id = (select private.my_barber_id()));

create policy time_off_barber_delete on public.time_off
  for delete to authenticated
  using (barber_id = (select private.my_barber_id()));
