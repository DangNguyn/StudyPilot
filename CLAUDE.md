# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

StudyPilot: web ôn thi cho sinh viên. Người dùng tạo kế hoạch theo ngày thi, tải giáo trình lên, AI chia thành các buổi học ngắn (tóm tắt có câu hỏi lồng), cuối buổi làm quiz, phần yếu được ôn lại theo lịch, nhắc qua email. Trả lời người dùng bằng tiếng Việt.

## Quy trình làm việc (chủ dự án đã chốt)

- Sửa thẳng trên nhánh `main` ở thư mục gốc. Không tạo nhánh, không dùng worktree, chỉ chạy một bản web.
- Thư mục gốc thường có thay đổi chưa commit (kể cả đã staged) của chủ dự án: không đụng vào. Commit kèm danh sách file: `git commit -m "..." -- <các file của mình>`; file mới phải `git add` trước.
- Với yêu cầu sửa lớn: phân tích, đưa kế hoạch (file, cách sửa, rủi ro, cách kiểm tra), dừng chờ "duyệt" rồi mới code. Việc giao diện: đưa demo để duyệt trước.
- Đặc tả chuẩn: `/Users/huy/Desktop/KHỞI NGHIỆP ĐMST/StudyPilot_Feature_Flow_Spec.md` (F1–F6) và bộ prompt sửa lỗi `StudyPilot_Fix_Prompts.md` cùng thư mục (P1–P9). Chỗ đặc tả chưa rõ thì hỏi, không tự quyết.
- Giao diện: các dòng chữ + nút phải thẳng hàng (lưới cột cố định, nút cùng bề rộng, mỗi ý thông tin một dòng). Tự chụp màn hình kiểm tra trước khi báo xong.

## Lệnh

Backend (FastAPI, Python 3.13, venv ở `backend/.venv-macos`, cấu hình `backend/.env` theo `.env.example`):

```bash
cd backend && .venv-macos/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --reload
cd backend && .venv-macos/bin/python test_session_completion.py   # Supabase giả trong bộ nhớ
cd backend && .venv-macos/bin/python test_grading.py
```

Frontend (Next.js 16, React 19, Tailwind 4):

```bash
cd frontend && npm run dev            # cổng 3000
cd frontend && ./node_modules/.bin/tsc --noEmit -p .
cd frontend && npm run lint
cd frontend && node src/lib/study-calendar.test.ts   # kiểm thử .ts chạy thẳng bằng node (đã loại khỏi tsc)
```

- Không có bộ kiểm thử chung (pytest/jest): mỗi file `test_*.py` / `*.test.ts` là script assert, chạy riêng. `test_claude.py`, `test_gemini.py`, `test_groq.py` gọi API thật.
- Lỗi `tsc` thiếu `@supabase/supabase-js` và 2 lỗi lint set-state-in-effect ở `quiz-results` là lỗi có sẵn.
- Frontend phải chạy ở `localhost:3000` (CORS backend chỉ cho origin này) và backend ở cổng 8000 (vài trang gọi cứng `http://127.0.0.1:8000`, còn lại dùng `NEXT_PUBLIC_API_URL`).
- Cấu hình chạy cho khung trình duyệt của app: `.claude/launch.json` (`backend-main`).
- `frontend/AGENTS.md`: Next.js bản này có thay đổi phá vỡ; đọc `node_modules/next/dist/docs/` trước khi dùng API Next lạ.

## Kiến trúc

**Backend** gần như nằm trọn trong `backend/main.py` (~11.000 dòng, tìm theo tên hàm/endpoint, đừng tin số dòng). Router tách riêng: `email_notifications.py` (cài đặt email + bộ lập lịch gửi thư chạy nền, khởi động ở sự kiện startup, cài đặt lưu file `notification_settings.json`), `mindmaps.py`. AI: `claude_client.py` / `document_analyzer.py` (phân tích tài liệu), `groq_client.py`, `attempt_assessment.py` (đánh giá bài làm), `practice_questions.py` (câu hỏi lồng), `grading.py`. Cơ sở dữ liệu Supabase (Postgres) qua `supabase_client.py`; repo không có file schema (chỉ `supabase_grants.sql`).

**Một người dùng cố định:** mọi truy vấn lọc theo `DEMO_USER_ID` trong `.env`; `frontend/src/lib/current-user.ts` tương ứng. Đăng nhập nhiều tài khoản là việc của P8.

**Chuỗi dữ liệu chính:** `exam_plans` → `topics` (có `hierarchy` chương > mục) → `study_sessions` (`source_chunk_ids` trỏ `material_chunks`) → `quizzes` (quiz gốc có `study_session_id`; quiz làm lại có `study_session_id = null`) → `quiz_attempts` → `quiz_assessments` → `review_plans` (`retake_quiz_id`, `status`, `review_items[].review_date` là ngày ôn người dùng chọn, `origin_session_id`).

**Quy tắc nghiệp vụ đã chốt (20/11/2026):**
- `study_sessions.status`: `scheduled` → `in_progress` (đã vào học / trả lời câu hỏi lồng, quiz mở) → `completed` chỉ khi nộp quiz gốc (`_mark_session_completed_by_quiz` trong `submit_quiz_attempt`). `POST /complete` luôn trả 400.
- Cổng sang buổi kế tiếp (`_has_passed_session_quiz`/`_is_study_session_unlocked`, dùng ở `/start`, chi tiết buổi, danh sách buổi, `practice-complete`): các ngày trước phải `completed`, không xét điểm.
- Ngưỡng: <50 yếu (bài làm lại có điền khuyết, `retake_mode_for_score`), 50–79 cần củng cố, ≥80 đạt. Ngưỡng còn rải rác nhiều nơi (P4 sẽ gom). Dưới 80%: `submit` tự tạo review plan + quiz làm lại, người dùng **bắt buộc** chọn ngày ôn (`POST /api/review-plans/{id}/review-date`, từ hôm nay đến trước ngày thi, được trùng ngày có lịch học). Quiz làm lại mở sau khi trả lời câu hỏi lồng (`practice-complete` đặt review plan `in_progress`); đạt ≥80 thì review plan `completed`.
- Câu hỏi lồng không chấm điểm.

**Frontend** (`frontend/src`, alias `@/*`): App Router, các trang là client component gọi thẳng API backend.
- `app/study-plans/[planId]`: trang kế hoạch (mục Hôm nay, Sắp tới, lịch tháng `components/study-calendar.tsx` + `lib/study-calendar.ts`, mức ưu tiên ôn `lib/review-urgency.ts`).
- `app/study-materials` (alias `app/materials`): trang tóm tắt có câu hỏi lồng; mọi nút Vào học / Vào ôn / Xem lại dẫn tới `/materials?subject=&session=&mode=learn|review|revisit` (`components/session-mode.tsx`). `app/study-sessions/[id]` chỉ còn chuyển hướng.
- `app/quiz-results/[attemptId]`: kết quả, câu sai (`components/wrong-answer-review.tsx`), hộp chọn ngày ôn bắt buộc.
- Thiết kế: token màu `--sp-*` trong `app/globals.css` (tím `--sp-purple`, hồng `--sp-pink`, đỏ `--sp-red*` cho mức khẩn/hôm nay), viền 2px + bóng lệch (`sp-card-pop`, `sp-btn-primary`), font Anton (tiêu đề), Be Vietnam Pro (chữ), Playfair italic (`sp-accent`).

## Việc còn lại theo bộ prompt

Đã xong P1 (buổi hoàn thành gắn với quiz) và phần lịch/ôn lại. Còn: P8 đăng nhập đa người dùng → P2 Email A nhắc 19h (gồm buổi ôn có `review_date` hôm nay chưa xong) → P3 Email B (bỏ qua phần yếu đã có ngày ôn sắp tới) → P4 gom ngưỡng → P5 cảnh báo thiếu thời gian → P6 trích nguồn → P7 ẩn flashcards/mindmap/Pro → P9 kiểm tra toàn luồng.
