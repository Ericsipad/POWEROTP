create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'potp_hosted_auth_service') then
    create role potp_hosted_auth_service nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'potp_identity_admin') then
    create role potp_identity_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'POTP_backenduser') then
    create role "POTP_backenduser" nologin inherit;
  end if;
end
$$;

grant potp_hosted_auth_service to "POTP_backenduser";

create schema if not exists hosted_auth;
revoke all on schema hosted_auth from public, anon, authenticated, service_role;
grant usage on schema hosted_auth to potp_hosted_auth_service, potp_identity_admin;

create type hosted_auth.identity_data_mode as enum ('powerotp_pii', 'didit_pii');
create type hosted_auth.identity_status as enum ('pending', 'active', 'suspended', 'deleting', 'deleted');
create type hosted_auth.contact_status as enum ('pending', 'verified', 'revoked');
create type hosted_auth.consent_decision as enum ('accepted', 'declined', 'withdrawn');
create type hosted_auth.consent_purpose as enum (
  'hosted_identity_and_authentication',
  'didit_contact_custody_and_authentication',
  'age_assurance',
  'identity_kyc_assurance',
  'liveness_and_face_enrollment',
  'fresh_biometric_authentication_with_retained_face'
);
create type hosted_auth.verification_capability as enum ('age', 'kyc', 'liveness', 'biometric_authentication');
create type hosted_auth.verification_outcome as enum ('satisfied', 'not_satisfied', 'indeterminate', 'declined', 'canceled', 'expired');

create table hosted_auth.person_identities (
  person_id text primary key
    check (person_id ~ '^hpi_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  status hosted_auth.identity_status not null default 'pending',
  potp_didit_id text unique
    check (potp_didit_id is null or potp_didit_id ~ '^pdi_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  didit_internal_id uuid unique,
  passport_identity_id text,
  schema_version integer not null default 1 check (schema_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((potp_didit_id is null) = (didit_internal_id is null)),
  check ((status = 'deleted') = (deleted_at is not null))
);

create table hosted_auth.auth_profiles (
  profile_id text primary key
    check (profile_id ~ '^hap_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'),
  person_id text not null references hosted_auth.person_identities(person_id),
  identity_data_mode hosted_auth.identity_data_mode not null,
  rp_id text not null,
  webauthn_user_handle bytea not null unique check (octet_length(webauthn_user_handle) = 32),
  contact_status hosted_auth.contact_status not null default 'pending',
  status hosted_auth.identity_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (person_id, identity_data_mode),
  unique (profile_id, identity_data_mode),
  check (
    (identity_data_mode = 'powerotp_pii' and rp_id = 'authx.powerotp.com')
    or (identity_data_mode = 'didit_pii' and rp_id = 'authz.powerotp.com')
  ),
  check ((status = 'deleted') = (deleted_at is not null))
);

create table hosted_auth.webauthn_credentials (
  credential_id bytea primary key check (octet_length(credential_id) between 16 and 1024),
  profile_id text not null,
  identity_data_mode hosted_auth.identity_data_mode not null,
  public_key bytea not null check (octet_length(public_key) > 0),
  transports text[] not null default '{}',
  sign_count bigint not null default 0 check (sign_count >= 0),
  backup_eligible boolean not null,
  backup_state boolean not null,
  authenticator_aaguid uuid,
  credential_name text not null check (char_length(credential_name) between 1 and 100),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  foreign key (profile_id, identity_data_mode)
    references hosted_auth.auth_profiles(profile_id, identity_data_mode),
  check (not backup_state or backup_eligible)
);

create table hosted_auth.encrypted_identity_attributes (
  attribute_id uuid primary key default extensions.gen_random_uuid(),
  profile_id text not null,
  identity_data_mode hosted_auth.identity_data_mode not null default 'powerotp_pii'
    check (identity_data_mode = 'powerotp_pii'),
  attribute_type text not null check (attribute_type in ('email', 'phone', 'derived_date_of_birth')),
  ciphertext bytea not null check (octet_length(ciphertext) > 0),
  nonce bytea not null check (octet_length(nonce) > 0),
  authentication_tag bytea not null check (octet_length(authentication_tag) > 0),
  key_version integer not null check (key_version > 0),
  encryption_purpose text not null check (char_length(encryption_purpose) between 1 and 100),
  verification_status hosted_auth.contact_status not null default 'pending',
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attribute_id, profile_id),
  foreign key (profile_id, identity_data_mode)
    references hosted_auth.auth_profiles(profile_id, identity_data_mode)
);

create table hosted_auth.contacts (
  contact_id uuid primary key default extensions.gen_random_uuid(),
  profile_id text not null,
  identity_data_mode hosted_auth.identity_data_mode not null,
  channel text not null check (channel in ('email', 'phone')),
  lookup_hash bytea not null check (octet_length(lookup_hash) = 32),
  encrypted_attribute_id uuid,
  didit_contact_reference text,
  masked_destination text,
  status hosted_auth.contact_status not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_data_mode, channel, lookup_hash),
  foreign key (profile_id, identity_data_mode)
    references hosted_auth.auth_profiles(profile_id, identity_data_mode),
  foreign key (encrypted_attribute_id, profile_id)
    references hosted_auth.encrypted_identity_attributes(attribute_id, profile_id),
  check (
    (identity_data_mode = 'powerotp_pii' and encrypted_attribute_id is not null and didit_contact_reference is null)
    or
    (identity_data_mode = 'didit_pii' and encrypted_attribute_id is null and didit_contact_reference is not null)
  ),
  check ((status = 'verified') = (verified_at is not null))
);

create table hosted_auth.consent_records (
  consent_id uuid primary key default extensions.gen_random_uuid(),
  person_id text not null references hosted_auth.person_identities(person_id),
  profile_id text not null,
  identity_data_mode hosted_auth.identity_data_mode not null,
  purpose hosted_auth.consent_purpose not null,
  text_version text not null,
  policy_version text not null,
  provider_disclosure text not null,
  locale text not null,
  decision hosted_auth.consent_decision not null,
  affirmative_action text not null,
  withdrawal_or_deletion_path text not null,
  evidence_digest bytea not null check (octet_length(evidence_digest) = 32),
  decided_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  foreign key (profile_id, identity_data_mode)
    references hosted_auth.auth_profiles(profile_id, identity_data_mode),
  check (
    purpose <> 'didit_contact_custody_and_authentication'
    or identity_data_mode = 'didit_pii'
  )
);

create table hosted_auth.identity_verifications (
  verification_id uuid primary key default extensions.gen_random_uuid(),
  person_id text not null references hosted_auth.person_identities(person_id),
  capability hosted_auth.verification_capability not null,
  outcome hosted_auth.verification_outcome not null,
  source text not null check (source in ('didit', 'powerotp')),
  provider_operation_reference text,
  policy_version text not null,
  threshold_descriptor text,
  evidence_digest bytea not null check (octet_length(evidence_digest) = 32),
  derived_dob_ciphertext bytea,
  derived_dob_nonce bytea,
  derived_dob_authentication_tag bytea,
  derived_dob_key_version integer check (derived_dob_key_version > 0),
  verified_at timestamptz,
  expires_at timestamptz,
  recheck_after timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (derived_dob_ciphertext is null and derived_dob_nonce is null
      and derived_dob_authentication_tag is null and derived_dob_key_version is null)
    or
    (derived_dob_ciphertext is not null and derived_dob_nonce is not null
      and derived_dob_authentication_tag is not null and derived_dob_key_version is not null)
  ),
  check (expires_at is null or verified_at is null or expires_at > verified_at)
);

alter table hosted_auth.person_identities enable row level security;
alter table hosted_auth.person_identities force row level security;
alter table hosted_auth.auth_profiles enable row level security;
alter table hosted_auth.auth_profiles force row level security;
alter table hosted_auth.webauthn_credentials enable row level security;
alter table hosted_auth.webauthn_credentials force row level security;
alter table hosted_auth.encrypted_identity_attributes enable row level security;
alter table hosted_auth.encrypted_identity_attributes force row level security;
alter table hosted_auth.contacts enable row level security;
alter table hosted_auth.contacts force row level security;
alter table hosted_auth.consent_records enable row level security;
alter table hosted_auth.consent_records force row level security;
alter table hosted_auth.identity_verifications enable row level security;
alter table hosted_auth.identity_verifications force row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'person_identities', 'auth_profiles', 'webauthn_credentials',
    'encrypted_identity_attributes', 'contacts', 'consent_records',
    'identity_verifications'
  ]
  loop
    execute format(
      'create policy internal_service_only on hosted_auth.%I for all to potp_hosted_auth_service, potp_identity_admin using (true) with check (true)',
      table_name
    );
  end loop;
end
$$;

revoke all on all tables in schema hosted_auth from public, anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema hosted_auth to potp_hosted_auth_service;
grant select, insert, update, delete on all tables in schema hosted_auth to potp_identity_admin;
alter default privileges in schema hosted_auth
  revoke all on tables from public, anon, authenticated, service_role;
