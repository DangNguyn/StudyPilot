"""
Flashcard do Groq (miễn phí) tạo trước; hàm ở đây kiểm tra nhanh, không gọi AI.
Không đạt thì nơi gọi chuyển sang Claude Haiku tạo lại.
"""

import json
import re

VIETNAMESE_LETTERS = re.compile(
    r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]"
)


def parse_cards_json(text: str) -> list:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines)
    data = json.loads(cleaned)
    cards = data.get("cards") if isinstance(data, dict) else None
    return cards if isinstance(cards, list) else []


def cards_look_ok(cards: list, wanted: int, language: str = "vi") -> bool:
    """Đủ ~80% số thẻ, không trùng mặt trước, mặt sau ngắn gọn, đúng ngôn ngữ."""
    good = [
        card for card in cards
        if isinstance(card, dict) and str(card.get("front") or "").strip() and str(card.get("back") or "").strip()
    ]
    if len(good) < max(1, round(wanted * 0.8)):
        return False
    fronts = [str(card["front"]).strip().casefold() for card in good]
    if len(set(fronts)) < len(fronts):
        return False
    for card in good:
        back_lines = [line for line in str(card["back"]).splitlines() if line.strip()]
        if len(back_lines) > 3 or any(len(line.split()) > 30 for line in back_lines):
            return False
    if language == "vi":
        vietnamese = sum(1 for card in good if VIETNAMESE_LETTERS.search(f"{card['front']} {card['back']}".lower()))
        if vietnamese < 0.8 * len(good):
            return False
    return True
