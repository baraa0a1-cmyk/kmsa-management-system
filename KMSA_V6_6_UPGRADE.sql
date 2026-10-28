-- KMSA 6.6: reading an action notification is NOT completing the action.
BEGIN;
ALTER TABLE public.user_notifications ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.user_notifications ADD COLUMN IF NOT EXISTS resolution_kind text CHECK(resolution_kind IN ('COMPLETED','SUPERSEDED'));
CREATE INDEX IF NOT EXISTS kmsa_v66_unresolved_notifications ON public.user_notifications(profile_id,event_type,entity_type,entity_id) WHERE resolved_at IS NULL;
DROP FUNCTION IF EXISTS public.user_notification_feed_v66(integer);
CREATE FUNCTION public.user_notification_feed_v66(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid,event_type text,title text,body text,entity_type text,entity_id uuid,action_path text,read_at timestamptz,created_at timestamptz,resolved_at timestamptz,resolution_kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT n.id,n.event_type,n.title,n.body,n.entity_type,n.entity_id,n.action_path,n.read_at,n.created_at,n.resolved_at,n.resolution_kind
 FROM public.user_notifications n
 WHERE n.profile_id=public.current_profile_id() AND n.cycle_id=public.kmsa_active_cycle_id()
 ORDER BY n.created_at DESC LIMIT greatest(1,least(coalesce(p_limit,50),100));
$$;
REVOKE ALL ON FUNCTION public.user_notification_feed_v66(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.user_notification_feed_v66(integer) TO authenticated;


-- Backfill already completed actions from earlier releases, without inferring success from read_at.
UPDATE public.user_notifications n SET resolution_kind='COMPLETED',resolved_at=(
 SELECT min(e.created_at) FROM public.milestone_supervision_events e
 WHERE e.actor_id=n.profile_id AND e.milestone_id=n.entity_id
 AND e.event_type IN ('PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION')
 AND e.created_at>=n.created_at
) WHERE n.resolved_at IS NULL AND n.entity_type='MILESTONE'
 AND n.event_type IN ('PROJECT_PROGRESS_UPDATED','PROJECT_RESULT_READY')
 AND EXISTS (SELECT 1 FROM public.milestone_supervision_events e WHERE e.actor_id=n.profile_id AND e.milestone_id=n.entity_id AND e.created_at>=n.created_at AND e.event_type IN ('PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION'));
UPDATE public.user_notifications n SET resolution_kind='COMPLETED',resolved_at=(
 SELECT min(a.created_at) FROM public.project_activity_entries a WHERE a.author_id=n.profile_id AND a.milestone_id=n.entity_id AND a.kind='MILESTONE_UPDATE' AND a.created_at>=n.created_at
) WHERE n.resolved_at IS NULL AND n.entity_type='MILESTONE'
 AND n.event_type IN ('MILESTONE_UPDATE_REQUEST','MILESTONE_REVIEW_PROGRESS_FOLLOW_UP','MILESTONE_REVIEW_PROGRESS_UNCLEAR','MILESTONE_REVIEW_RESULT_REVISION')
 AND EXISTS (SELECT 1 FROM public.project_activity_entries a WHERE a.author_id=n.profile_id AND a.milestone_id=n.entity_id AND a.kind='MILESTONE_UPDATE' AND a.created_at>=n.created_at);

-- Durable completion in the same DB transaction as the corresponding action.
-- This also guards the UI if an Edge Function returns after saving but before acknowledging.
CREATE OR REPLACE FUNCTION public.kmsa_v66_close_notification_at_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='project_activity_entries' THEN
  IF NEW.kind='MILESTONE_UPDATE' AND NEW.milestone_id IS NOT NULL THEN
   UPDATE public.user_notifications n SET resolved_at=NEW.created_at,resolution_kind='COMPLETED',read_at=coalesce(n.read_at,NEW.created_at)
   WHERE n.profile_id=NEW.author_id AND n.entity_type='MILESTONE' AND n.entity_id=NEW.milestone_id
   AND n.event_type IN('MILESTONE_UPDATE_REQUEST','MILESTONE_REVIEW_PROGRESS_FOLLOW_UP','MILESTONE_REVIEW_PROGRESS_UNCLEAR','MILESTONE_REVIEW_RESULT_REVISION')
   AND n.resolved_at IS NULL AND n.created_at<=NEW.created_at;
  END IF;
 ELSIF TG_TABLE_NAME='milestone_supervision_events' THEN
  IF NEW.event_type IN ('PROGRESS_OK','PROGRESS_FOLLOW_UP','PROGRESS_UNCLEAR','RESULT_OK','RESULT_REVISION') AND NEW.source_activity_id IS NOT NULL THEN
   UPDATE public.user_notifications n SET resolved_at=NEW.created_at,resolution_kind='COMPLETED',read_at=coalesce(n.read_at,NEW.created_at)
   WHERE n.profile_id=NEW.actor_id AND n.event_type IN('PROJECT_PROGRESS_UPDATED','PROJECT_RESULT_READY','SUPERVISION_REVIEW_REQUEST_1','SUPERVISION_REVIEW_REQUEST_2')
    AND ((n.entity_type='ACTIVITY' AND n.entity_id=NEW.source_activity_id)
      OR (n.entity_type='MILESTONE' AND n.entity_id=NEW.milestone_id))
    AND n.resolved_at IS NULL AND n.created_at<=NEW.created_at;
   -- A fresh evaluation replaces pending review alerts tied to older versions.
   UPDATE public.user_notifications n SET resolved_at=NEW.created_at,resolution_kind='SUPERSEDED',read_at=coalesce(n.read_at,NEW.created_at)
   FROM public.project_activity_entries a
   WHERE n.profile_id=NEW.actor_id AND n.entity_type='ACTIVITY' AND n.entity_id=a.id
     AND a.milestone_id=NEW.milestone_id AND a.created_at<=NEW.created_at
     AND n.entity_id IS DISTINCT FROM NEW.source_activity_id
     AND n.event_type IN('PROJECT_PROGRESS_UPDATED','PROJECT_RESULT_READY','SUPERVISION_REVIEW_REQUEST_1','SUPERVISION_REVIEW_REQUEST_2')
     AND n.resolved_at IS NULL AND n.created_at<=NEW.created_at;
  END IF;
 ELSIF TG_TABLE_NAME='project_supervision_checks' THEN
  UPDATE public.user_notifications n SET resolved_at=NEW.created_at,resolution_kind='COMPLETED',read_at=coalesce(n.read_at,NEW.created_at)
  WHERE n.profile_id=NEW.supervisor_id AND n.event_type='REQUEST_SUPERVISION_CHECK' AND n.entity_type='INITIATIVE'
    AND n.entity_id=NEW.initiative_id AND n.resolved_at IS NULL AND n.created_at<=NEW.created_at;
 ELSIF TG_TABLE_NAME='project_execution_pauses' THEN
  IF NEW.status IN('APPROVED','REJECTED') AND OLD.status='PENDING' THEN
   UPDATE public.user_notifications n SET resolved_at=coalesce(NEW.decided_at,now()),resolution_kind='COMPLETED',read_at=coalesce(n.read_at,now())
   WHERE n.profile_id=NEW.decided_by AND n.event_type='PROJECT_PAUSE_PENDING' AND n.entity_type='INITIATIVE'
     AND n.entity_id=NEW.initiative_id AND n.resolved_at IS NULL AND n.created_at<=coalesce(NEW.decided_at,now());
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.kmsa_v66_close_notification_at_source() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS kmsa_v66_activity_notify_complete ON public.project_activity_entries;
CREATE TRIGGER kmsa_v66_activity_notify_complete AFTER INSERT ON public.project_activity_entries
FOR EACH ROW EXECUTE FUNCTION public.kmsa_v66_close_notification_at_source();
DROP TRIGGER IF EXISTS kmsa_v66_review_notify_complete ON public.milestone_supervision_events;
CREATE TRIGGER kmsa_v66_review_notify_complete AFTER INSERT ON public.milestone_supervision_events
FOR EACH ROW EXECUTE FUNCTION public.kmsa_v66_close_notification_at_source();
DROP TRIGGER IF EXISTS kmsa_v66_supervision_notify_complete ON public.project_supervision_checks;
CREATE TRIGGER kmsa_v66_supervision_notify_complete AFTER INSERT ON public.project_supervision_checks
FOR EACH ROW EXECUTE FUNCTION public.kmsa_v66_close_notification_at_source();
DROP TRIGGER IF EXISTS kmsa_v66_pause_notify_complete ON public.project_execution_pauses;
CREATE TRIGGER kmsa_v66_pause_notify_complete AFTER UPDATE OF status ON public.project_execution_pauses
FOR EACH ROW EXECUTE FUNCTION public.kmsa_v66_close_notification_at_source();

COMMIT;
