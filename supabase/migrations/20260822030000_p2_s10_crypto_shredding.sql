alter table hosted_auth.person_identities
  add column provider_cleanup_satisfied_at timestamptz,
  add column crypto_shredded_at timestamptz;

alter table hosted_auth.person_identities
  add constraint identity_provider_cleanup_requires_deletion check (
    provider_cleanup_satisfied_at is null
    or (
      status in ('deleting', 'deleted')
      and deletion_eligible_at is not null
      and provider_cleanup_satisfied_at >= deletion_eligible_at
    )
  ),
  add constraint identity_crypto_shred_order check (
    crypto_shredded_at is null
    or (
      provider_cleanup_satisfied_at is not null
      and crypto_shredded_at >= provider_cleanup_satisfied_at
    )
  ),
  add constraint identity_deleted_key_shredded check (
    status <> 'deleted' or crypto_shredded_at is not null
  );

create index person_identities_crypto_shredded
  on hosted_auth.person_identities (person_id)
  where crypto_shredded_at is not null;
