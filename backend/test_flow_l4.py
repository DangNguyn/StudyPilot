# Chạy: python test_flow_l4.py
# Kiểm luồng L4 (26/11/2026) bằng Supabase giả trong bộ nhớ:
#   quiz gốc trượt → bài kiểm tra lại trượt → khoá kế hoạch + bài tổng hợp 20 câu
#   → ôn lại → làm bài tổng hợp → hoàn thành (+ "cần chú ý" nếu dưới 80%) → mở khoá.
import os

os.environ["SUPABASE_URL"] = "http://localhost.test"
os.environ["SUPABASE_SECRET_KEY"] = "test-key"
os.environ.setdefault("GROQ_API_KEY", "test-key")

import copy
import uuid
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import HTTPException

import main
from auth import _current_user

_current_user.set({"id": "u1", "email": "u1@test"})

# AI không chạy trong test: nhận xét dùng câu mẫu
main.generate_text = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("no AI in test"))
main.generate_light_text = main.generate_text


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], "select", None
        self._limit = None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: str(row.get(key)) == str(value))
        return self

    def neq(self, key, value):
        self.filters.append(lambda row: str(row.get(key)) != str(value))
        return self

    def in_(self, key, values):
        values = {str(v) for v in values}
        self.filters.append(lambda row: str(row.get(key)) in values)
        return self

    def is_(self, key, value):
        self.filters.append(lambda row: row.get(key) is None)
        return self

    @property
    def not_(self):
        query = self

        class _Not:
            def is_(self, key, _value):
                query.filters.append(lambda row: row.get(key) is not None)
                return query

        return _Not()

    def order(self, key=None, desc=False, **_k):
        self._order = (key, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def delete(self):
        self.op = "delete"
        return self

    def execute(self):
        rows = self.db.setdefault(self.table, [])
        if self.op == "insert":
            items = self.payload if isinstance(self.payload, list) else [self.payload]
            out = []
            for item in items:
                row = {"id": str(uuid.uuid4()), "started_at": "2026-11-21T01:30:00+00:00",
                       "created_at": datetime.now().isoformat(), **item}
                rows.append(row)
                out.append(dict(row))
            return type("R", (), {"data": out})
        matched = [row for row in rows if all(f(row) for f in self.filters)]
        if self.op == "update":
            for row in matched:
                row.update(self.payload)
        if self.op == "delete":
            self.db[self.table] = [row for row in rows if row not in matched]
        order = getattr(self, "_order", None)
        if order and order[0]:
            matched = sorted(matched, key=lambda row: str(row.get(order[0]) or ""), reverse=order[1])
        if self._limit:
            matched = matched[: self._limit]
        return type("R", (), {"data": [copy.deepcopy(row) for row in matched]})


class FakeSupabase:
    def __init__(self, db):
        self.db = db

    def table(self, name):
        return FakeQuery(self.db, name)


S1, S2 = "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"
Q1, RETAKE, PLAN = (
    "00000000-0000-0000-0000-0000000000a1",
    "00000000-0000-0000-0000-0000000000b1",
    "00000000-0000-0000-0000-0000000000c1",
)
TODAY = datetime.now(main.VIETNAM_TZ).date()
DAY1 = f"{TODAY}T03:00:00+00:00"
DAY2 = f"{TODAY + timedelta(days=1)}T03:00:00+00:00"


def questions(quiz_id, prefix):
    return [
        {"id": f"{prefix}{i}", "quiz_id": quiz_id, "user_id": "u1", "status": "ready",
         "question_text": f"{prefix} câu {i}", "question_type": "single_choice",
         "options": [{"key": "A", "text": "đúng"}, {"key": "B", "text": "sai"}],
         "correct_answer": "A", "explanation": "", "points": 1, "question_order": i,
         "source_chunk_id": None, "source_material_id": None}
        for i in range(1, 11)
    ]


def fresh_db():
    db = {
        "topics": [
            {"id": "t1", "exam_plan_id": "p1", "user_id": "u1", "is_active": True, "name": "Bài 1"},
            {"id": "t2", "exam_plan_id": "p1", "user_id": "u1", "is_active": True, "name": "Bài 2"},
        ],
        "study_sessions": [
            {"id": S1, "topic_id": "t1", "user_id": "u1", "status": "completed", "scheduled_start": DAY1},
            {"id": S2, "topic_id": "t2", "user_id": "u1", "status": "scheduled", "scheduled_start": DAY2},
        ],
        "quizzes": [
            {"id": Q1, "user_id": "u1", "status": "active", "study_session_id": S1, "exam_plan_id": "p1",
             "title": "Bài kiểm tra · Buổi 1", "time_limit_minutes": 15},
            {"id": RETAKE, "user_id": "u1", "status": "active", "study_session_id": None, "exam_plan_id": "p1",
             "title": "Kiểm tra lại · Buổi 1", "time_limit_minutes": 15},
        ],
        "quiz_questions": questions(Q1, "o") + questions(RETAKE, "r"),
        "quiz_attempts": [{"id": "att-orig", "quiz_id": Q1, "user_id": "u1", "status": "submitted",
                           "score": 60, "submitted_at": "2026-11-20T01:00:00+00:00"}],
        "quiz_answers": [],
        "quiz_assessments": [{"id": "as1", "quiz_id": Q1, "quiz_attempt_id": "att-orig", "user_id": "u1"}],
        "exam_plans": [{"id": "p1", "user_id": "u1", "exam_date": f"{TODAY + timedelta(days=30)}"}],
        "review_plans": [{"id": PLAN, "user_id": "u1", "retake_quiz_id": RETAKE, "assessment_id": "as1",
                          "status": "pending", "review_items": [
                              {"origin_session_id": S1, "origin_quiz_id": Q1, "topic_name": "Bài 1",
                               "review_date": str(TODAY + timedelta(days=1))}]}],
    }
    main.supabase = FakeSupabase(db)
    return db


def raises(status_code, fn, *args):
    try:
        fn(*args)
    except HTTPException as error:
        assert error.status_code == status_code, (error.status_code, error.detail)
        return error
    raise AssertionError(f"Không trả lỗi {status_code}")


def take_quiz(db, quiz_id, correct):
    attempt_id = main.start_quiz(UUID(quiz_id))["attempt_id"]
    qs = sorted([q for q in db["quiz_questions"] if q["quiz_id"] == quiz_id], key=lambda q: q["question_order"])
    for index, question in enumerate(qs):
        db["quiz_answers"].append({
            "id": str(uuid.uuid4()), "attempt_id": attempt_id, "question_id": question["id"], "user_id": "u1",
            "selected_answer": "A" if index < correct else "B",
        })
    return main.submit_quiz_attempt(UUID(attempt_id))


def plan(db):
    return next(row for row in db["review_plans"] if row["id"] == PLAN)


def practice(session_id):
    return main.complete_session_practice(UUID(session_id), main.PracticeCompleteRequest(answered=3, correct=2))


# ---- A. Bài ôn trượt 50% → khoá + bài tổng hợp; tổng hợp 70% → hoàn thành + cần chú ý ----
db = fresh_db()
# Ôn lại xong (câu hỏi lồng) → mở bài kiểm tra lại, làm ngay được (không cần đợi ngày ôn)
assert RETAKE in practice(S1)["unlocked_retake_quiz_ids"]
assert plan(db)["status"] == "in_progress"

result = take_quiz(db, RETAKE, correct=5)
assert result["score"] == 50 and result["final_required"] is True, result
final_id = plan(db)["final_quiz_id"]
assert plan(db)["status"] == "final_required" and final_id
final_questions = [q for q in db["quiz_questions"] if q["quiz_id"] == final_id]
assert len(final_questions) == 20
texts = {q["question_text"] for q in final_questions}
assert texts == {f"o câu {i}" for i in range(1, 11)} | {f"r câu {i}" for i in range(1, 11)}
assert sorted(q["question_order"] for q in final_questions) == list(range(1, 21))
final_quiz = next(q for q in db["quizzes"] if q["id"] == final_id)
assert final_quiz["title"] == "Bài tổng hợp · Buổi 1" and final_quiz["study_session_id"] is None

# Khoá toàn bộ kế hoạch: buổi khác không vào được
raises(403, main.start_study_session, UUID(S2))
raises(403, main.complete_session_practice, UUID(S2), None)
lock = main._final_lock_for_plan("p1")
assert lock and lock["review_plan_id"] == PLAN and lock["origin_session_id"] == S1 and lock["session_order"] == 1
# Bài tổng hợp chưa mở khi chưa ôn lại
raises(403, main.start_quiz, UUID(final_id))
listed = {q["id"]: q for q in main.get_quizzes(None)["data"]}
assert listed[final_id]["is_unlocked"] is False and listed[final_id]["lock_reason"]
# Ôn lại buổi 1 (được phép dù đang khoá) → mở bài tổng hợp
assert final_id in practice(S1)["unlocked_retake_quiz_ids"]
listed = {q["id"]: q for q in main.get_quizzes(None)["data"]}
assert listed[final_id]["is_unlocked"] is True, listed[final_id]
result = take_quiz(db, final_id, correct=14)
assert result["score"] == 70
assert plan(db)["status"] == "completed" and plan(db)["needs_attention"] is True
# Mở khoá: học tiếp buổi 2 được
assert main._final_lock_for_plan("p1") is None
main.start_study_session(UUID(S2))
# Bài tổng hợp chỉ làm 1 lần
raises(403, main.start_quiz, UUID(final_id))
# Danh sách quiz nhận diện bài tổng hợp + cờ cần chú ý
listed = {q["id"]: q for q in main.get_quizzes(None)["data"]}
assert listed[final_id]["is_final"] is True and listed[final_id]["needs_attention"] is True
assert listed[final_id]["study_session_id"] == S1
# Trang kết quả của bài tổng hợp: không tự tạo bài kiểm tra lại cho nó
final_attempt = next(a for a in db["quiz_attempts"] if a["quiz_id"] == final_id)
plans_before = len(db["review_plans"])
assert main.ensure_retake_for_attempt(UUID(final_attempt["id"]))["retake"] is None
assert len(db["review_plans"]) == plans_before
context = main.get_quiz_attempt_result(UUID(final_attempt["id"]))["review_context"]
assert context and context["attempt_kind"] == "final" and context["study_session_id"] == S1, context
assert context["retake"]["needs_attention"] is True
retake_attempt = next(a for a in db["quiz_attempts"] if a["quiz_id"] == RETAKE)
assert main.get_quiz_attempt_result(UUID(retake_attempt["id"]))["review_context"]["attempt_kind"] == "retake"
print("A. ôn trượt → tổng hợp 70% → hoàn thành + cần chú ý: OK")

# ---- B. Bài tổng hợp 85% → hoàn thành, không gắn cờ ----
db = fresh_db()
practice(S1)
take_quiz(db, RETAKE, correct=3)
final_id = plan(db)["final_quiz_id"]
practice(S1)
result = take_quiz(db, final_id, correct=17)
assert result["score"] == 85 and plan(db)["status"] == "completed" and plan(db)["needs_attention"] is False
print("B. tổng hợp 85% → hoàn thành, không cờ: OK")

# ---- C. Bài kiểm tra lại đúng 80% → đạt, không có bài tổng hợp ----
db = fresh_db()
practice(S1)
result = take_quiz(db, RETAKE, correct=8)
assert result["score"] == 80 and result["requires_retake"] is False and result["final_required"] is False
assert plan(db)["status"] == "completed" and not plan(db).get("final_quiz_id")
# Buổi ôn đã xong thì vào lại không mở lại bài kiểm tra lại
assert RETAKE not in practice(S1)["unlocked_retake_quiz_ids"] and plan(db)["status"] == "completed"
print("C. kiểm tra lại 80% → đạt: OK")

# ---- D. Kế hoạch khác không bị khoá ----
db = fresh_db()
db["topics"].append({"id": "t9", "exam_plan_id": "p2", "user_id": "u1", "is_active": True})
db["study_sessions"].append({"id": "s9", "topic_id": "t9", "user_id": "u1", "status": "scheduled", "scheduled_start": DAY1})
practice(S1)
take_quiz(db, RETAKE, correct=2)
assert main._final_lock_for_plan("p2") is None
main.start_study_session("s9")
print("D. môn khác không bị khoá: OK")

# ---- E. L1: buổi thiếu quiz → ensure-quiz tạo bù đúng tên "Bài kiểm tra · Buổi N", chỉ 1 lần ----
db = fresh_db()
db["study_sessions"][1]["source_chunk_ids"] = ["c1"]
db["material_chunks"] = [{"id": "c1", "material_id": "00000000-0000-0000-0000-0000000000d1"}]
calls = []


def fake_generate(request):
    calls.append(request)
    quiz_id = str(uuid.uuid4())
    db["quizzes"].append({"id": quiz_id, "user_id": "u1", "status": "active",
                          "study_session_id": str(request.study_session_id), "title": request.title})
    db["quiz_questions"].append({"id": "x", "quiz_id": quiz_id, "user_id": "u1", "status": "ready"})
    return {"quiz_id": quiz_id}


real_generate = main.generate_quiz
main.generate_quiz = fake_generate
first = main.ensure_session_quiz(UUID(S2))
second = main.ensure_session_quiz(UUID(S2))
main.generate_quiz = real_generate
assert first["created"] is True and second["created"] is False and first["quiz_id"] == second["quiz_id"]
assert len(calls) == 1 and calls[0].title == "Bài kiểm tra · Buổi 2"
assert main.ensure_session_quiz(UUID(S1))["quiz_id"] == Q1  # buổi đã có quiz gốc
print("E. ensure-quiz tạo bù 1 lần: OK")

# ---- F. L6: Claude lỗi → nhận xét bằng Groq, điểm cao vẫn có gợi ý buổi kế tiếp ----
import attempt_assessment as aa
import groq_client
aa.is_claude_configured = lambda: False
groq_client.generate_text = lambda prompt: (
    '{"verdict":"Tốt","summary":"Làm tốt.","strengths":["a"],"weak_areas":[],'
    '"study_plan":{"minutes_per_day":10,"days":1,"advice":"x"},"recommendations":[],"mistakes":[]}'
)
assessment = aa.build_attempt_assessment({
    "total_questions": 10, "correct_count": 9, "results": [],
    "assessment_extras": {"kind": "original", "next_session": {"topic_name": "Bài 2", "date": "27/11"}},
})
assert assessment["ai_model"] == "Groq" and assessment["mastery_level"] == "mastered"
texts = [item for item in assessment["recommendations"] if isinstance(item, str)]
assert texts and "Bài 2" in texts[0], texts
print("F. Groq dự phòng + gợi ý buổi kế tiếp: OK")

print("OK: flow L4")
