# Chạy: .venv-macos/bin/python test_fill_blank.py (chấm điền khuyết tiếng Việt/Anh)
from main import is_fill_blank_correct as ok

assert ok("công việc văn phòng", ["công việc văn phòng", "văn phòng", "office work"]) is True
assert ok("cong viec van phong", ["công việc văn phòng"]) is True, "gõ không dấu"
assert ok("văn phòng", ["công việc văn phòng", "văn phòng"]) is True, "cách nói ngắn"
assert ok("Office Work.", ["công việc văn phòng", "office work"]) is True, "thuật ngữ gốc"
assert ok("T-H-I-O", ["THIO"]) is True, "gạch nối"
assert ok("công việc văn phòg", ["công việc văn phòng"]) is True, "gõ nhầm 1 ký tự"
assert ok("cong viec van phng", ["công việc văn phòng"]) is True
assert ok("kinh tế vi mô", ["kinh tế vĩ mô"]) is False, "khác dấu thanh là khác từ"
assert ok("kinh te vi mo", ["kinh tế vĩ mô"]) is True, "không dấu thì bỏ qua dấu"
assert ok("orgware", ["Inforware"]) is False
assert ok("ac", ["ab"]) is False, "đáp án ngắn phải khớp"
assert ok("", [""]) is False
assert ok("hcm", ["TP.HCM / HCM"]) is True

print("OK: fill_blank")

from main import trim_blank_overlap as trim
assert trim("Công nghệ ___ là loại giảm tác động môi trường.", "công nghệ xanh") == "xanh"
assert trim("Một hệ thống ___ có tổ chức.", "hệ thống thông tin") == "thông tin"
assert trim("Công nghệ có một _____ vòng đời.", "vòng đời") == "vòng đời", "không cắt hết đáp án"
assert trim("Thủ đô là ____.", "Hà Nội") == "Hà Nội"
print("OK: trim_blank_overlap")
