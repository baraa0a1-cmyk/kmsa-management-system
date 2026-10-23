-- Run after deploying scheduled-monitor and storing secrets in Supabase Vault.
-- Replace placeholders with your project values or configure the same job from Dashboard > Integrations > Cron.
select cron.schedule(
  'kmsa-monitor-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/scheduled-monitor',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret','YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
