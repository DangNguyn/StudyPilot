-- L4 (26/11/2026): bài ôn trượt → khoá kế hoạch + bài tổng hợp 20 câu.
-- Chạy 1 lần trong Supabase → SQL Editor. Chạy lại nhiều lần không sao.

alter table public.review_plans
  add column if not exists final_quiz_id uuid references public.quizzes(id) on delete set null,
  add column if not exists needs_attention boolean not null default false;

create index if not exists review_plans_final_quiz_id_idx on public.review_plans(final_quiz_id);

-- Cho phép trạng thái mới "final_required" (nếu bảng có ràng buộc CHECK cho cột status)
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.review_plans'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.review_plans drop constraint %I', c.conname);
    raise notice 'Đã bỏ ràng buộc cũ: %', c.conname;
  end loop;
end $$;

alter table public.review_plans
  add constraint review_plans_status_check
  check (status in ('pending', 'in_progress', 'final_required', 'completed', 'cancelled', 'expired'))
  not valid;

grant select, insert, update, delete on table public.review_plans to service_role;

-- Kiểm tra
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'review_plans'
  and column_name in ('final_quiz_id', 'needs_attention');
