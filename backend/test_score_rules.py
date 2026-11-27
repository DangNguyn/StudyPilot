"""Ngưỡng điểm chung: chạy `python test_score_rules.py`."""
from score_rules import is_pass, level_for_score, mastery_for_score, review_tier

cases = {
    0: ("not_mastered", "intensive", "weak", False),
    49: ("not_mastered", "intensive", "weak", False),
    49.99: ("not_mastered", "intensive", "weak", False),
    50: ("needs_review", "relaxed", "mid", False),
    79: ("needs_review", "relaxed", "mid", False),
    79.99: ("needs_review", "relaxed", "mid", False),
    80: ("mastered", "none", "pass", True),
    100: ("mastered", "none", "pass", True),
}
for score, (mastery, tier, level, passed) in cases.items():
    assert mastery_for_score(score) == mastery, (score, mastery_for_score(score))
    assert review_tier(score) == tier, (score, review_tier(score))
    assert level_for_score(score) == level, (score, level_for_score(score))
    assert is_pass(score) is passed, (score, is_pass(score))
assert mastery_for_score(None) == "not_mastered"
print("test_score_rules: OK")
