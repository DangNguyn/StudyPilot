"""
Câu hỏi ôn nhanh (practice) hiển thị cạnh nội dung tóm tắt ở trang Tài liệu học tập.

- Mỗi mục lớn (content_sections[i]) có một nhóm 3 câu hỏi trắc nghiệm, lưu ngay trong
  mục đó với khóa "practice_pool" để lần sau không phải gọi Claude lại. Giao diện
  chọn ngẫu nhiên từ nhóm này nên mỗi lần tải lại trang sẽ ra câu khác.
- Hoàn toàn tách biệt với bài kiểm tra (quizzes): không ghi vào bảng quizzes/questions,
  không tính điểm, không ảnh hưởng mở khóa buổi học.
- Mỗi câu có "evidence": một đoạn trích NGUYÊN VĂN trong nội dung của mục đó, để giao
  diện cuộn tới và tô sáng đúng chỗ giải thích khi người học trả lời sai.
"""

from __future__ import annotations

from content_language import language_rule, plan_language
from supabase_client import supabase
import json
import re
from concurrent.futures import ThreadPoolExecutor

from claude_client import generate_structured, is_claude_configured

MAX_SECTIONS = 14
QUESTIONS_PER_SECTION = 3
SECTIONS_PER_CALL = 5
PRACTICE_KEY = "practice_pool"

PRACTICE_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "section_index": {"type": "integer"},
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "correct_index": {"type": "integer"},
                    "explanation": {"type": "string"},
                    "evidence": {"type": "string"},
                },
                "required": [
                    "section_index",
                    "question",
                    "options",
                    "correct_index",
                    "explanation",
                    "evidence",
                ],
            },
        }
    },
    "required": ["questions"],
}

PRACTICE_SYSTEM = """Bạn là trợ giảng giúp sinh viên ÔN NHANH ngay khi đang đọc tóm tắt bài học.
Với MỖI mục được cung cấp, viết đúng 3 câu hỏi trắc nghiệm 4 lựa chọn, mỗi câu hỏi
một ý KHÁC NHAU của mục (không hỏi lại cùng một ý bằng cách diễn đạt khác).

YÊU CẦU:
1. Chỉ dựa vào nội dung của chính mục đó. Không dùng kiến thức bên ngoài.
2. Hỏi ý quan trọng nhất của mục (khái niệm, phân loại, công thức, quan hệ nhân quả),
   không hỏi chi tiết vụn vặt, không hỏi kiểu "mục này nói về gì".
3. 4 lựa chọn ngắn gọn, cùng kiểu, chỉ 1 đáp án đúng; các phương án sai phải hợp lý
   (lỗi hiểu nhầm thường gặp), không dùng "Tất cả đều đúng/sai".
4. correct_index là vị trí đáp án đúng (0-3); phân bố vị trí đáp án đúng đa dạng.
5. explanation: 1-2 câu giải thích VÌ SAO đáp án đúng, viết cho người vừa trả lời sai.
6. evidence: chép NGUYÊN VĂN một cụm 4-20 từ có trong nội dung của mục, là chỗ chứa
   câu trả lời (để ứng dụng tô sáng). Không diễn đạt lại.
7. Câu hỏi, lựa chọn và giải thích viết theo NGÔN NGỮ BẮT BUỘC ghi ở đầu yêu cầu;
   riêng evidence vẫn chép nguyên văn từ nội dung của mục.
8. Không đánh số đề mục trong câu hỏi."""


def _section_text(section: dict, depth: int = 0) -> str:
    lines: list[str] = []
    heading = str(section.get("heading") or "").strip()
    if heading:
        lines.append(("#" * (depth + 2)) + " " + heading)

    content = section.get("content")
    if isinstance(content, list):
        content = "\n".join(str(item) for item in content)
    if content:
        lines.append(str(content).strip())

    for point in section.get("key_points") or []:
        lines.append(f"- Ý chính: {point}")

    for formula in section.get("formulas") or []:
        if isinstance(formula, dict):
            lines.append(
                f"- Công thức: {formula.get('expression', '')} ({formula.get('explanation', '')})"
            )

    table = section.get("table")
    if isinstance(table, dict) and table.get("rows"):
        headers = table.get("headers") or []
        if headers:
            lines.append(" | ".join(str(cell) for cell in headers))
        for row in table.get("rows")[:12]:
            lines.append(" | ".join(str(cell) for cell in row))

    for child in section.get("subsections") or []:
        if isinstance(child, dict) and depth < 2:
            lines.append(_section_text(child, depth + 1))

    return "\n".join(line for line in lines if line)


def _normalize_question(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None

    question = str(raw.get("question") or "").strip()
    options = [str(option).strip() for option in (raw.get("options") or [])]
    options = [option for option in options if option]

    try:
        correct_index = int(raw.get("correct_index"))
    except (TypeError, ValueError):
        return None

    if (
        not question
        or len(options) != 4
        or len({option.casefold() for option in options}) != 4
        or not 0 <= correct_index < 4
    ):
        return None

    return {
        "question": question[:400],
        "options": [option[:200] for option in options],
        "correct_index": correct_index,
        "explanation": str(raw.get("explanation") or "").strip()[:600],
        "evidence": re.sub(r"\s+", " ", str(raw.get("evidence") or "")).strip()[:300],
    }


def ensure_practice_questions(topic: dict) -> tuple[list, bool]:
    """
    Trả về (content_sections đã gắn câu hỏi, có_thay_đổi_hay_không).
    Chỉ gọi Claude cho các mục chưa có câu hỏi.
    """
    sections = topic.get("content_sections") or []
    if isinstance(sections, str):
        try:
            sections = json.loads(sections)
        except json.JSONDecodeError:
            sections = []
    if not isinstance(sections, list):
        sections = []

    missing = [
        index
        for index, section in enumerate(sections[:MAX_SECTIONS])
        if isinstance(section, dict)
        and not section.get(PRACTICE_KEY)
        and not section.get("practice_skipped")
        and len(_section_text(section)) >= 80
    ]

    if not missing:
        return sections, False

    if not is_claude_configured():
        raise RuntimeError("Chưa cấu hình ANTHROPIC_API_KEY để tạo câu hỏi ôn nhanh.")

    lang = plan_language(supabase, topic.get("exam_plan_id"))

    def generate_batch(batch: list[int]) -> list[dict]:
        blocks = [
            f"=== MỤC {index} ===\n{_section_text(sections[index])[:6000]}"
            for index in batch
        ]
        prompt = (
            f"{language_rule(lang)}\n\n"
            f"Bài học: {topic.get('name') or ''}\n\n"
            f"Viết 3 câu hỏi cho MỖI mục có số: {', '.join(str(index) for index in batch)}.\n"
            "section_index phải là đúng số MỤC tương ứng.\n\n" + "\n\n".join(blocks)
        )
        result = generate_structured(
        tier="light",
            system=PRACTICE_SYSTEM,
            prompt=prompt,
            input_schema=PRACTICE_SCHEMA,
            max_tokens=9000,
        )
        return result.get("questions") or []

    batches = [
        missing[start:start + SECTIONS_PER_CALL]
        for start in range(0, len(missing), SECTIONS_PER_CALL)
    ]
    with ThreadPoolExecutor(max_workers=min(3, len(batches))) as executor:
        raw_questions = [item for batch in executor.map(generate_batch, batches) for item in batch]

    pools: dict[int, list[dict]] = {}
    for raw in raw_questions:
        try:
            index = int(raw.get("section_index"))
        except (TypeError, ValueError, AttributeError):
            continue
        if index not in missing:
            continue
        normalized = _normalize_question(raw)
        pool = pools.setdefault(index, [])
        if normalized and len(pool) < QUESTIONS_PER_SECTION and all(
            item["question"].casefold() != normalized["question"].casefold() for item in pool
        ):
            pool.append(normalized)

    changed = False
    for index, pool in pools.items():
        if pool:
            sections[index] = {**sections[index], PRACTICE_KEY: pool}
            changed = True

    # Mục Claude không tạo được câu hợp lệ: đánh dấu để lần sau không gọi lại vô ích
    for index in missing:
        if not sections[index].get(PRACTICE_KEY):
            sections[index] = {**sections[index], "practice_skipped": True}
            changed = True

    return sections, changed


def collect_practice_questions(sections: list) -> list[dict]:
    """Toàn bộ câu hỏi (cả nhóm của từng mục) kèm vị trí mục, cho giao diện chọn ngẫu nhiên."""
    questions = []
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            continue
        pool = section.get(PRACTICE_KEY)
        if isinstance(pool, list):
            for item in pool:
                if isinstance(item, dict):
                    questions.append({"section_index": index, **item})
    return questions
