-- Run this in the Supabase SQL Editor when the API reports permission denied.
grant select, insert, update, delete
on table public.quiz_assessments
to service_role;

grant select, insert, update, delete
on table public.study_reminders
to service_role;

-- Bộ flashcard tự tải lên (trang Flashcards → "Tải tài liệu khác để tạo thẻ").
-- Thẻ của bộ nằm chung bảng flashcards, có deck_id và để trống topic_id.
create table if not exists public.flashcard_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  file_name text,
  created_at timestamptz not null default now()
);

alter table public.flashcards
  add column if not exists deck_id uuid references public.flashcard_decks(id) on delete cascade;
alter table public.flashcards alter column topic_id drop not null;
alter table public.flashcards alter column source_chunk_id drop not null;
create index if not exists flashcards_deck_id_idx on public.flashcards(deck_id);

grant select, insert, update, delete
on table public.flashcard_decks
to service_role;

-- Ngôn ngữ nội dung AI viết cho từng kế hoạch (tóm tắt, câu hỏi, bài ôn, giải thích).
-- Đã chạy ngày 23/11/2026; kế hoạch cũ nhận mặc định 'vi'.
alter table public.exam_plans
  add column if not exists content_language text not null default 'vi'
  check (content_language in ('vi', 'en'));
