# Chạy: .venv-macos/bin/python test_flashcard_quality.py
from flashcard_quality import cards_look_ok, parse_cards_json

vi = [{"front": f"Khái niệm {i}", "back": "- Định nghĩa ngắn gọn"} for i in range(10)]
assert cards_look_ok(vi, 10, "vi") is True
assert cards_look_ok(vi[:5], 10, "vi") is False, "thiếu thẻ"
en = [{"front": f"Concept {i}", "back": "- Short definition"} for i in range(10)]
assert cards_look_ok(en, 10, "vi") is False, "sai ngôn ngữ"
assert cards_look_ok(en, 10, "en") is True
dup = vi[:9] + [{"front": "Khái niệm 0", "back": "- Trùng"}]
assert cards_look_ok(dup, 10, "vi") is False, "trùng mặt trước"
long_back = vi[:9] + [{"front": "Dài", "back": "- " + "từ " * 40}]
assert cards_look_ok(long_back, 10, "vi") is False, "mặt sau quá dài"
assert parse_cards_json('```json\n{"cards": [{"front": "a", "back": "b"}]}\n```') == [{"front": "a", "back": "b"}]
print("OK: flashcard_quality")
