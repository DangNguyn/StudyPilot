# Sửa dữ liệu cũ cho P1: buổi đã nộp bài kiểm tra gốc nhưng chưa "completed".
# Mặc định chỉ in danh sách, không ghi. Ghi thật: python backfill_session_completion.py --apply
# Không xóa gì; chỉ đặt status = completed, completed_at = lúc nộp bài sớm nhất.
import os
import sys

from supabase_client import supabase

uid = os.getenv("DEMO_USER_ID")
apply = "--apply" in sys.argv

sessions = {
    row["id"]: row
    for row in (
        supabase.table("study_sessions").select("id, status, started_at")
        .eq("user_id", uid).execute()
    ).data or []
}
quizzes = [
    row for row in (
        supabase.table("quizzes").select("id, study_session_id")
        .eq("user_id", uid).execute()
    ).data or []
    if row.get("study_session_id")
]
attempts = (
    supabase.table("quiz_attempts").select("quiz_id, submitted_at")
    .eq("user_id", uid).eq("status", "submitted").execute()
).data or []

first_submit = {}
for attempt in attempts:
    when = attempt.get("submitted_at")
    if when and (attempt["quiz_id"] not in first_submit or when < first_submit[attempt["quiz_id"]]):
        first_submit[attempt["quiz_id"]] = when

todo = []
for quiz in quizzes:
    session = sessions.get(quiz["study_session_id"])
    if session and session["status"] != "completed" and quiz["id"] in first_submit:
        todo.append((session, first_submit[quiz["id"]]))

print(f"Cần đặt completed: {len(todo)} buổi")
for session, when in todo:
    print(f"  {session['id']}  status={session['status']}  nộp lúc {when}")
    if apply:
        update = {"status": "completed", "completed_at": when, "updated_at": when}
        if not session.get("started_at"):
            update["started_at"] = when
        supabase.table("study_sessions").update(update).eq("id", session["id"]).eq("user_id", uid).execute()

print("Đã ghi." if apply else "Chạy thử, chưa ghi. Thêm --apply để ghi.")
