alter table hosted_auth.contacts
  add column lookup_key_version integer not null default 1
    check (lookup_key_version > 0);

alter table hosted_auth.contacts
  alter column lookup_key_version drop default;

alter table hosted_auth.contacts
  drop constraint contacts_identity_data_mode_channel_lookup_hash_key;

alter table hosted_auth.contacts
  add constraint contacts_mode_channel_version_hash_key
    unique (identity_data_mode, channel, lookup_key_version, lookup_hash);
