"""
Ngưỡng điểm dùng chung cho toàn hệ thống (đặc tả F6, chốt 26/11/2026).

    < 50      yếu            (not_mastered)  → bài kiểm tra lại có điền khuyết
    50 – 79   cần củng cố    (needs_review)  → bài kiểm tra lại 100% trắc nghiệm
    >= 80     đạt            (mastered)

Điểm đúng 50% thuộc nhóm giữa, đúng 80% là ĐẠT.
Mọi chỗ so sánh điểm trong backend phải dùng các hàm ở đây.
Frontend có bản tương ứng ở frontend/src/lib/score-rules.ts.
"""

WEAK_BELOW = 50
PASS_SCORE = 80


def _score(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def is_pass(score) -> bool:
    return _score(score) >= PASS_SCORE


def is_weak(score) -> bool:
    return _score(score) < WEAK_BELOW


def mastery_for_score(score) -> str:
    """mastered / needs_review / not_mastered (cột quiz_assessments.mastery_level)."""
    value = _score(score)
    if value >= PASS_SCORE:
        return "mastered"
    if value >= WEAK_BELOW:
        return "needs_review"
    return "not_mastered"


def review_tier(score) -> str:
    """intensive (<50) / relaxed (50-79) / none (>=80): mức ôn lại."""
    value = _score(score)
    if value < WEAK_BELOW:
        return "intensive"
    if value < PASS_SCORE:
        return "relaxed"
    return "none"


def level_for_score(score) -> str:
    """weak / mid / pass: nhãn hiển thị (Yếu / Cần củng cố / Đạt)."""
    return {"not_mastered": "weak", "needs_review": "mid", "mastered": "pass"}[mastery_for_score(score)]
