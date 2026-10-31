-- 0007: looking at an alert is a scored input (alert_hygiene), so a recalculation
-- caused by reading or archiving one needs a trigger that says so. Widened here
-- rather than in 0002 because that migration has already run.

alter table public.security_assessments
  drop constraint security_assessments_trigger_valid;

alter table public.security_assessments
  add constraint security_assessments_trigger_valid
  check (trigger_source in (
    'signup', 'account_created', 'account_updated', 'review_logged', 'checklist_updated',
    'learning_completed', 'recommendation_updated', 'incident_updated', 'alerts_reviewed',
    'analysis_run', 'mfa_updated', 'manual', 'periodic'
  ));
