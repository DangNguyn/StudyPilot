"""
Phân tích giáo trình bằng Claude theo hai bước:

1. Dựng mục lục (outline): Claude đọc toàn bộ tài liệu (hoặc từng cửa sổ
   lớn nếu tài liệu quá dài), nhận diện chương/mục thật của giáo trình và
   gán mỗi bài học một dải chunk liên tiếp. Các phần không phải kiến thức
   (bìa, mục lục, tài liệu tham khảo...) được đánh dấu để bỏ qua.

2. Biên soạn nội dung: với từng bài học, Claude đọc đúng các chunk của
   bài đó và tạo content_sections (mục, ý chính, bảng, tiểu mục) để sinh
   viên học và ôn tập. Các bài được xử lý song song.

Kết quả trả về có cùng định dạng với analyze_chunk_batch() cũ trong
main.py, nên lịch học, Quiz, Flashcard và giao diện không cần thay đổi.
"""

from content_language import language_rule
import os
import re
from concurrent.futures import ThreadPoolExecutor

from claude_client import (
    ClaudeOutputTruncated,
    generate_structured,
)

# Giới hạn ký tự cho một lần dựng mục lục (~ an toàn với context window).
OUTLINE_WINDOW_CHARS = int(os.getenv("CLAUDE_OUTLINE_WINDOW_CHARS", "200000"))

# Một bài học không nên vượt quá lượng chữ này (khoảng 10-15 trang).
MAX_TOPIC_CHARS = int(os.getenv("CLAUDE_MAX_TOPIC_CHARS", "30000"))

# Số bài được Claude biên soạn song song.
MAX_CONCURRENCY = max(1, int(os.getenv("CLAUDE_MAX_CONCURRENCY", "4")))


# ==============================
# JSON SCHEMA
# ==============================

OUTLINE_SCHEMA = {
    "type": "object",
    "properties": {
        "document_title": {
            "type": "string",
            "description": "Tên tài liệu/giáo trình nếu nhận diện được.",
        },
        "topics": {
            "type": "array",
            "description": "Danh sách bài học theo đúng thứ tự xuất hiện.",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["lesson", "non_learning"],
                        "description": (
                            "lesson: phần kiến thức cần học. "
                            "non_learning: bìa, mục lục, lời cảm ơn, "
                            "tài liệu tham khảo, trang trống..."
                        ),
                    },
                    "chapter": {
                        "type": "string",
                        "description": (
                            "Chương/Unit chứa bài, giữ nguyên số và tên "
                            "như tài liệu, ví dụ 'Chương 2: Cung và cầu'."
                        ),
                    },
                    "section": {
                        "type": "string",
                        "description": (
                            "Mục trong chương nếu có, ví dụ "
                            "'2.1 Khái niệm cầu'. Để trống nếu không có."
                        ),
                    },
                    "name": {
                        "type": "string",
                        "description": "Tên bài học ngắn gọn, đúng nội dung.",
                    },
                    "description": {
                        "type": "string",
                        "description": "1-2 câu mô tả bài học.",
                    },
                    "start_chunk": {"type": "integer"},
                    "end_chunk": {"type": "integer"},
                    "difficulty_level": {
                        "type": "integer",
                        "description": "Độ khó từ 1 (rất dễ) đến 5 (rất khó).",
                    },
                    "estimated_minutes": {
                        "type": "integer",
                        "description": "Thời gian học dự kiến (phút).",
                    },
                },
                "required": [
                    "kind",
                    "chapter",
                    "section",
                    "name",
                    "description",
                    "start_chunk",
                    "end_chunk",
                    "difficulty_level",
                    "estimated_minutes",
                ],
            },
        },
    },
    "required": ["document_title", "topics"],
}

_TABLE_SCHEMA = {
    "type": "object",
    "description": (
        "Chỉ điền khi nội dung có dạng bảng: từ vựng, so sánh, "
        "phân loại, công thức, thuật ngữ - định nghĩa. "
        "Nếu không có bảng, để headers và rows là mảng rỗng."
    ),
    "properties": {
        "headers": {"type": "array", "items": {"type": "string"}},
        "rows": {
            "type": "array",
            "items": {"type": "array", "items": {"type": "string"}},
        },
    },
    "required": ["headers", "rows"],
}

_FORMULA_SCHEMA = {
    "type": "array",
    "description": (
        "Công thức trong mục (để mảng rỗng nếu không có). "
        "Phân số viết dạng 'tử / mẫu' có dấu cách quanh '/', "
        "chỉ số dưới viết bằng '_' (ví dụ E_D, Q_d)."
    ),
    "items": {
        "type": "object",
        "properties": {
            "expression": {
                "type": "string",
                "description": "Ví dụ: |E_D| = %ΔQ / %ΔP",
            },
            "explanation": {
                "type": "string",
                "description": "Giải thích ngắn các ký hiệu, có thể để trống.",
            },
        },
        "required": ["expression", "explanation"],
    },
}

_SUBSECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "heading": {"type": "string"},
        "content": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Các ý kiến thức, mỗi phần tử là một ý.",
        },
        "key_points": {"type": "array", "items": {"type": "string"}},
        "formulas": _FORMULA_SCHEMA,
        "table": _TABLE_SCHEMA,
    },
    "required": ["heading", "content", "key_points", "formulas", "table"],
}

LESSON_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {
            "type": "string",
            "description": "Tóm tắt bài học trong 1-3 câu.",
        },
        "content_sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": "string"},
                    "content": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Các ý kiến thức, mỗi phần tử là một ý.",
                    },
                    "key_points": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "2-5 ý quan trọng nhất cần ghi nhớ.",
                    },
                    "formulas": _FORMULA_SCHEMA,
                    "table": _TABLE_SCHEMA,
                    "subsections": {
                        "type": "array",
                        "items": _SUBSECTION_SCHEMA,
                        "description": "Các tiểu mục; để mảng rỗng nếu không có.",
                    },
                },
                "required": [
                    "heading",
                    "content",
                    "key_points",
                    "formulas",
                    "table",
                    "subsections",
                ],
            },
        },
    },
    "required": ["description", "content_sections"],
}


# ==============================
# PROMPT
# ==============================

OUTLINE_SYSTEM = """Bạn là chuyên gia thiết kế chương trình học cho sinh viên đại học.
Nhiệm vụ của bạn là đọc giáo trình đã được chia thành các đoạn (chunk) có đánh số
và chia giáo trình thành các BÀI HỌC theo đúng cấu trúc chương/mục của tài liệu.

QUY TẮC CHIA BÀI:
1. Bám sát cấu trúc thật của tài liệu: tên chương, unit, mục 1.1, 1.2... Giữ nguyên
   số thứ tự và tên gọi như trong tài liệu. Nếu tài liệu không có tiêu đề, tự đặt
   tên ngắn gọn, đúng nội dung.
2. Mỗi bài học (kind = "lesson") là một khối kiến thức hoàn chỉnh mà sinh viên học
   trong khoảng 15-60 phút. Ưu tiên cắt theo mục cấp 2 (1.1, 1.2...). Mục quá ngắn
   thì gộp với mục liền kề CÙNG chương; mục quá dài thì chia theo tiểu mục.
3. Không gộp nội dung của hai chương khác nhau vào cùng một bài.
4. Mỗi bài là một dải chunk LIÊN TIẾP từ start_chunk đến end_chunk (bao gồm cả hai
   đầu). Các dải theo đúng thứ tự tài liệu, không chồng lấn, không bỏ sót chunk nào.
5. Phần không phải kiến thức (bìa, mục lục, lời nói đầu chung chung, lời cảm ơn,
   danh mục tài liệu tham khảo, trang trống) đánh dấu kind = "non_learning".
   Bài tập, ví dụ, câu hỏi ôn tập, tóm tắt chương VẪN là "lesson".
6. Một chunk có thể bắt đầu giữa chừng một mục; hãy gán nó vào bài chứa phần lớn
   nội dung của chunk đó.
7. difficulty_level: 1 (rất dễ) đến 5 (rất khó). estimated_minutes: thời gian để
   sinh viên đọc hiểu và ghi nhớ bài, thường 15-60 phút.
8. Viết tên bài, chương, mô tả bằng ngôn ngữ của tài liệu gốc; mô tả bằng tiếng Việt
   nếu tài liệu là tiếng Việt."""


LESSON_SYSTEM = """Bạn là giảng viên đại học, chuyên biên soạn nội dung học tập ngắn gọn,
dễ ôn tập từ giáo trình gốc cho sinh viên.

YÊU CẦU BIÊN SOẠN:
1. CHỈ sử dụng kiến thức có trong đoạn giáo trình được cung cấp. Không thêm kiến
   thức bên ngoài, không bịa số liệu, ví dụ hay trích dẫn.
2. Bám theo cấu trúc mục/tiểu mục của giáo trình. heading CHỈ là tên mục, KHÔNG kèm
   số mục hay ký hiệu đánh số của tài liệu ở BẤT KỲ vị trí nào trong tiêu đề (bỏ "1.1.1.",
   "2.", "I.", "a)", "Mục 3:"...), vì ứng dụng tự đánh số. Mục con đặt trong subsections.
3. content là danh sách các ý kiến thức; MỖI PHẦN TỬ là MỘT ý hoàn chỉnh, rõ nghĩa,
   tối đa khoảng 2 câu. Bao quát ĐẦY ĐỦ các kiến thức cần học: định nghĩa, khái
   niệm, đặc điểm, phân loại, nguyên lý, quy trình/các bước, công thức (giữ nguyên
   ký hiệu), ví dụ minh hoạ tiêu biểu, lưu ý quan trọng.
4. Không bắt đầu một ý bằng số mục (vd "1.1 ...") hoặc bằng các từ Chương/Unit/Bài/
   Lesson/Chapter; không lặp lại heading trong content.
5. key_points: 2-5 ý quan trọng nhất của mục, ngắn gọn để ôn nhanh.
6. Dùng table khi nội dung có dạng bảng: từ vựng (cột: Từ, Loại từ, Phiên âm, Nghĩa),
   so sánh, phân loại, thuật ngữ - định nghĩa, công thức - ý nghĩa. Không dồn danh
   sách từ vựng vào content.
7. Loại bỏ nhiễu: số trang, đầu/chân trang, ngày tháng in ấn, mục lục, quảng cáo,
   hướng dẫn thao tác không phải kiến thức.
8. Viết theo NGÔN NGỮ BẮT BUỘC ghi ở đầu yêu cầu, rõ ràng; giữ tên riêng và ví dụ gốc
   của tài liệu, thuật ngữ chuyên ngành kèm thuật ngữ gốc như quy tắc ngôn ngữ đã nêu.
9. Mỗi công thức đưa vào formulas (KHÔNG lặp lại trong content): expression viết
   một dòng, phân số dạng "tử / mẫu" có dấu cách quanh "/", chỉ số dưới dùng "_"
   (ví dụ |E_D| = %ΔQ / %ΔP); explanation giải thích ngắn ý nghĩa các ký hiệu.
10. Khi nội dung là các trường hợp/phân loại ngắn (vd |E_D| > 1, < 1, = 1), dùng
   table 2 cột (Trường hợp, Ý nghĩa) để hiển thị thành thẻ so sánh.
11. Trong key_points, bọc 1-3 cụm từ quan trọng nhất bằng **...** để làm nổi bật."""


# ==============================
# TIỆN ÍCH
# ==============================

def _clean_text(value, limit: int) -> str:
    text = re.sub(r"[ \t\r\f\v]+", " ", str(value or "")).strip()
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text[:limit].strip()


def _to_int(value, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _format_chunks(chunks) -> str:
    parts = []

    for chunk in chunks:
        page = chunk.get("page_number")
        page_attr = f' page="{page}"' if page is not None else ""
        parts.append(
            f'<chunk index="{chunk["chunk_index"]}"{page_attr}>\n'
            f'{str(chunk.get("content") or "").strip()}\n'
            f"</chunk>"
        )

    return "\n".join(parts)


def _chunk_chars(chunks) -> int:
    return sum(len(str(chunk.get("content") or "")) for chunk in chunks)


def _build_windows(chunks):
    """Chia tài liệu rất dài thành các cửa sổ lớn để dựng mục lục."""
    windows = []
    current = []
    current_chars = 0

    for chunk in chunks:
        size = len(str(chunk.get("content") or "")) + 40

        if current and current_chars + size > OUTLINE_WINDOW_CHARS:
            windows.append(current)
            current = []
            current_chars = 0

        current.append(chunk)
        current_chars += size

    if current:
        windows.append(current)

    return windows


# ==============================
# BƯỚC 1: DỰNG MỤC LỤC
# ==============================

def normalize_outline_ranges(raw_topics, window_indices):
    """
    Chuẩn hoá các dải chunk Claude trả về để bảo đảm:
    - Chỉ dùng chunk thuộc cửa sổ hiện tại.
    - Các dải liên tiếp, không chồng lấn, theo đúng thứ tự tài liệu.
    - Không chunk nào bị bỏ sót (khoảng trống được gộp vào bài kề bên).
    """
    if not window_indices:
        return []

    positions = {index: position for position, index in enumerate(window_indices)}
    last_position = len(window_indices) - 1

    def to_position(raw_index, prefer_lower: bool) -> int:
        index = _to_int(raw_index, window_indices[0])

        if index in positions:
            return positions[index]

        if index <= window_indices[0]:
            return 0

        if index >= window_indices[-1]:
            return last_position

        # Chỉ số nằm trong khoảng nhưng không tồn tại: lấy chunk gần nhất.
        candidates = [
            position
            for position, value in enumerate(window_indices)
            if (value >= index if prefer_lower else value <= index)
        ]
        if not candidates:
            return 0 if prefer_lower else last_position
        return min(candidates) if prefer_lower else max(candidates)

    entries = []

    for topic in raw_topics or []:
        if not isinstance(topic, dict):
            continue

        start = to_position(topic.get("start_chunk"), prefer_lower=True)
        end = to_position(topic.get("end_chunk"), prefer_lower=False)

        if end < start:
            start, end = end, start

        entries.append({**topic, "_start": start, "_end": end})

    entries.sort(key=lambda item: (item["_start"], item["_end"]))

    normalized = []
    cursor = 0

    for entry in entries:
        start = max(entry["_start"], cursor)
        end = entry["_end"]

        if start > end:
            # Dải đã bị dải trước bao phủ hoàn toàn.
            continue

        if start > cursor:
            previous = normalized[-1] if normalized else None

            if previous and previous.get("kind") == "lesson":
                previous["_end"] = start - 1
            else:
                start = cursor

        entry["_start"] = start
        entry["_end"] = end
        normalized.append(entry)
        cursor = end + 1

    if not normalized:
        return [{
            "kind": "lesson",
            "chapter": "",
            "section": "",
            "name": "",
            "description": "",
            "_start": 0,
            "_end": last_position,
        }]

    if cursor <= last_position:
        normalized[-1]["_end"] = last_position

    for entry in normalized:
        entry["source_chunk_indices"] = window_indices[
            entry["_start"]:entry["_end"] + 1
        ]

    return normalized


def _outline_window(window, window_number, total_windows, previous_context):
    window_indices = [int(chunk["chunk_index"]) for chunk in window]

    context_lines = [
        f"Phần {window_number}/{total_windows} của tài liệu, "
        f"gồm các chunk từ {window_indices[0]} đến {window_indices[-1]}.",
    ]

    if previous_context:
        context_lines.append(
            "Bài học cuối cùng của phần trước: "
            f"{previous_context}. Nếu đầu phần này là phần tiếp nối của bài "
            "đó, hãy dùng lại đúng chapter và name."
        )

    prompt = (
        "\n".join(context_lines)
        + "\n\nNỘI DUNG GIÁO TRÌNH:\n"
        + _format_chunks(window)
        + "\n\nHãy chia phần tài liệu trên thành các bài học và trả về "
        "JSON theo đúng schema. start_chunk/end_chunk phải là index của "
        "chunk ở trên. Trường section để chuỗi rỗng nếu không có."
    )

    try:
        result = generate_structured(
            system=OUTLINE_SYSTEM,
            prompt=prompt,
            tool_name="save_outline",
            tool_description="Lưu mục lục bài học của giáo trình.",
            input_schema=OUTLINE_SCHEMA,
            max_tokens=16000,
        )
    except ClaudeOutputTruncated:
        # Mục lục quá dài: chia đôi cửa sổ và dựng lại từng nửa.
        if len(window) <= 1:
            raise

        middle = len(window) // 2
        first = _outline_window(
            window[:middle], window_number, total_windows, previous_context
        )
        last_name = _describe_topic(first[-1]) if first else previous_context
        second = _outline_window(
            window[middle:], window_number, total_windows, last_name
        )
        return first + second

    return normalize_outline_ranges(result.get("topics"), window_indices)


def _describe_topic(topic) -> str:
    chapter = str(topic.get("chapter") or "").strip()
    name = str(topic.get("name") or "").strip()
    return f"{chapter} > {name}" if chapter else name


def _topic_identity(topic):
    return (
        str(topic.get("kind") or "").casefold(),
        str(topic.get("chapter") or "").strip().casefold(),
        str(topic.get("name") or "").strip().casefold(),
    )


def _split_oversized(topic, chunk_by_index):
    """Chia bài quá dài thành nhiều phần để buổi học vừa sức."""
    indices = topic["source_chunk_indices"]
    chunks = [chunk_by_index[index] for index in indices]

    if _chunk_chars(chunks) <= MAX_TOPIC_CHARS or len(indices) <= 1:
        return [topic]

    groups = []
    current = []
    current_chars = 0

    for index, chunk in zip(indices, chunks):
        size = len(str(chunk.get("content") or ""))

        if current and current_chars + size > MAX_TOPIC_CHARS:
            groups.append(current)
            current = []
            current_chars = 0

        current.append(index)
        current_chars += size

    if current:
        groups.append(current)

    parts = []

    for part_number, group in enumerate(groups, start=1):
        parts.append({
            **topic,
            "name": f"{topic['name']} (phần {part_number}/{len(groups)})",
            "source_chunk_indices": group,
            "estimated_minutes": None,
        })

    return parts


_OUTLINE_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".outline_cache")


def _outline_cache_key(chunks) -> str:
    import hashlib
    digest = hashlib.sha256()
    for chunk in chunks:
        digest.update(str(chunk.get("chunk_index")).encode())
        digest.update(b"\x00")
        digest.update(str(chunk.get("content") or "").encode("utf-8"))
        digest.update(b"\x01")
    return digest.hexdigest()


def build_outline(chunks):
    """
    Dựng mục lục. Kết quả được lưu theo nội dung tài liệu, nên bước "AI nhận diện
    chương" lúc chọn file và bước phân tích khi tạo kế hoạch chỉ tốn một lần.
    """
    import json as _json

    cache_path = os.path.join(_OUTLINE_CACHE_DIR, _outline_cache_key(chunks) + ".json")
    try:
        with open(cache_path, encoding="utf-8") as cache_file:
            return _json.load(cache_file)
    except (OSError, ValueError):
        pass

    outline = _build_outline_uncached(chunks)

    try:
        os.makedirs(_OUTLINE_CACHE_DIR, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as cache_file:
            _json.dump(outline, cache_file, ensure_ascii=False)
    except OSError as error:
        print("Không lưu được mục lục tạm:", str(error))

    return outline


def summarize_outline_chapters(outline):
    """Gom mục lục thành danh sách chương (kèm dải chunk) để hiển thị và chọn trọng tâm."""
    chapters = []
    for item in outline:
        if item.get("kind") == "non_learning":
            continue
        indices = [int(index) for index in item.get("source_chunk_indices") or []]
        if not indices:
            continue
        chapter = (
            _clean_text(item.get("chapter"), 150).replace("\n", " ")
            or _clean_text(item.get("section"), 150).replace("\n", " ")
            or _clean_text(item.get("name"), 150).replace("\n", " ")
            or "Nội dung khác"
        )
        if not chapters or chapters[-1]["name"] != chapter:
            chapters.append({
                "name": chapter,
                "lesson_count": 0,
                "chunk_count": 0,
                "difficulty_sum": 0,
                "start_chunk": min(indices),
                "end_chunk": max(indices),
            })
        current = chapters[-1]
        current["lesson_count"] += 1
        current["chunk_count"] += len(indices)
        current["difficulty_sum"] += max(1, min(5, _to_int(item.get("difficulty_level"), 3)))
        current["start_chunk"] = min(current["start_chunk"], min(indices))
        current["end_chunk"] = max(current["end_chunk"], max(indices))

    for chapter in chapters:
        chapter["difficulty"] = round(chapter.pop("difficulty_sum") / max(1, chapter["lesson_count"]), 1)

    # Gợi ý trọng tâm: chương khó và nhiều nội dung nhất (khoảng 1/3 số chương, tối đa 3)
    if len(chapters) >= 3:
        ranked = sorted(
            range(len(chapters)),
            key=lambda i: chapters[i]["difficulty"] * chapters[i]["chunk_count"],
            reverse=True,
        )
        focus_count = max(1, min(3, round(len(chapters) / 3)))
        for index in ranked[:focus_count]:
            chapters[index]["suggested_focus"] = True
    for chapter in chapters:
        chapter.setdefault("suggested_focus", False)
    return chapters


def _build_outline_uncached(chunks):
    windows = _build_windows(chunks)
    outline = []
    previous_context = None

    for window_number, window in enumerate(windows, start=1):
        window_topics = _outline_window(
            window, window_number, len(windows), previous_context
        )

        # Gộp bài bị cắt ngang giữa hai cửa sổ.
        if (
            outline
            and window_topics
            and _topic_identity(outline[-1]) == _topic_identity(window_topics[0])
        ):
            outline[-1]["source_chunk_indices"] = (
                outline[-1]["source_chunk_indices"]
                + window_topics[0]["source_chunk_indices"]
            )
            window_topics = window_topics[1:]

        outline.extend(window_topics)

        lessons = [item for item in outline if item.get("kind") == "lesson"]
        if lessons:
            previous_context = _describe_topic(lessons[-1])

    return outline


# ==============================
# BƯỚC 2: BIÊN SOẠN NỘI DUNG BÀI HỌC
# ==============================

def _normalize_items(raw_items, item_limit: int, max_items: int):
    if isinstance(raw_items, str):
        raw_items = raw_items.splitlines()

    if not isinstance(raw_items, list):
        return []

    items = []
    seen = set()

    for raw_item in raw_items:
        text = _clean_text(raw_item, item_limit)
        text = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", text).strip()
        key = text.casefold()

        if text and key not in seen:
            seen.add(key)
            items.append(text.replace("\n", " "))

        if len(items) >= max_items:
            break

    return items


def _normalize_table(raw_table):
    if not isinstance(raw_table, dict):
        return None

    headers = [
        _clean_text(header, 80)
        for header in (raw_table.get("headers") or [])
        if _clean_text(header, 80)
    ][:6]

    if len(headers) < 2:
        return None

    rows = []

    for raw_row in raw_table.get("rows") or []:
        if not isinstance(raw_row, list):
            continue

        row = [_clean_text(cell, 300) for cell in raw_row[:len(headers)]]
        row += [""] * (len(headers) - len(row))

        if any(row):
            rows.append(row)

        if len(rows) >= 80:
            break

    if not rows:
        return None

    return {"headers": headers, "rows": rows}


def _normalize_formulas(raw_formulas):
    if not isinstance(raw_formulas, list):
        return []

    formulas = []

    for raw_formula in raw_formulas[:8]:
        if isinstance(raw_formula, str):
            raw_formula = {"expression": raw_formula, "explanation": ""}

        if not isinstance(raw_formula, dict):
            continue

        expression = _clean_text(raw_formula.get("expression"), 200)
        expression = expression.replace("\n", " ")

        if not expression:
            continue

        formulas.append({
            "expression": expression,
            "explanation": _clean_text(
                raw_formula.get("explanation"), 300
            ).replace("\n", " "),
        })

    return formulas


_HEADING_NUMBER_RE = re.compile(
    r"^\s*(?:"
    r"(?:chương|chapter|mục|phần|part|section|bài|lesson|unit)\s*(?:\d+(?:\.\d+)*|(?-i:[IVXLC]+))\.?(?!\w)"
    r"|\d+(?:\.\d+)+\.?"
    r"|\d+[.)]"
    r"|[ivxlc]+[.)]"
    r"|[a-zđ][.)]"
    r")\s*[:\-–—]?\s*",
    re.IGNORECASE,
)


def _strip_leading_number(segment: str) -> str:
    text = segment.strip()
    for _ in range(3):
        stripped = _HEADING_NUMBER_RE.sub("", text, count=1).strip()
        if not stripped or stripped == text:
            break
        text = stripped
    return text


_HEADING_SPLIT_RE = re.compile(r"(\s+[-–—>|:]\s+|\s*>\s*|:\s+)")


def strip_heading_number(heading: str) -> str:
    """Bỏ mọi số đề mục của tài liệu ("1.1.1.", "I.", "a)", "Chương 2:") ở đầu
    tiêu đề và ở đầu từng phần sau dấu phân cách.
    Vd: "TECHNOLOGY - 1.1.1. The basic concept" -> "TECHNOLOGY - The basic concept"."""
    text = str(heading or "").strip()
    if not text:
        return ""
    pieces = _HEADING_SPLIT_RE.split(text)
    kept = []
    for index in range(0, len(pieces), 2):
        raw = pieces[index].strip()
        # Phần chỉ là nhãn đánh số ("Chương 2", "Unit 4") thì bỏ hẳn
        if raw and not _HEADING_NUMBER_RE.sub("", raw, count=1).strip():
            continue
        cleaned = _strip_leading_number(raw)
        if not cleaned:
            continue
        if kept:
            kept.append(pieces[index - 1] if index > 0 else " - ")
        kept.append(cleaned)
    return re.sub(r"\s{2,}", " ", "".join(kept)).strip() or text


def normalize_lesson_section(raw_section, depth: int = 0):
    if not isinstance(raw_section, dict) or depth > 2:
        return None

    heading = strip_heading_number(
        _clean_text(raw_section.get("heading"), 150).replace("\n", " ")
    )

    if not heading:
        return None

    content = _normalize_items(raw_section.get("content"), 500, 25)
    key_points = _normalize_items(raw_section.get("key_points"), 250, 6)
    formulas = _normalize_formulas(raw_section.get("formulas"))
    table = _normalize_table(raw_section.get("table"))

    subsections = []

    for child in raw_section.get("subsections") or []:
        normalized_child = normalize_lesson_section(child, depth + 1)

        if normalized_child:
            subsections.append(normalized_child)

    if (
        not content
        and not key_points
        and not formulas
        and not table
        and not subsections
    ):
        return None

    return {
        "heading": heading,
        "content": "\n".join(content),
        "key_points": key_points,
        "formulas": formulas,
        "table": table,
        "subsections": subsections[:15],
    }


def build_fallback_sections(topic, chunks):
    """Nội dung dự phòng khi Claude không biên soạn được một bài."""
    lines = []
    seen = set()

    for chunk in chunks:
        for raw_line in str(chunk.get("content") or "").splitlines():
            line = re.sub(r"\s+", " ", raw_line).strip()

            if len(line) < 3 or line.casefold() in seen:
                continue

            seen.add(line.casefold())
            lines.append(line[:300])

    return [{
        "heading": topic.get("name") or "Nội dung bài học",
        "content": "\n".join(lines[:12]),
        "key_points": [],
        "table": None,
        "subsections": [],
    }] if lines else []


def _write_lesson(topic, chunks, document_title, language: str = "vi"):
    location = " > ".join(
        part
        for part in [
            str(topic.get("chapter") or "").strip(),
            str(topic.get("section") or "").strip(),
        ]
        if part
    )

    prompt = (
        f"{language_rule(language)}\n\n"
        f"TÀI LIỆU: {document_title}\n"
        f"VỊ TRÍ TRONG GIÁO TRÌNH: {location or 'Không rõ'}\n"
        f"TÊN BÀI HỌC: {topic.get('name')}\n\n"
        "NỘI DUNG GIÁO TRÌNH CỦA BÀI:\n"
        + _format_chunks(chunks)
        + "\n\nHãy biên soạn nội dung học cho bài này và trả về JSON "
        "theo đúng schema."
    )

    for max_tokens in (8000, 16000):
        try:
            return generate_structured(
                system=LESSON_SYSTEM,
                prompt=prompt,
                tool_name="save_lesson",
                tool_description="Lưu nội dung học đã biên soạn của bài.",
                input_schema=LESSON_SCHEMA,
                max_tokens=max_tokens,
            )
        except ClaudeOutputTruncated:
            continue

    raise ClaudeOutputTruncated("Nội dung bài học quá dài.")


def _estimate_minutes(chunks) -> int:
    # Khoảng 250 ký tự giáo trình cho mỗi phút đọc hiểu và ghi nhớ.
    return max(10, min(120, round(_chunk_chars(chunks) / 250)))


def _make_unique_names(topics):
    counts = {}

    for topic in topics:
        key = (topic["hierarchy"].casefold(), topic["name"].casefold())
        counts[key] = counts.get(key, 0) + 1

        if counts[key] > 1:
            topic["name"] = f"{topic['name']} ({counts[key]})"

    return topics


# ==============================
# HÀM CHÍNH
# ==============================

def analyze_document_with_claude(chunks, document_name: str = "", language: str = "vi"):
    """
    Phân tích toàn bộ tài liệu và trả về danh sách chủ đề theo định dạng:
    hierarchy, name, description, difficulty_level, estimated_minutes,
    source_chunk_indices, content_sections.
    """
    valid_chunks = []
    seen_indices = set()

    for chunk in chunks or []:
        index = _to_int(chunk.get("chunk_index"), -1)

        if index < 0 or index in seen_indices:
            continue

        seen_indices.add(index)
        valid_chunks.append({**chunk, "chunk_index": index})

    valid_chunks.sort(key=lambda chunk: chunk["chunk_index"])

    if not valid_chunks:
        raise ValueError("Không tìm thấy đoạn tài liệu hợp lệ để phân tích.")

    chunk_by_index = {chunk["chunk_index"]: chunk for chunk in valid_chunks}

    # 1. Dựng mục lục
    outline = build_outline(valid_chunks)
    lessons = [item for item in outline if item.get("kind") == "lesson"]

    # Nếu Claude coi toàn bộ là "non_learning", vẫn giữ lại để học.
    if not lessons:
        lessons = outline

    planned_topics = []

    for lesson in lessons:
        chapter = _clean_text(lesson.get("chapter"), 150).replace("\n", " ")
        section = _clean_text(lesson.get("section"), 150).replace("\n", " ")
        name = _clean_text(lesson.get("name"), 140).replace("\n", " ")

        planned_topics.extend(_split_oversized({
            "chapter": chapter,
            "section": section,
            "name": name or section or chapter or "Bài học",
            "description": _clean_text(lesson.get("description"), 500),
            "difficulty_level": lesson.get("difficulty_level"),
            "estimated_minutes": lesson.get("estimated_minutes"),
            "source_chunk_indices": list(lesson["source_chunk_indices"]),
        }, chunk_by_index))

    document_title = document_name or "Giáo trình"

    # 2. Biên soạn nội dung từng bài (song song)
    def build_topic(topic):
        topic_chunks = [
            chunk_by_index[index] for index in topic["source_chunk_indices"]
        ]

        try:
            lesson = _write_lesson(topic, topic_chunks, document_title, language)
            sections = [
                normalized
                for normalized in (
                    normalize_lesson_section(raw)
                    for raw in (lesson.get("content_sections") or [])
                )
                if normalized
            ]
            description = _clean_text(lesson.get("description"), 600)
        except Exception as error:
            print(
                f"Claude không biên soạn được bài '{topic['name']}':",
                str(error)
            )
            sections = []
            description = ""

        if not sections:
            sections = build_fallback_sections(topic, topic_chunks)

        hierarchy_parts = [
            part for part in [topic["chapter"], topic["section"]] if part
        ]

        difficulty = max(1, min(5, _to_int(topic.get("difficulty_level"), 3)))
        minutes = _to_int(topic.get("estimated_minutes"), 0)
        if minutes <= 0:
            minutes = _estimate_minutes(topic_chunks)

        return {
            "hierarchy": " > ".join(hierarchy_parts) or document_title,
            "name": (strip_heading_number(topic["name"]) or topic["name"])[:150],
            "description": (
                description
                or topic["description"]
                or f"Bài học: {topic['name']}"
            ),
            "difficulty_level": difficulty,
            "estimated_minutes": max(10, min(240, minutes)),
            "source_chunk_indices": topic["source_chunk_indices"],
            "content_sections": sections,
        }

    with ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as executor:
        topics = list(executor.map(build_topic, planned_topics))

    return _make_unique_names(topics)
