alter table hosted_auth.person_identities
  add column deletion_requested_at timestamptz,
  add column deletion_eligible_at timestamptz,
  add column deletion_claimed_at timestamptz;

update hosted_auth.person_identities
   set deletion_requested_at = coalesce(deleted_at, updated_at),
       deletion_eligible_at = coalesce(deleted_at, updated_at)
 where status = 'deleted';

alter table hosted_auth.person_identities
  add constraint identity_deletion_schedule_complete check (
    (deletion_requested_at is null and deletion_eligible_at is null)
    or
    (deletion_requested_at is not null
      and deletion_eligible_at is not null
      and deletion_eligible_at >= deletion_requested_at)
  ),
  add constraint identity_deletion_status_scheduled check (
    status not in ('deleting', 'deleted')
    or (deletion_requested_at is not null and deletion_eligible_at is not null)
  );

create index person_identities_deletion_claim
  on hosted_auth.person_identities
  (deletion_eligible_at, deletion_claimed_at, person_id)
  where status = 'deleting';
