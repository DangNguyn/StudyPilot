# Chạy: python test_session_completion.py
# Kiểm luồng P1 bằng Supabase giả trong bộ nhớ, không chạm cơ sở dữ liệu thật.
import os

os.environ["SUPABASE_URL"] = "http://localhost.test"
os.environ["SUPABASE_SECRET_KEY"] = "test-key"
os.environ["DEMO_USER_ID"] = "u1"
os.environ.setdefault("GROQ_API_KEY", "test-key")

from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException

import main


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: str(row.get(key)) == str(value))
        return self

    def in_(self, key, values):
        values = {str(v) for v in values}
        self.filters.append(lambda row: str(row.get(key)) in values)
        return self

    def order(self, *_, **__):
        return self

    def limit(self, *_):
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.op == "insert":
            row = {"started_at": "2026-11-21T01:30:00+00:00", **self.payload}  # mặc định của DB
            rows.append(row)
            return type("R", (), {"data": [dict(row)]})
        matched = [row for row in rows if all(f(row) for f in self.filters)]
        if self.op == "update":
            for row in matched:
                row.update(self.payload)
        return type("R", (), {"data": [dict(row) for row in matched]})


class FakeSupabase:
    def __init__(self, db):
        self.db = db

    def table(self, name):
        return FakeQuery(self.db, name)


S1 = "00000000-0000-0000-0000-000000000001"
S2 = "00000000-0000-0000-0000-000000000002"
Q1 = "00000000-0000-0000-0000-0000000000a1"
RETAKE = "00000000-0000-0000-0000-0000000000b1"
PLAN = "00000000-0000-0000-0000-0000000000c1"
TODAY = datetime.now(main.VIETNAM_TZ).date()
DAY1 = f"{TODAY}T03:00:00+00:00"  # 10h giờ Việt Nam, cùng ngày
DAY2 = f"{TODAY + timedelta(days=1)}T03:00:00+00:00"


def fresh_db():
    db = {
        "topics": [
            {"id": "t1", "exam_plan_id": "p1", "user_id": "u1", "is_active": True},
            {"id": "t2", "exam_plan_id": "p1", "user_id": "u1", "is_active": True},
        ],
        "study_sessions": [
            {"id": S1, "topic_id": "t1", "user_id": "u1", "status": "scheduled",
             "scheduled_start": DAY1, "started_at": None},
            {"id": S2, "topic_id": "t2", "user_id": "u1", "status": "scheduled",
             "scheduled_start": DAY2, "started_at": None},
        ],
        "quizzes": [
            {"id": Q1, "user_id": "u1", "status": "active", "study_session_id": S1,
             "title": "Quiz 1", "time_limit_minutes": 15},
            {"id": RETAKE, "user_id": "u1", "status": "active", "study_session_id": None},
        ],
        "quiz_questions": [{"id": "qq1", "quiz_id": Q1, "user_id": "u1", "status": "ready"}],
        "quiz_attempts": [],
        "exam_plans": [{"id": "p1", "user_id": "u1", "exam_date": f"{TODAY + timedelta(days=30)}"}],
        "review_plans": [{"id": PLAN, "user_id": "u1", "retake_quiz_id": RETAKE, "status": "pending",
                          "review_items": [{"origin_session_id": S1, "topic_name": "Bài 1"}]}],
    }
    main.supabase = FakeSupabase(db)
    return db


def status(db, session_id):
    return next(row for row in db["study_sessions"] if row["id"] == session_id)["status"]


def raises(status_code, fn, *args):
    try:
        fn(*args)
    except HTTPException as error:
        assert error.status_code == status_code, (error.status_code, error.detail)
        return error
    raise AssertionError(f"Không trả lỗi {status_code}")


# 1. Đọc xong (trả lời Tự kiểm tra nhanh) nhưng chưa nộp quiz: buổi chưa hoàn thành, quiz mở được
db = fresh_db()
main.complete_session_practice(UUID(S1), main.PracticeCompleteRequest(answered=3, correct=1))
assert status(db, S1) == "in_progress"
main.start_quiz(UUID(Q1))
assert len(db["quiz_attempts"]) == 1

# 2. Không có cách đánh dấu hoàn thành trực tiếp
raises(400, main.complete_study_session, UUID(S1))
assert status(db, S1) == "in_progress"

# 3. Chưa nộp quiz ngày 1: ngày 2 bị khóa (cả /start lẫn practice-complete)
raises(403, main.start_study_session, UUID(S2))
raises(403, main.complete_session_practice, UUID(S2), None)
assert status(db, S2) == "scheduled"

# 4. Nộp quiz gốc (điểm thấp cũng vậy, cổng không xét điểm): buổi hoàn thành, ngày 2 mở
assert main._mark_session_completed_by_quiz(Q1, "2026-11-21T02:00:00+00:00") == S1
assert status(db, S1) == "completed"
main.start_study_session(UUID(S2))
assert status(db, S2) == "in_progress"

# 5. Nộp bài làm lại (không gắn buổi học) không đổi trạng thái buổi nào
db = fresh_db()
assert main._mark_session_completed_by_quiz(RETAKE, "2026-11-21T02:00:00+00:00") is None
assert status(db, S1) == "scheduled"

# 6. Buổi chưa bắt đầu: quiz chưa mở
raises(403, main.start_quiz, UUID(Q1))

# 7. Cổng chỉ xét trạng thái completed, không đọc điểm
assert main._has_passed_session_quiz({"status": "completed"}) is True
assert main._has_passed_session_quiz({"status": "in_progress"}) is False

# 8. Chọn ngày ôn lại trùng ngày đã có buổi học: được chấp nhận
db = fresh_db()
week = main._session_day_context(S1)["week"]
assert any(d["date"] == TODAY.isoformat() and d["has_study"] for d in week)  # đúng là ngày có buổi học
main.set_review_date(UUID(PLAN), main.ReviewDateRequest(review_date=TODAY))
item = db["review_plans"][0]["review_items"][0]
assert item["review_date"] == TODAY.isoformat(), item
assert main._plan_review_date(db["review_plans"][0]) == TODAY.isoformat()

# 9. Được chọn ngày ở tuần sau (trước ngày thi); vẫn chặn ngày đã qua và từ ngày thi trở đi
main.set_review_date(UUID(PLAN), main.ReviewDateRequest(review_date=TODAY + timedelta(days=8)))
assert main._plan_review_date(db["review_plans"][0]) == (TODAY + timedelta(days=8)).isoformat()
if TODAY.weekday() > 0:
    raises(400, main.set_review_date, UUID(PLAN), main.ReviewDateRequest(review_date=TODAY - timedelta(days=1)))
raises(400, main.set_review_date, UUID(PLAN), main.ReviewDateRequest(review_date=TODAY + timedelta(days=30)))

print("OK: session completion")
