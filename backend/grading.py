import re
import unicodedata


def normalize_answer(value) -> str:
    # NFC: bàn phím macOS có thể gửi dấu tiếng Việt dạng tách rời (NFD).
    text = unicodedata.normalize("NFC", str(value or "")).casefold()
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip(" .,;:!?\"'“”‘’")


def grade_answer(question_type: str, selected_answer, correct_answer) -> bool:
    if selected_answer is None:
        return False

    if question_type == "fill_blank":
        expected = correct_answer if isinstance(correct_answer, list) else [correct_answer]
        selected = normalize_answer(selected_answer)
        return bool(selected) and any(
            selected == normalize_answer(item)
            for item in expected
            if item is not None
        )

    if question_type == "multiple_choice":
        return (
            isinstance(selected_answer, list)
            and isinstance(correct_answer, list)
            and set(selected_answer) == set(correct_answer)
        )

    return selected_answer == correct_answer
