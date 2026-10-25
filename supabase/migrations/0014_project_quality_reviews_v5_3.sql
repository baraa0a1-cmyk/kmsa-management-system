-- KMSA v5.3: quality review is tied to exactly one execution update.
-- Apply ONLY after v5.2 SQL; the reviewer never approves a step before the next begins.
alter table public.milestone_supervision_events
  add column if not exists source_activity_id uuid references public.project_activity_entries(id) on delete set null;
alter table public.milestone_supervision_events
  drop constraint if exists milestone_supervision_events_event_type_check;
alter table public.milestone_supervision_events
  add constraint milestone_supervision_events_event_type_check
  check (event_type in (
    'COMPLETION_READ','PROGRESS_REVIEW','UPDATE_REQUEST','REQUEST_ANSWERED',
    'PROGRESS_OK','PROGRESS_FOLLOW_UP','RESULT_OK','RESULT_REVISION'
  ));
create index if not exists milestone_supervision_review_source
 on public.milestone_supervision_events(source_activity_id, actor_id)
 where source_activity_id is not null;
-- Continue to disallow INSERT/UPDATE/DELETE to authenticated: trusted workflow only.

-- Record delegation changes in the same project timeline as work updates.
alter table public.project_activity_entries drop constraint if exists project_activity_entries_kind_check;
alter table public.project_activity_entries add constraint project_activity_entries_kind_check
 check(kind in ('MILESTONE_UPDATE','PERIODIC_CHECKIN','SECRETARY_NOTE','INTERVENTION',
                'REFERENCE','LEAD_NOTE','SUPERVISOR_ASSIGNMENT','DESIGN_CHANGE','PROJECT_CHANGE','GS_DECISION'));
