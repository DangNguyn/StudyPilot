# Chạy: python test_grading.py
import unicodedata

from grading import grade_answer

assert grade_answer("fill_blank", None, "Hà Nội") is False
assert grade_answer("fill_blank", "  hà   NỘI. ", "Hà Nội") is True
assert grade_answer("fill_blank", unicodedata.normalize("NFD", "Hà Nội"), "Hà Nội") is True
assert grade_answer("fill_blank", "Hải Phòng", "Hà Nội") is False
assert grade_answer("fill_blank", "", "") is False
assert grade_answer("fill_blank", "hcm", ["TP.HCM", "HCM"]) is True
assert grade_answer("multiple_choice", ["B", "A"], ["A", "B"]) is True
assert grade_answer("multiple_choice", ["A"], ["A", "B"]) is False
assert grade_answer("single_choice", "A", "A") is True
assert grade_answer("single_choice", "B", "A") is False

print("OK: grading")
