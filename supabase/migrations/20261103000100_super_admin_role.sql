-- Novo papel: super_admin (dono do sistema). Fica em migration própria porque
-- um valor novo de enum não pode ser usado na mesma transação em que é criado.
alter type public.user_role add value if not exists 'super_admin';
