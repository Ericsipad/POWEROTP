do $$
declare
  constraint_name text;
begin
  select c.conname
    into constraint_name
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'hosted_auth'
     and t.relname = 'person_identities'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%potp_didit_id IS NULL%didit_internal_id IS NULL%';

  if constraint_name is null then
    raise exception 'Original Didit mapping constraint was not found';
  end if;

  execute format(
    'alter table hosted_auth.person_identities drop constraint %I',
    constraint_name
  );
end
$$;

alter table hosted_auth.person_identities
  add constraint person_identities_didit_mapping_order_check
  check (didit_internal_id is null or potp_didit_id is not null);
