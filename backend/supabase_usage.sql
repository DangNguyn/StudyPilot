-- =====================================================================
-- Mỗi tài khoản một bộ dữ liệu + thống kê chi phí AI theo người dùng
-- Chạy toàn bộ đoạn dưới đây 1 lần trong Supabase → SQL Editor.
-- =====================================================================

-- 1. Nhật ký mỗi lần gọi AI / đọc tài liệu (backend ghi vào, xem ai_usage.py)
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  feature text,            -- phan_tich_tai_lieu, quiz, flashcard, so_do_tu_duy, danh_gia_bai_lam...
  provider text,           -- anthropic, groq, document (= lần đọc tài liệu)
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,   -- ước tính theo bảng giá
  pages integer,           -- số trang (chỉ có ở dòng provider = 'document')
  file_name text,
  material_id uuid,
  request_path text
);
create index if not exists ai_usage_user_idx on public.ai_usage(user_id, created_at desc);
create index if not exists ai_usage_created_idx on public.ai_usage(created_at desc);

-- Chỉ backend (service_role) được đọc/ghi; trình duyệt không đọc được bảng này
alter table public.ai_usage enable row level security;
grant select, insert on table public.ai_usage to service_role;

-- 2. Tổng hợp theo người dùng: mỗi người tải bao nhiêu tài liệu / trang, tốn bao nhiêu token & tiền
create or replace view public.admin_usage_by_user
with (security_invoker = true) as
select
  u.id as user_id,
  u.email,
  u.created_at as ngay_dang_ky,
  coalesce(count(a.id) filter (where a.provider = 'document'), 0) as so_tai_lieu,
  coalesce(sum(a.pages), 0) as tong_so_trang,
  coalesce(count(a.id) filter (where a.provider <> 'document'), 0) as so_lan_goi_ai,
  coalesce(sum(a.input_tokens), 0) as token_dau_vao,
  coalesce(sum(a.output_tokens), 0) as token_dau_ra,
  round(coalesce(sum(a.cost_usd), 0), 4) as chi_phi_usd,
  round(coalesce(sum(a.cost_usd) filter (where a.created_at >= date_trunc('month', now())), 0), 4) as chi_phi_thang_nay_usd,
  max(a.created_at) as lan_dung_gan_nhat
from auth.users u
left join public.ai_usage a on a.user_id = u.id
group by u.id, u.email, u.created_at
order by chi_phi_usd desc;

-- 3. Theo người dùng + chức năng (biết tiền tốn vào việc gì)
create or replace view public.admin_usage_by_feature
with (security_invoker = true) as
select
  coalesce(a.user_email, a.user_id::text) as nguoi_dung,
  a.feature as chuc_nang,
  a.model,
  count(*) as so_lan_goi,
  sum(a.input_tokens) as token_dau_vao,
  sum(a.output_tokens) as token_dau_ra,
  round(sum(a.cost_usd), 4) as chi_phi_usd
from public.ai_usage a
where a.provider <> 'document'
group by 1, 2, 3
order by chi_phi_usd desc;

-- 4. Theo từng tài liệu: ai tải, bao nhiêu trang, AI tốn bao nhiêu để xử lý tài liệu đó
create or replace view public.admin_usage_by_document
with (security_invoker = true) as
select
  coalesce(max(a.user_email), max(a.user_id::text)) as nguoi_dung,
  coalesce(a.material_id::text, a.file_name) as tai_lieu_id,
  max(a.file_name) as ten_file,
  max(a.pages) as so_trang,
  sum(a.input_tokens) as token_dau_vao,
  sum(a.output_tokens) as token_dau_ra,
  round(sum(a.cost_usd), 4) as chi_phi_usd,
  min(a.created_at) as thoi_gian
from public.ai_usage a
where a.material_id is not null or a.file_name is not null
group by a.user_id, coalesce(a.material_id::text, a.file_name)
order by thoi_gian desc;

-- 5. Theo ngày (tổng cả hệ thống)
create or replace view public.admin_usage_by_day
with (security_invoker = true) as
select
  (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date as ngay,
  count(distinct a.user_id) as so_nguoi_dung,
  count(*) filter (where a.provider = 'document') as so_tai_lieu,
  coalesce(sum(a.pages), 0) as tong_so_trang,
  sum(a.input_tokens) as token_dau_vao,
  sum(a.output_tokens) as token_dau_ra,
  round(sum(a.cost_usd), 4) as chi_phi_usd
from public.ai_usage a
group by 1
order by 1 desc;

-- Các view trên chỉ dành cho bạn xem trong Supabase, không mở cho trình duyệt
revoke all on public.admin_usage_by_user, public.admin_usage_by_feature,
  public.admin_usage_by_document, public.admin_usage_by_day from anon, authenticated;

-- 6. (Tuỳ chọn) Danh sách môn học / kế hoạch kèm email chủ sở hữu, để tra dữ liệu từng người
create or replace view public.admin_exam_plans
with (security_invoker = true) as
select u.email, p.*
from public.exam_plans p
left join auth.users u on u.id = p.user_id;
revoke all on public.admin_exam_plans from anon, authenticated;
