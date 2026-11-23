# Chạy: python test_grading.py (kiểm tra hàm chấm điền khuyết đang dùng thật trong main.py)
import unicodedata

from main import is_fill_blank_correct as ok

assert ok(None, ["Hà Nội"]) is False
assert ok("  hà   NỘI. ", ["Hà Nội"]) is True
assert ok(unicodedata.normalize("NFD", "Hà Nội"), ["Hà Nội"]) is True
assert ok("ha noi", ["Hà Nội"]) is True
assert ok("Hải Phòng", ["Hà Nội"]) is False
assert ok("", [""]) is False
assert ok("hcm", ["TP.HCM / HCM"]) is True

print("OK: grading")
