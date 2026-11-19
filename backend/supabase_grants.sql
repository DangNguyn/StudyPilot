-- Run this in the Supabase SQL Editor when the API reports permission denied.
grant select, insert, update, delete
on table public.quiz_assessments
to service_role;

grant select, insert, update, delete
on table public.study_reminders
to service_role;
