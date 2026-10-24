-- KMSA v5: only one schema addition, identifying archived evidence by its original staging upload.
-- No organizational structure, hierarchy or new management module.
alter table public.milestone_evidence
  add column if not exists source_storage_path text;
create unique index if not exists milestone_evidence_upload_identity_idx
  on public.milestone_evidence(source_storage_path)
  where source_storage_path is not null;
