"""
Dọn dữ liệu mồ côi (L8). MẶC ĐỊNH CHỈ IN RA, không xoá gì.

    python cleanup_orphans.py --email ban@gmail.com           # xem trước
    python cleanup_orphans.py --email ban@gmail.com --apply   # xoá thật (chỉ khi chủ dự án đồng ý)

Gồm:
  1. Quiz không gắn buổi học nào và cũng không phải bài kiểm tra lại / bài tổng hợp của review plan nào
     (ví dụ các bài "Bài kiểm tra buổi học 1/2" cũ).
  2. Review plan "pending" không có bài kiểm tra lại và không gắn buổi học gốc.
  3. Lượt làm "in_progress" của quiz đã có lượt nộp (bị bỏ dở).
"""

import argparse
import sys

from supabase_client import supabase


def _user_id(email: str | None, user_id: str | None) -> str:
    if user_id:
        return user_id
    users = supabase.auth.admin.list_users()
    users = getattr(users, "users", users)
    for user in users:
        if str(getattr(user, "email", "") or "").lower() == str(email or "").lower():
            return str(user.id)
    sys.exit(f"Không tìm thấy tài khoản {email}")


def _rows(table, columns, **filters):
    query = supabase.table(table).select(columns)
    for key, value in filters.items():
        query = query.eq(key, value)
    return query.execute().data or []


def find_orphans(user_id: str) -> dict:
    plans = _rows("review_plans", "*", user_id=user_id)
    linked_quiz_ids = {
        str(plan.get(key))
        for plan in plans
        for key in ("retake_quiz_id", "final_quiz_id")
        if plan.get(key)
    }
    quizzes = _rows("quizzes", "id, title, study_session_id, status", user_id=user_id)
    orphan_quizzes = [
        quiz for quiz in quizzes
        if not quiz.get("study_session_id") and str(quiz["id"]) not in linked_quiz_ids
    ]

    orphan_plans = []
    for plan in plans:
        has_origin = any(
            isinstance(item, dict) and item.get("origin_session_id")
            for item in plan.get("review_items") or []
        )
        if plan.get("status") == "pending" and not plan.get("retake_quiz_id") and not has_origin:
            orphan_plans.append(plan)

    attempts = _rows("quiz_attempts", "id, quiz_id, status, started_at", user_id=user_id)
    submitted_quizzes = {str(item["quiz_id"]) for item in attempts if item.get("status") == "submitted"}
    stale_attempts = [
        item for item in attempts
        if item.get("status") == "in_progress" and str(item["quiz_id"]) in submitted_quizzes
    ]
    return {"quizzes": orphan_quizzes, "review_plans": orphan_plans, "attempts": stale_attempts}


def _delete(table, column, values):
    values = [str(value) for value in values]
    for start in range(0, len(values), 100):
        supabase.table(table).delete().in_(column, values[start:start + 100]).execute()


def apply(found: dict) -> None:
    attempt_ids = [item["id"] for item in found["attempts"]]
    quiz_ids = [item["id"] for item in found["quizzes"]]
    if quiz_ids:
        quiz_attempt_ids = [
            row["id"]
            for start in range(0, len(quiz_ids), 100)
            for row in (
                supabase.table("quiz_attempts").select("id").in_("quiz_id", [str(q) for q in quiz_ids[start:start + 100]]).execute()
            ).data or []
        ]
        attempt_ids = list({*map(str, attempt_ids), *map(str, quiz_attempt_ids)})
    if attempt_ids:
        _delete("quiz_answers", "attempt_id", attempt_ids)
        try:
            _delete("quiz_assessments", "quiz_attempt_id", attempt_ids)
        except Exception as error:
            print("  (bỏ qua quiz_assessments:", str(error)[:120], ")")
        _delete("quiz_attempts", "id", attempt_ids)
    if quiz_ids:
        _delete("quiz_questions", "quiz_id", quiz_ids)
        _delete("quizzes", "id", quiz_ids)
    if found["review_plans"]:
        _delete("review_plans", "id", [item["id"] for item in found["review_plans"]])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email")
    parser.add_argument("--user-id")
    parser.add_argument("--apply", action="store_true", help="Xoá thật (mặc định chỉ in ra)")
    args = parser.parse_args()
    if not args.email and not args.user_id:
        parser.error("Cần --email hoặc --user-id")

    user_id = _user_id(args.email, args.user_id)
    found = find_orphans(user_id)
    print(f"Tài khoản {args.email or user_id}:")
    print(f"  1. Quiz mồ côi: {len(found['quizzes'])}")
    for quiz in found["quizzes"]:
        print(f"     - {quiz.get('title')} ({quiz['id']})")
    print(f"  2. Review plan pending không gắn bài: {len(found['review_plans'])}")
    print(f"  3. Lượt làm bỏ dở của quiz đã nộp: {len(found['attempts'])}")

    if not args.apply:
        print("\nChỉ xem trước. Thêm --apply để xoá thật.")
        return
    apply(found)
    print("\nĐã xoá xong.")


if __name__ == "__main__":
    main()
