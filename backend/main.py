
import os
import tempfile
import json
import hashlib
import re

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4
from typing import Literal
from document_processor import extract_text, split_into_chunks
from groq_client import generate_text
from supabase_client import supabase

# Đọc biến môi trường
load_dotenv()

DEMO_USER_ID = os.getenv("DEMO_USER_ID")

def parse_ai_json(raw_text: str):
    """
    Chuyển nội dung JSON do AI trả về thành Python object.
    """

    text = raw_text.strip()

    # Loại bỏ Markdown code fence nếu có
    text = re.sub(
        r"^```(?:json)?\s*|\s*```$",
        "",
        text,
        flags=re.IGNORECASE
    ).strip()

    try:
        return json.loads(text)

    except json.JSONDecodeError:
        # Thử lấy phần JSON object trong nội dung trả về
        start = text.find("{")
        end = text.rfind("}")

        if start == -1 or end == -1 or end < start:
            raise ValueError("AI không trả về JSON hợp lệ.")

        return json.loads(text[start:end + 1])


def create_topic_source_key(hierarchy: str, name: str):
    """
    Tạo mã định danh ổn định cho chủ đề AI dựa trên cấu trúc tài liệu.
    """

    normalized = re.sub(
        r"\s+",
        " ",
        f"{hierarchy.strip()}::{name.strip()}"
    ).casefold()

    return hashlib.sha256(
        normalized.encode("utf-8")
    ).hexdigest()


def get_main_topic_title(value: str) -> str:
    """Keep only the main heading when AI includes document metadata."""
    title = str(value or "").strip()
    title = re.sub(
        r"^\s*(?:(?:\d{1,2}[/-]){2}\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*[-–—:.,]?\s*",
        "",
        title
    )
    title = re.sub(
        r"^\s*(?:chapter|chương)\s*\d+\s*[:.-]?\s*",
        "",
        title,
        flags=re.IGNORECASE
    )
    title = re.sub(
        r"^\s*\d+(?:\.\d+)+\.?\s*",
        "",
        title
    )

    content_marker = re.search(
        r"\b(?:content|nội dung)\b",
        title,
        flags=re.IGNORECASE
    )
    if content_marker and content_marker.start() > 0:
        title = title[:content_marker.start()]

    title = re.sub(r"[.;:,|]+\s*$", "", title)
    title = re.sub(r"\s{2,}", " ", title).strip()
    return title or "Chủ đề học tập"


def get_section_heading(value: str) -> str:
    """Clean a lesson heading while preserving its source section number."""
    heading = str(value or "").strip()
    heading = re.sub(
        r"^\s*(?:(?:\d{1,2}[/-]){2}\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*[-–—:.,]?\s*",
        "",
        heading
    )
    heading = re.sub(
        r"^\s*(?:chapter|chương)\s*\d+\s*[:.-]?\s*",
        "",
        heading,
        flags=re.IGNORECASE
    )
    heading = re.sub(r"[.;:,|]+\s*$", "", heading)
    heading = re.sub(r"\s{2,}", " ", heading).strip()
    return heading or "Nội dung học tập"


def is_generic_topic_name(value: str) -> bool:
    normalized = re.sub(
        r"\s+",
        " ",
        str(value or "")
    ).strip().casefold()

    return normalized in {
        "nội dung học tập",
        "nội dung",
        "nội dung tài liệu",
        "nội dung chưa được phân loại",
        "tài liệu",
        "chủ đề học tập",
        "phần nội dung"
    }


def get_content_key_points(heading, points):
    normalized_heading = get_main_topic_title(
        heading
    ).casefold()
    heading_prefix = " ".join(
        normalized_heading.split()[:4]
    )

    if not isinstance(points, list):
        return []

    cleaned_points = []

    for point in points:
        clean_point = str(point or "").strip()

        if not clean_point:
            continue

        if NON_LEARNING_LINE_PATTERN.match(clean_point):
            continue

        if (
            get_main_topic_title(clean_point).casefold()
            == normalized_heading
        ):
            continue

        normalized_point = get_main_topic_title(
            clean_point
        ).casefold()
        point_prefix = " ".join(
            normalized_point.split()[:4]
        )

        if (
            heading_prefix
            and point_prefix == heading_prefix
            and len(normalized_point)
            <= len(normalized_heading) + 80
        ):
            continue

        if re.match(
            r"^(?:chapter|chương|unit|học kỳ)\b",
            normalized_point,
            flags=re.IGNORECASE
        ):
            continue

        if clean_point not in cleaned_points:
            cleaned_points.append(clean_point)

    return cleaned_points[:5]


NON_LEARNING_LINE_PATTERN = re.compile(
    r"^\s*(?:"
    r"tip|note|lưu ý|chú thích|"
    r"page\s*\d+|trang\s*\d+|"
    r"copyright|www\.|https?://|"
    r"mục lục|table of contents"
    r")\b",
    flags=re.IGNORECASE
)

HEADING_OR_METADATA_PATTERN = re.compile(
    r"^\s*(?:"
    r"từ vựng\b|"
    r"vocabulary\b|"
    r"nội dung học tập\b|"
    r"học kỳ\b|"
    r"unit\s+\d+\b|"
    r"(?:chapter|chương|lesson|module|part|bài)\s+\d+\b"
    r")",
    flags=re.IGNORECASE
)


def is_heading_or_metadata_line(value: str) -> bool:
    """Identify document labels that must not become lesson bullets."""
    candidate = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", str(value or ""))
    return bool(HEADING_OR_METADATA_PATTERN.match(candidate.strip()))


def extract_vocabulary_rows(raw_content: str):
    """Extract common word/POS/pronunciation/meaning sequences into rows."""
    content = re.sub(r"\s+", " ", str(raw_content or "")).strip()
    marker = re.search(r"\b(?:nghĩa|meaning)\b", content, flags=re.IGNORECASE)

    if marker:
        content = content[marker.end():].strip(" :-")

    if not content:
        return []

    part_of_speech = (
        r"adj|adv|v|n|prep|pron|conj|"
        r"tính từ|động từ|danh từ|trạng từ"
    )
    entry_pattern = re.compile(
        rf"(?P<word>[A-Za-z][A-Za-z' -]*?)\s*"
        rf"\((?P<pos>{part_of_speech})\)\s*"
        rf"(?P<details>.*?)(?=\s+[A-Za-z][A-Za-z' -]*\s*"
        rf"\((?:{part_of_speech})\)|$)",
        flags=re.IGNORECASE
    )

    rows = []

    for match in entry_pattern.finditer(content):
        word = match.group("word").strip(" -")
        details = match.group("details").strip()
        pronunciation_match = re.match(
            r"(?P<pronunciation>/[^/]+/)\s*(?P<meaning>.*)",
            details
        )
        pronunciation = (
            pronunciation_match.group("pronunciation").strip()
            if pronunciation_match
            else ""
        )
        meaning = (
            pronunciation_match.group("meaning").strip()
            if pronunciation_match
            else details
        )

        if word and meaning:
            rows.append([
                word,
                match.group("pos").strip(),
                pronunciation,
                meaning.rstrip(" .;")
            ])

    return rows[:30]


def extract_learning_lines(raw_content: str):
    """Remove common document noise before the fallback lesson is built."""
    lines = []
    seen_lines = set()

    for raw_line in str(raw_content or "").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()

        if not line or NON_LEARNING_LINE_PATTERN.match(line):
            continue

        normalized_line = line.casefold()

        if normalized_line in seen_lines:
            continue

        seen_lines.add(normalized_line)
        lines.append(line)

    return lines


def get_learning_bullets(heading: str, raw_content: str):
    """Keep concise learning statements while excluding section labels."""
    normalized_heading = get_main_topic_title(
        heading
    ).casefold()
    bullets = []

    for line in extract_learning_lines(raw_content):
        if is_heading_or_metadata_line(line):
            continue

        parts = [
            part.strip()
            for part in re.split(r"\s*\n\s*", line)
            if part.strip()
        ]

        for part in parts:
            part = re.sub(r"^(?:[-*•]|\d+[.)])\s*", "", part).strip()
            normalized_part = get_main_topic_title(part).casefold()

            if not part or normalized_part == normalized_heading:
                continue

            if re.match(
                r"^\s*(?:\d+\.)+\d*\s+\S",
                part
            ):
                continue

            if re.match(
                r"^\s*(?:chapter|chương|unit|lesson|module|"
                r"part|bài)\b",
                part,
                flags=re.IGNORECASE
            ):
                continue

            if len(part) > 180:
                sentences = [
                    sentence.strip()
                    for sentence in re.split(
                        r"(?<=[.!?])\s+",
                        part
                    )
                    if sentence.strip()
                ]
                bullets.extend(sentences or [part[:180].rstrip() + "..."])
            else:
                bullets.append(part)

    unique_bullets = []
    seen_bullets = set()

    for bullet in bullets:
        normalized_bullet = bullet.casefold()

        if normalized_bullet in seen_bullets:
            continue

        seen_bullets.add(normalized_bullet)
        unique_bullets.append(bullet)

    return unique_bullets[:5]


def is_structural_heading(value: str) -> bool:
    candidate = re.sub(
        r"^(?:[-*•]|\d+[.)])\s*",
        "",
        str(value or "").strip()
    )

    return bool(
        re.match(
            r"^\s*(?:unit|chapter|lesson|module|part|"
            r"chương|bài)\b",
            candidate,
            flags=re.IGNORECASE
        )
        or re.match(
            r"^\s*\d+(?:\.\d+)+\.?\s+\S",
            candidate
        )
    )


def extract_structural_sections(raw_content: str):
    """Split content when the source explicitly contains Unit/Chapter headings."""
    groups = []
    current_heading = None
    current_lines = []
    preamble = []

    for line in extract_learning_lines(raw_content):
        clean_line = re.sub(
            r"^(?:[-*•]|\d+[.)])\s*",
            "",
            line
        ).strip()

        if is_structural_heading(clean_line):
            if current_heading:
                groups.append((current_heading, current_lines))

            current_heading = get_main_topic_title(clean_line)
            current_lines = []
            continue

        if current_heading:
            current_lines.append(clean_line)
        else:
            preamble.append(clean_line)

    if current_heading:
        groups.append((current_heading, current_lines))

    return preamble, groups


def build_fallback_section(raw_content: str, page_number=None):
    """Create a concise lesson from text when the AI provider is unavailable."""
    lines = extract_learning_lines(raw_content)

    if not lines:
        return None

    first_line = lines[0]
    is_explicit_heading = re.match(
        r"^\s*(?:unit|chapter|lesson|module|part|chương|bài)\b",
        first_line,
        flags=re.IGNORECASE
    )
    looks_like_heading = (
        bool(is_explicit_heading)
        or (
            len(first_line) <= 120
            and not re.search(r"[.!?;:]$", first_line)
            and not first_line.startswith(("-", "•", "*"))
        )
    )

    heading = (
        get_main_topic_title(first_line)
        if looks_like_heading
        else "Nội dung học tập"
    )
    content_lines = lines[1:] if looks_like_heading else lines
    content_text = " ".join(content_lines).strip()

    sentences = [
        sentence.strip()
        for sentence in re.split(
            r"(?<=[.!?])\s+",
            content_text
        )
        if sentence.strip()
    ]

    if not sentences and content_text:
        sentences = [
            item.strip()
            for item in re.split(r"\s*[•-]\s*", content_text)
            if item.strip()
        ]

    if not sentences:
        return None

    return {
        "heading": heading or (
            f"Nội dung trang {page_number}"
            if page_number is not None
            else "Nội dung học tập"
        ),
        "content": "\n".join(sentences[:4])[:700],
        "key_points": [
            point[:220]
            for point in sentences[:4]
            if point.casefold() != heading.casefold()
        ],
        "table": None,
        "subsections": []
    }


def generate_study_dates(
    start_date: date,
    exam_date: date,
    study_days_per_week: int
):
    """
    Tạo danh sách ngày học từ start_date đến trước ngày thi.
    Các ngày học được phân bổ tương đối đều trong từng tuần.
    """

    study_dates = []
    current_date = start_date

    while current_date < exam_date:
        # Xác định ngày cuối tuần (Chủ nhật)
        days_until_sunday = 6 - current_date.weekday()
        week_end = current_date + timedelta(
            days=days_until_sunday
        )

        # Không xếp lịch vào ngày thi hoặc sau ngày thi
        if week_end >= exam_date:
            week_end = exam_date - timedelta(days=1)

        available_dates = []
        day = current_date

        while day <= week_end:
            available_dates.append(day)
            day += timedelta(days=1)

        if not available_dates:
            break

        # Số ngày học tối đa trong tuần này
        number_of_days = min(
            study_days_per_week,
            len(available_dates)
        )

        if number_of_days == 1:
            selected_dates = [available_dates[0]]
        else:
            # Phân bổ đều từ đầu đến cuối khoảng thời gian
            selected_indices = [
                round(
                    i * (len(available_dates) - 1)
                    / (number_of_days - 1)
                )
                for i in range(number_of_days)
            ]

            selected_dates = [
                available_dates[index]
                for index in selected_indices
            ]

        study_dates.extend(selected_dates)

        # Chuyển sang tuần tiếp theo
        current_date = week_end + timedelta(days=1)

    return study_dates

# Khởi tạo ứng dụng
app = FastAPI(
    title="StudyPilot API",
    description="Backend cho nền tảng học tập StudyPilot",
    version="1.0.0"
)

# Cho phép Frontend kết nối
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)




def analyze_chunk_batch(chunks):
    """
    Phân tích các đoạn tài liệu và tạo chủ đề học tập
    có cấu trúc mục, tiểu mục và ý chính.

    Đảm bảo:
    - Chỉ sử dụng chunk_index có trong dữ liệu đầu vào.
    - Không để một chunk bị phân bổ vào nhiều chủ đề.
    - Không bỏ sót chunk khi AI trả thiếu dữ liệu.
    - Nội dung học được chia thành các mục riêng biệt.
    - Chuẩn hóa dữ liệu AI trước khi lưu vào database.
    """

    if not chunks:
        return []

    chunk_contents = []
    valid_chunk_indices = set()
    chunk_by_index = {}

    for chunk in chunks:
        try:
            chunk_index = int(chunk["chunk_index"])
        except (KeyError, TypeError, ValueError):
            continue

        if chunk_index in valid_chunk_indices:
            continue

        valid_chunk_indices.add(chunk_index)
        chunk_by_index[chunk_index] = chunk

        chunk_contents.append({
            "chunk_index": chunk_index,
            "page_number": chunk.get("page_number"),
            "content": str(chunk.get("content") or "")
        })

    if not chunk_contents:
        raise ValueError(
            "Không tìm thấy đoạn tài liệu hợp lệ để phân tích."
        )

    prompt = f"""
Bạn là chuyên gia thiết kế nội dung học tập cho sinh viên đại học.

Nhiệm vụ: phân tích tài liệu, chia thành các chủ đề học tập
và biên soạn nội dung học ngắn gọn, có cấu trúc rõ ràng.

YÊU CẦU PHÂN TÍCH:

1. Chỉ sử dụng kiến thức có trong tài liệu được cung cấp.
2. Không tự bổ sung kiến thức ngoài tài liệu.
3. Giữ nguyên tên chương, mục và tiểu mục nếu tài liệu có.
4. Nếu không có tiêu đề, đặt tên ngắn gọn, đúng nội dung.
5. Không tạo chủ đề trùng lặp.
6. Mỗi chủ đề có hierarchy thể hiện vị trí trong giáo trình.
7. difficulty_level là số nguyên từ 1 đến 5.
8. estimated_minutes là thời gian học dự kiến.
9. source_chunk_indices phải chứa đúng các chunk được sử dụng.
10. Chỉ sử dụng chunk_index xuất hiện trong dữ liệu đầu vào.
11. Không tự tạo chunk_index.
12. Phải phân bổ TOÀN BỘ các chunk đầu vào.
13. Mỗi chunk chỉ được gán vào MỘT chủ đề phù hợp nhất.
14. Nếu đoạn văn là phần tiếp nối của chủ đề trước,
    hãy gộp vào chủ đề đó.

YÊU CẦU QUAN TRỌNG VỀ NỘI DUNG HỌC:

15. Chỉ giữ kiến thức thực sự cần học của chủ đề:
    định nghĩa, từ vựng, quy tắc, đặc điểm, nguyên lý,
    quy trình, công thức, ví dụ và thông tin giải thích.
16. Loại bỏ ngày tháng, số trang, đầu trang, chân trang,
    mục lục, lời chào, quảng cáo, chỉ dẫn thao tác,
    dòng "Tip", "Note", "Lưu ý", "Chú thích" hoặc metadata
    không phải kiến thức của bài.
17. Không sao chép toàn bộ giáo trình thành các đoạn văn dài.
18. Phải nhận diện đúng cấu trúc: tên tài liệu/chương/unit là heading
    hoặc hierarchy; đề mục như Vocabulary, Grammar, Reading là heading;
    phần giải thích và dữ liệu bên dưới mới là content của đề mục đó.
19. Heading chỉ là tên mục; giữ nguyên số mục của tài liệu như
    1.1 hoặc 1.1.1 nếu có, nhưng không đưa nội dung, ngày tháng
    hoặc tên tài liệu vào content.
20. Content phải là phần giải thích kiến thức thật của mục,
    chỉ gồm tối đa 5 ý chính ngắn, mỗi ý một dòng, mỗi ý không quá
    180 ký tự. Không viết thành đoạn văn dài.
    Không được đưa heading, tên tài liệu, tên Unit/Chapter, số mục 1.1
    hoặc nhãn "Tip/Note" vào content.
21. key_points gồm 2-5 ý kiến thức ngắn lấy từ content;
    tuyệt đối không dùng lại heading, tên Unit, dòng Tip,
    dòng Chú thích hoặc tiêu đề phụ làm key_points.
22. Nếu dữ liệu là Vocabulary/Từ vựng, bắt buộc dùng table với
    headers ["Từ", "Loại từ", "Phiên âm", "Nghĩa"], mỗi từ một dòng.
    Không dồn danh sách từ vựng vào content.
23. Nếu dữ liệu có cấu trúc so sánh, phân loại, thuật ngữ,
    công thức hoặc quy trình theo cột, hãy dùng table thay vì
    dồn thành một đoạn văn.
24. Chỉ tạo tiểu mục khi nội dung thực sự có cấu trúc.
25. Không chia nhỏ một ý thành quá nhiều mục vụn vặt.
26. Không lặp lại cùng một kiến thức ở nhiều mục.

CẤU TRÚC content_sections:

Mỗi chủ đề có danh sách content_sections.
Mỗi phần tử gồm:

- heading: tiêu đề mục hoặc tiểu mục.
- content: chuỗi các ý chính ngắn gọn, mỗi ý cách nhau bằng ký tự xuống dòng.
- key_points: danh sách các ý chính.
- table: bảng kiến thức nếu phù hợp, gồm headers và rows.
- subsections: danh sách các tiểu mục con,
  sử dụng cùng cấu trúc trên.

DỮ LIỆU TÀI LIỆU:

{json.dumps(chunk_contents, ensure_ascii=False)}

Trả về JSON theo cấu trúc:

{{
    "topics": [
        {{
            "hierarchy": "Chương 1 > Mục 1.1",
            "name": "Tên chủ đề",
            "description": "Mô tả ngắn gọn chủ đề",
            "difficulty_level": 3,
            "estimated_minutes": 30,
            "source_chunk_indices": [0, 1],
            "content_sections": [
                {{
                    "heading": "Khái niệm cơ bản",
                    "content": "Ý chính thứ nhất.\nÝ chính thứ hai.",
                    "key_points": [
                        "Ý chính thứ nhất",
                        "Ý chính thứ hai"
                    ],
                    "table": {
                        "headers": ["Thuật ngữ", "Ý nghĩa"],
                        "rows": [["address", "địa chỉ"]]
                    },
                    "subsections": [
                        {{
                            "heading": "Đặc điểm",
                            "content": "Ý chính của tiểu mục.",
                            "key_points": [
                                "Đặc điểm quan trọng"
                            ],
                            "subsections": []
                        }}
                    ]
                }}
            ]
        }}
    ]
}}

Chỉ trả về JSON hợp lệ.
"""

    raw_result = generate_text(prompt)
    result = parse_ai_json(raw_result)

    if not isinstance(result, dict):
        raise ValueError(
            "Kết quả phân tích tài liệu không hợp lệ."
        )

    ai_topics = result.get("topics", [])

    if not isinstance(ai_topics, list):
        raise ValueError(
            "Danh sách chủ đề AI trả về không hợp lệ."
        )

    def normalize_section(raw_section, depth=0):
        if not isinstance(raw_section, dict) or depth > 4:
            return None

        raw_heading = str(
            raw_section.get("heading") or ""
        ).strip()

        if not raw_heading:
            return None

        if NON_LEARNING_LINE_PATTERN.match(raw_heading):
            return None

        heading = get_section_heading(raw_heading)

        raw_content = str(
            raw_section.get("content") or ""
        ).strip()
        preamble, structural_sections = (
            extract_structural_sections(raw_content)
        )

        generated_subsections = []

        if structural_sections:
            if is_generic_topic_name(heading):
                heading = structural_sections[0][0]
                content_source = "\n".join(
                    preamble + structural_sections[0][1]
                )
                structural_sections = structural_sections[1:]
            else:
                content_source = raw_content

            for subsection_heading, subsection_lines in (
                structural_sections
            ):
                subsection_content = get_learning_bullets(
                    subsection_heading,
                    "\n".join(subsection_lines)
                )

                if subsection_content:
                    generated_subsections.append({
                        "heading": subsection_heading,
                        "content": "\n".join(subsection_content),
                        "key_points": [],
                        "table": None,
                        "subsections": []
                    })
        else:
            content_source = raw_content

        content = get_learning_bullets(
            heading,
            content_source
        )

        raw_key_points = raw_section.get("key_points", [])
        key_points = []

        if isinstance(raw_key_points, list):
            for point in raw_key_points:
                point_text = str(point or "").strip()

                if point_text and point_text not in key_points:
                    key_points.append(point_text)

                if len(key_points) >= 8:
                    break

        raw_subsections = raw_section.get("subsections", [])
        subsections = []

        if isinstance(raw_subsections, list):
            for child in raw_subsections:
                normalized_child = normalize_section(
                    child,
                    depth + 1
                )

                if normalized_child:
                    subsections.append(normalized_child)

        subsections = generated_subsections + subsections

        key_points = get_content_key_points(
            heading,
            key_points
        )

        table = None
        raw_table = raw_section.get("table")

        if isinstance(raw_table, dict):
            raw_headers = raw_table.get("headers", [])
            raw_rows = raw_table.get("rows", [])

            if (
                isinstance(raw_headers, list)
                and len(raw_headers) >= 2
                and isinstance(raw_rows, list)
            ):
                headers = [
                    str(header).strip()
                    for header in raw_headers
                    if str(header).strip()
                ]
                rows = []

                for raw_row in raw_rows:
                    if not isinstance(raw_row, list):
                        continue

                    row = [
                        str(cell).strip()
                        for cell in raw_row[:len(headers)]
                    ]

                    if len(row) == len(headers) and any(row):
                        rows.append(row)

                if headers and rows:
                    table = {
                        "headers": headers[:6],
                        "rows": rows[:20]
                    }

        vocabulary_heading = re.search(
            r"\b(?:vocabulary|từ vựng)\b",
            heading,
            flags=re.IGNORECASE
        )
        vocabulary_content = re.search(
            r"\b(?:vocabulary|từ vựng)\b",
            raw_content,
            flags=re.IGNORECASE
        )
        if not table and (
            vocabulary_heading
            or (
                vocabulary_content
                and is_generic_topic_name(heading)
            )
        ):
            vocabulary_rows = extract_vocabulary_rows(raw_content)

            if vocabulary_rows:
                table = {
                    "headers": [
                        "Từ",
                        "Loại từ",
                        "Phiên âm",
                        "Nghĩa"
                    ],
                    "rows": vocabulary_rows
                }
                content = []
                key_points = []

        if not content and key_points:
            content = get_learning_bullets(
                heading,
                "\n".join(key_points)
            )

        if not content and not key_points and not table and not subsections:
            return None

        return {
            "heading": heading,
            "content": "\n".join(content),
            "key_points": key_points,
            "table": table,
            "subsections": subsections
        }

    normalized_topics = []
    assigned_chunk_indices = set()

    for topic in ai_topics:
        if not isinstance(topic, dict):
            continue

        raw_indices = topic.get("source_chunk_indices", [])

        if not isinstance(raw_indices, list):
            continue

        topic_indices = []

        for raw_index in raw_indices:
            try:
                chunk_index = int(raw_index)
            except (TypeError, ValueError):
                continue

            if chunk_index not in valid_chunk_indices:
                continue

            if chunk_index in assigned_chunk_indices:
                continue

            if chunk_index in topic_indices:
                continue

            topic_indices.append(chunk_index)

        if not topic_indices:
            continue

        name = str(topic.get("name") or "").strip()

        if not name:
            name = "Chủ đề học tập"

        hierarchy = str(
            topic.get("hierarchy") or "Nội dung giáo trình"
        ).strip()

        description = str(
            topic.get("description") or ""
        ).strip()

        if not description:
            description = (
                "Nội dung học tập được trích xuất từ giáo trình: "
                + name
            )

        try:
            difficulty_level = int(
                topic.get("difficulty_level", 3)
            )
        except (TypeError, ValueError):
            difficulty_level = 3

        difficulty_level = max(
            1,
            min(5, difficulty_level)
        )

        try:
            estimated_minutes = int(
                topic.get("estimated_minutes", 15)
            )
        except (TypeError, ValueError):
            estimated_minutes = 15

        estimated_minutes = max(
            5,
            estimated_minutes
        )

        raw_sections = topic.get("content_sections", [])
        content_sections = []

        if isinstance(raw_sections, list):
            for raw_section in raw_sections:
                normalized_section = normalize_section(
                    raw_section
                )

                if normalized_section:
                    content_sections.append(normalized_section)

        if not content_sections:
            content_sections = [{
                "heading": name,
                "content": description,
                "key_points": [],
                "subsections": []
            }]

        normalized_topics.append({
            "hierarchy": hierarchy,
            "name": name,
            "description": description,
            "difficulty_level": difficulty_level,
            "estimated_minutes": estimated_minutes,
            "source_chunk_indices": topic_indices,
            "content_sections": content_sections
        })

        assigned_chunk_indices.update(topic_indices)

    # Bảo đảm không bỏ sót nội dung khi AI phân tích thiếu chunk.
    missing_chunk_indices = [
        chunk_index
        for chunk_index in sorted(valid_chunk_indices)
        if chunk_index not in assigned_chunk_indices
    ]

    if missing_chunk_indices:
        missing_chunks = [
            chunk_by_index[index]
            for index in missing_chunk_indices
        ]

        page_numbers = sorted({
            str(chunk.get("page_number"))
            for chunk in missing_chunks
            if chunk.get("page_number") is not None
        })

        page_description = (
            " Các trang liên quan: "
            + ", ".join(page_numbers)
            if page_numbers
            else ""
        )

        fallback_sections = []

        for chunk in missing_chunks:
            fallback_section = build_fallback_section(
                chunk.get("content") or "",
                chunk.get("page_number")
            )

            if fallback_section:
                fallback_sections.append(fallback_section)

        normalized_topics.append({
            "hierarchy": "Nội dung bổ sung",
            "name": "Nội dung chưa được phân loại",
            "description": (
                "Các đoạn giáo trình AI chưa phân loại được. "
                "Nội dung gốc vẫn được giữ lại để sinh viên học."
                + page_description
            ),
            "difficulty_level": 2,
            "estimated_minutes": max(
                10,
                len(missing_chunk_indices) * 5
            ),
            "source_chunk_indices": missing_chunk_indices,
            "content_sections": fallback_sections
        })

    if not normalized_topics:
        raise ValueError(
            "AI không tạo được chủ đề học tập từ tài liệu."
        )

    return normalized_topics


# ==============================
# MODEL DỮ LIỆU
# ==============================

class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    description: str | None = None
    color: str = "#8BAF9C"
class ExamPlanCreate(BaseModel):
    subject_id: UUID
    title: str = Field(min_length=1, max_length=150)
    exam_date: date
    daily_available_minutes: int = Field(gt=0)
    study_days_per_week: int = Field(default=6, ge=1, le=7)

class ScheduleCreateRequest(BaseModel):
    selected_study_dates: list[date] = Field(default_factory=list)

class TopicCreate(BaseModel):
    exam_plan_id: UUID
    name: str = Field(min_length=1, max_length=150)
    description: str | None = None
    difficulty_level: int = Field(default=3, ge=1, le=5)
    understanding_level: int = Field(default=3, ge=1, le=5)
    estimated_minutes: int = Field(default=30, gt=0)
    priority: int = Field(default=3, ge=1, le=5)
    status: Literal["not_started", "in_progress", "completed"] = "not_started"

class StudySessionCreate(BaseModel):
    topic_id: UUID
    scheduled_start: datetime
    duration_minutes: int = Field(gt=0)
    source: Literal["manual", "ai"] = "manual"
    notes: str | None = None

class StudySessionUpdate(BaseModel):
    scheduled_start: datetime | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    notes: str | None = None
class FlashcardGenerateRequest(BaseModel):
    material_id: UUID
    topic_id: UUID
    number_of_cards: int = Field(default=5, ge=1, le=20)
class FlashcardReviewCreate(BaseModel):
    flashcard_id: UUID
    rating: int = Field(ge=1, le=4)
    response_time_seconds: int | None = Field(default=None, ge=0)

class QuizGenerateRequest(BaseModel):
    material_id: UUID
    study_session_id: UUID
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    number_of_questions: int = Field(default=10, ge=1, le=20)
    time_limit_minutes: int | None = Field(default=None, gt=0)
class RetakeQuizGenerateRequest(BaseModel):
    number_of_questions: int = Field(
        default=10,
        ge=10,
        le=20,
        multiple_of=10
    )
    time_limit_minutes: int | None = Field(
        default=15,
        gt=0
    )
class QuizAnswerCreate(BaseModel):
    question_id: UUID
    selected_answer: str | list[str]
    response_time_seconds: int | None = Field(
        default=None,
        ge=0
    )


# ==============================
# API CƠ BẢN
# ==============================

@app.get("/")
def home():
    return {
        "message": "Welcome to StudyPilot!",
        "status": "running"
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy"
    }


@app.get("/api/message")
def get_message():
    return {
        "message": "Xin chào! Đây là dữ liệu từ StudyPilot Backend.",
        "source": "FastAPI",
        "status": "success"
    }


# ==============================
# API QUẢN LÝ MÔN HỌC
# ==============================

@app.post("/api/subjects")
def create_subject(subject: SubjectCreate):

    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        response = (
            supabase
            .table("subjects")
            .insert({
                "user_id": DEMO_USER_ID,
                "name": subject.name.strip(),
                "description": subject.description,
                "color": subject.color
            })
            .execute()
        )

        return {
            "message": "Tạo môn học thành công!",
            "data": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo môn học: {str(error)}"
        )


@app.get("/api/subjects")
def get_subjects():

    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        response = (
            supabase
            .table("subjects")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
            .order("created_at", desc=True)
            .execute()
        )

        return {
            "message": "Lấy danh sách môn học thành công!",
            "data": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy danh sách môn học: {str(error)}"
        )
@app.post("/api/exam-plans")
def create_exam_plan(plan: ExamPlanCreate):
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # Kiểm tra môn học có tồn tại và thuộc người dùng không
        subject_response = (
            supabase.table("subjects")
            .select("id")
            .eq("id", str(plan.subject_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not subject_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy môn học hoặc môn học không thuộc người dùng."
            )

        # Tạo kế hoạch ôn thi
        response = (
            supabase.table("exam_plans")
            .insert({
                "user_id": DEMO_USER_ID,
                "subject_id": str(plan.subject_id),
                "title": plan.title.strip(),
                "exam_date": plan.exam_date.isoformat(),
                "daily_available_minutes": plan.daily_available_minutes,
                "study_days_per_week": plan.study_days_per_week
            })
            .execute()
        )

        return {
            "message": "Tạo kế hoạch ôn thi thành công!",
            "data": response.data
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo kế hoạch ôn thi: {str(error)}"
        )



@app.get("/api/exam-plans")
def get_exam_plans():
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # 1. Lấy danh sách kế hoạch
        response = (
            supabase.table("exam_plans")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
            .order("exam_date", desc=False)
            .execute()
        )

        plans = response.data or []

        if not plans:
            return {
                "message": "Chưa có kế hoạch ôn thi.",
                "total_plans": 0,
                "data": []
            }

        # 2. Lấy tất cả chủ đề đang hoạt động
        topics_response = (
            supabase.table("topics")
            .select("id, exam_plan_id")
            .eq("user_id", DEMO_USER_ID)
            .eq("is_active", True)
            .execute()
        )

        topics = topics_response.data or []

        topic_ids = [
            topic["id"]
            for topic in topics
        ]

        # 3. Lấy trạng thái các buổi học
        sessions = []

        if topic_ids:
            for start in range(0, len(topic_ids), 100):
                batch_topic_ids = topic_ids[start:start + 100]

                sessions_response = (
                    supabase.table("study_sessions")
                    .select("id, topic_id, status")
                    .eq("user_id", DEMO_USER_ID)
                    .in_("topic_id", batch_topic_ids)
                    .execute()
                )

                sessions.extend(sessions_response.data or [])

        # 4. Gom chủ đề theo kế hoạch
        topics_by_plan = {}

        for topic in topics:
            plan_id = topic["exam_plan_id"]

            if plan_id not in topics_by_plan:
                topics_by_plan[plan_id] = []

            topics_by_plan[plan_id].append(topic["id"])

        # 5. Gom buổi học theo chủ đề
        sessions_by_topic = {}

        for session in sessions:
            current_topic_id = session["topic_id"]

            if current_topic_id not in sessions_by_topic:
                sessions_by_topic[current_topic_id] = []

            sessions_by_topic[current_topic_id].append(session)

        # 6. Tính tiến độ từng kế hoạch
        results = []

        for plan in plans:
            plan_id = plan["id"]

            plan_topic_ids = topics_by_plan.get(
                plan_id,
                []
            )

            total_topics = len(plan_topic_ids)
            completed_topics = 0

            total_sessions = 0
            completed_sessions = 0

            for current_topic_id in plan_topic_ids:
                topic_sessions = sessions_by_topic.get(
                    current_topic_id,
                    []
                )

                total_sessions += len(topic_sessions)

                completed_count = sum(
                    1
                    for session in topic_sessions
                    if session.get("status") == "completed"
                )

                completed_sessions += completed_count

                # Một chủ đề hoàn thành khi có buổi học
                # và tất cả buổi học của chủ đề đã hoàn thành
                if (
                    topic_sessions
                    and completed_count == len(topic_sessions)
                ):
                    completed_topics += 1

            topic_progress = (
                round(
                    completed_topics / total_topics * 100,
                    2
                )
                if total_topics > 0
                else 0
            )

            session_progress = (
                round(
                    completed_sessions / total_sessions * 100,
                    2
                )
                if total_sessions > 0
                else 0
            )

            results.append({
                **plan,
                "total_topics": total_topics,
                "completed_topics": completed_topics,
                "topic_progress_percent": topic_progress,
                "total_sessions": total_sessions,
                "completed_sessions": completed_sessions,
                "remaining_sessions": (
                    total_sessions - completed_sessions
                ),
                "session_progress_percent": session_progress
            })

        return {
            "message": "Lấy danh sách kế hoạch thành công!",
            "total_plans": len(results),
            "data": results
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy danh sách kế hoạch: {str(error)}"
        )

@app.post("/api/topics")
def create_topic(topic: TopicCreate):
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # Kiểm tra kế hoạch ôn thi có thuộc người dùng không
        plan_response = (
            supabase.table("exam_plans")
            .select("id")
            .eq("id", str(topic.exam_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not plan_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn thi."
            )

        # Tạo chủ đề
        response = (
            supabase.table("topics")
            .insert({
                "user_id": DEMO_USER_ID,
                "exam_plan_id": str(topic.exam_plan_id),
                "name": topic.name.strip(),
                "description": topic.description,
                "difficulty_level": topic.difficulty_level,
                "understanding_level": topic.understanding_level,
                "estimated_minutes": topic.estimated_minutes,
                "priority": topic.priority,
                "status": topic.status
            })
            .execute()
        )

        return {
            "message": "Tạo chủ đề ôn tập thành công!",
            "data": response.data
        }

    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo chủ đề: {str(error)}"
        )



@app.get("/api/topics")
def get_topics(exam_plan_id: UUID | None = None):
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # Khi có plan_id, chỉ lấy chủ đề của kế hoạch đó.
        query = (
            supabase.table("topics")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
            .eq("is_active", True)
        )

        if exam_plan_id:
            plan_response = (
                supabase.table("exam_plans")
                .select("id")
                .eq("id", str(exam_plan_id))
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if not plan_response.data:
                raise HTTPException(
                    status_code=404,
                    detail="Không tìm thấy kế hoạch ôn thi."
                )

            query = query.eq("exam_plan_id", str(exam_plan_id))

        response = query.order("created_at", desc=True).execute()
        topics = response.data or []

        return {
            "message": "Lấy danh sách chủ đề thành công!",
            "exam_plan_id": (
                str(exam_plan_id)
                if exam_plan_id
                else None
            ),
            "total_topics": len(topics),
            "data": topics
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy danh sách chủ đề: {str(error)}"
        )

@app.post("/api/study-sessions")
def create_study_session(session: StudySessionCreate):
    try:
        # 1. Kiểm tra chủ đề có tồn tại không
        topic_response = (
            supabase
            .table("topics")
            .select("id, exam_plan_id")
            .eq("id", str(session.topic_id))
            .execute()
        )

        if not topic_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy chủ đề ôn tập."
            )

        topic = topic_response.data[0]

        # 2. Kiểm tra kế hoạch thuộc người dùng hiện tại
        plan_response = (
            supabase
            .table("exam_plans")
            .select("id")
            .eq("id", topic["exam_plan_id"])
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not plan_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn thi."
            )

        # 3. Tạo buổi học
        response = (
            supabase
            .table("study_sessions")
            .insert({
                "user_id": DEMO_USER_ID,
                "topic_id": str(session.topic_id),
                "scheduled_start": session.scheduled_start.isoformat(),
                "duration_minutes": session.duration_minutes,
                "status": "scheduled",
                "source": session.source,
                "notes": session.notes
            })
            .execute()
        )

        return {
            "message": "Tạo buổi học thành công!",
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo buổi học: {str(error)}"
        )


@app.post("/api/exam-plans/{exam_plan_id}/generate-schedule")
def generate_exam_schedule(
    exam_plan_id: UUID,
    schedule_request: ScheduleCreateRequest | None = None
):
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # 1. Lấy thông tin kế hoạch ôn thi
        plan_response = (
            supabase.table("exam_plans")
            .select(
                "id, exam_date, daily_available_minutes, study_days_per_week"
            )
            .eq("id", str(exam_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not plan_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn thi."
            )

        plan = plan_response.data[0]

        daily_minutes = int(
            plan.get("daily_available_minutes") or 0
        )
        study_days = int(
            plan.get("study_days_per_week") or 0
        )
        exam_date = date.fromisoformat(plan["exam_date"])

        if daily_minutes <= 0:
            raise HTTPException(
                status_code=400,
                detail="Thời lượng học mỗi ngày không hợp lệ."
            )

        if study_days <= 0 or study_days > 7:
            raise HTTPException(
                status_code=400,
                detail="Số ngày học mỗi tuần phải từ 1 đến 7."
            )

        
        # 2. Bắt đầu lịch học ngay hôm nay theo giờ Việt Nam
        vietnam_timezone = timezone(timedelta(hours=7))
        today = datetime.now(vietnam_timezone).date()
        start_date = today

        if start_date >= exam_date:
            raise HTTPException(
                status_code=400,
                detail="Không còn đủ thời gian để tạo lịch học trước ngày thi."
            )

        # 3. Dùng đúng các ngày người dùng đã chọn nếu có.
        selected_dates = (
            schedule_request.selected_study_dates
            if schedule_request
            else []
        )

        if selected_dates:
            if len(selected_dates) != len(set(selected_dates)):
                raise HTTPException(
                    status_code=400,
                    detail="Danh sách ngày học không được chứa ngày trùng nhau."
                )

            for selected_date in selected_dates:
                if selected_date < start_date or selected_date >= exam_date:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "Ngày học phải nằm từ hôm nay đến trước ngày thi."
                        )
                    )

            week_counts = {}

            for selected_date in selected_dates:
                week_index = (selected_date - start_date).days // 7
                week_counts[week_index] = (
                    week_counts.get(week_index, 0) + 1
                )

            if any(
                count > study_days
                for count in week_counts.values()
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Số ngày học trong một tuần không được vượt quá "
                        f"{study_days} ngày đã chọn."
                    )
                )

            study_dates = sorted(selected_dates)
        else:
            study_dates = generate_study_dates(
                start_date=start_date,
                exam_date=exam_date,
                study_days_per_week=study_days
            )

        study_dates = sorted(set(study_dates))

        if not study_dates:
            raise HTTPException(
                status_code=400,
                detail="Không tìm được ngày học phù hợp."
            )

        # 4. Lấy các chủ đề AI đang hoạt động
        topics_response = (
            supabase.table("topics")
            .select(
                "id, name, hierarchy, estimated_minutes, source_chunk_ids"
            )
            .eq("user_id", DEMO_USER_ID)
            .eq("exam_plan_id", str(exam_plan_id))
            .eq("source_type", "ai")
            .eq("is_active", True)
            .order("created_at")
            .execute()
        )

        topics = topics_response.data or []

        if not topics:
            raise HTTPException(
                status_code=400,
                detail="Chưa có chủ đề AI. Hãy phân tích tài liệu trước."
            )

        # 5. Kiểm tra lịch AI đã tồn tại hay chưa
        topic_ids = [
            topic["id"]
            for topic in topics
        ]

        existing_response = (
            supabase.table("study_sessions")
            .select("id")
            .eq("user_id", DEMO_USER_ID)
            .eq("source", "ai")
            .in_("topic_id", topic_ids)
            .limit(1)
            .execute()
        )

        if existing_response.data:
            raise HTTPException(
                status_code=409,
                detail="Kế hoạch này đã có lịch học AI."
            )

        # 6. Chuẩn bị nội dung và kiểm tra chunks trùng lặp
        topic_chunks = {}
        all_chunk_ids = set()

        for topic in topics:
            chunk_ids = list(dict.fromkeys(
                str(chunk_id)
                for chunk_id in (topic.get("source_chunk_ids") or [])
            ))

            if not chunk_ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Chủ đề '{topic['name']}' chưa có nội dung "
                        "được phân bổ. Hãy phân tích lại tài liệu."
                    )
                )

            duplicate_ids = all_chunk_ids.intersection(chunk_ids)

            if duplicate_ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Phát hiện nội dung bị phân bổ trùng giữa "
                        "các chủ đề. Hãy kiểm tra lại dữ liệu tài liệu."
                    )
                )

            all_chunk_ids.update(chunk_ids)
            topic_chunks[str(topic["id"])] = chunk_ids

        # 7. Kiểm tra tất cả chunks thực sự tồn tại
        all_chunk_id_list = list(all_chunk_ids)

        existing_chunks = []

        for i in range(0, len(all_chunk_id_list), 100):
            batch_ids = all_chunk_id_list[i:i + 100]

            chunk_response = (
                supabase.table("material_chunks")
                .select("id, chunk_index")
                .eq("user_id", DEMO_USER_ID)
                .in_("id", batch_ids)
                .execute()
            )

            existing_chunks.extend(
                chunk_response.data or []
            )

        existing_chunk_ids = {
            str(item["id"])
            for item in existing_chunks
        }
        chunk_index_by_id = {
            str(item["id"]): int(item.get("chunk_index") or 0)
            for item in existing_chunks
        }
        missing_chunk_ids = all_chunk_ids - existing_chunk_ids

        if missing_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Một số nội dung tài liệu không còn tồn tại. "
                    "Hãy phân tích lại tài liệu trước khi tạo lịch."
                )
            )

        # 8. Phân bổ nội dung theo đúng thứ tự chunk trong tài liệu.
        # Gom tất cả chunk của các chủ đề rồi sắp xếp toàn cục theo chunk_index,
        # tránh trường hợp một chủ đề có các chunk rải rác làm đảo thứ tự chương.
        ordered_assignments = []

        for topic in topics:
            topic_id = str(topic["id"])
            topic_chunk_ids = topic_chunks[topic_id]
            hierarchy = str(topic.get("hierarchy") or "").strip()
            chapter_key = hierarchy.split(">")[0].strip() or topic_id
            topic["chapter_key"] = chapter_key

            estimated_minutes = max(
                1,
                int(topic.get("estimated_minutes") or 30)
            )
            minutes_per_chunk = max(
                1,
                (
                    estimated_minutes + len(topic_chunk_ids) - 1
                ) // len(topic_chunk_ids)
            )

            for chunk_id in topic_chunk_ids:
                ordered_assignments.append({
                    "topic": topic,
                    "topic_id": topic_id,
                    "chunk_id": chunk_id,
                    "chunk_index": chunk_index_by_id.get(chunk_id, 0),
                    "minutes": min(minutes_per_chunk, daily_minutes),
                    "chapter_key": chapter_key
                })

        ordered_assignments.sort(
            key=lambda item: item["chunk_index"]
        )

        session_lookup = {}
        day_loads = [0 for _ in study_dates]
        day_assignment_counts = [0 for _ in study_dates]
        overflow_slots = {}
        assigned_chunk_ids = set()
        current_day_index = 0
        last_chapter_key = None

        for assignment_index, assignment in enumerate(
            ordered_assignments
        ):
            topic = assignment["topic"]
            topic_id = assignment["topic_id"]
            chunk_id = assignment["chunk_id"]
            chunk_minutes = assignment["minutes"]
            chapter_key = assignment["chapter_key"]

            if chunk_id in assigned_chunk_ids:
                continue

            if (
                last_chapter_key is not None
                and chapter_key != last_chapter_key
                and day_assignment_counts[current_day_index] > 0
                and current_day_index + 1 < len(study_dates)
            ):
                current_day_index += 1

            # Phân bổ đều các phần nội dung qua toàn bộ ngày đã chọn.
            # Khi số phần còn lại đủ cho số ngày còn lại, chuyển ngày
            # sau khi đạt số phần mục tiêu của ngày hiện tại.
            remaining_assignments = (
                len(ordered_assignments) - assignment_index
            )
            remaining_days = len(study_dates) - current_day_index
            target_assignments = max(
                1,
                (
                    remaining_assignments + remaining_days - 1
                ) // remaining_days
            )

            if (
                day_assignment_counts[current_day_index] > 0
                and day_assignment_counts[current_day_index]
                >= target_assignments
                and current_day_index + 1 < len(study_dates)
            ):
                current_day_index += 1

            # Chuyển ngày khi ngày hiện tại không còn đủ thời lượng.
            while (
                current_day_index < len(study_dates)
                and day_loads[current_day_index] + chunk_minutes > daily_minutes
            ):
                if current_day_index + 1 < len(study_dates):
                    current_day_index += 1
                    continue

                # Không bỏ toàn bộ kế hoạch khi tài liệu dài hơn
                # tổng sức chứa trước ngày thi. Tạo thêm một slot học
                # trong ngày cuối để vẫn lưu đủ nội dung tài liệu.
                last_date_key = study_dates[-1].isoformat()
                overflow_slots[last_date_key] = (
                    overflow_slots.get(last_date_key, 0) + 1
                )
                current_day_index = len(study_dates) - 1
                day_loads[current_day_index] = 0
                day_assignment_counts[current_day_index] = 0
                break

            study_date = study_dates[current_day_index]
            scheduled_start = datetime.combine(
                study_date,
                datetime.min.time(),
                tzinfo=timezone.utc
            )

            session_key = (
                topic_id,
                study_date.isoformat(),
                overflow_slots.get(study_date.isoformat(), 0)
            )

            if session_key not in session_lookup:
                session_lookup[session_key] = {
                    "user_id": DEMO_USER_ID,
                    "topic_id": topic["id"],
                    "scheduled_start": scheduled_start.isoformat(),
                    "duration_minutes": 0,
                    "status": "scheduled",
                    "source": "ai",
                    "notes": (
                        topic.get("hierarchy")
                        or topic["name"]
                    ),
                    "source_chunk_ids": []
                }

            session_record = session_lookup[session_key]
            session_record["source_chunk_ids"].append(chunk_id)
            session_record["duration_minutes"] += chunk_minutes
            day_loads[current_day_index] += chunk_minutes
            day_assignment_counts[current_day_index] += 1
            assigned_chunk_ids.add(chunk_id)
            last_chapter_key = chapter_key

        session_records = list(session_lookup.values())

        if not session_records:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Không tìm thấy nội dung tài liệu hợp lệ "
                    "để phân bổ vào lịch học."
                )
            )

        # 9. Kiểm tra nội dung và thời lượng trước khi lưu
        for session in session_records:
            if not session["source_chunk_ids"]:
                raise HTTPException(
                    status_code=400,
                    detail="Phát hiện buổi học không có nội dung."
                )

            if session["duration_minutes"] > daily_minutes:
                raise HTTPException(
                    status_code=400,
                    detail="Thời lượng buổi học vượt giới hạn mỗi ngày."
                )

        if assigned_chunk_ids != all_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail="Phân bổ nội dung chưa đầy đủ."
            )

        # Kiểm tra tổng thời lượng từng ngày
        for day_index, total_minutes in enumerate(day_loads):
            if total_minutes > daily_minutes:
                raise HTTPException(
                    status_code=400,
                    detail="Tổng thời lượng trong ngày vượt giới hạn."
                )

        # 10. Lưu lịch học vào Supabase
        for i in range(0, len(session_records), 100):
            batch = session_records[i:i + 100]

            supabase.table("study_sessions").insert(
                batch
            ).execute()

        # 11. Trả kết quả
        return {
            "message": "Tạo lịch học AI thành công!",
            "exam_plan_id": str(exam_plan_id),
            "total_available_study_days": len(study_dates),
            "total_study_days": len({
                item["scheduled_start"][:10]
                for item in session_records
            }),
            "total_sessions": len(session_records),
            "total_topics": len(topics),
            "total_chunks": len(assigned_chunk_ids),
            "daily_loads": [
                {
                    "date": study_dates[index].isoformat(),
                    "minutes": day_loads[index],
                    "capacity_minutes": daily_minutes
                }
                for index in range(len(study_dates))
            ],
            "data": session_records
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo lịch học: {str(error)}"
        )
        


def _has_passed_session_quiz(previous_session):
    """
    Kiểm tra người học đã vượt qua Quiz của một buổi học hay chưa.

    Điều kiện:
    - Buổi học đã hoàn thành.
    - Quiz gốc đạt từ 50%; hoặc
    - Quiz gốc dưới 50% nhưng đã hoàn thành Review Plan.
    """
    if previous_session.get("status") != "completed":
        return False

    previous_session_id = str(previous_session["id"])

    quiz_response = (
        supabase.table("quizzes")
        .select("id")
        .eq("user_id", DEMO_USER_ID)
        .eq("study_session_id", previous_session_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )

    if not quiz_response.data:
        return False

    original_quiz_id = str(quiz_response.data[0]["id"])

    attempt_response = (
        supabase.table("quiz_attempts")
        .select("id, score, status, submitted_at")
        .eq("user_id", DEMO_USER_ID)
        .eq("quiz_id", original_quiz_id)
        .eq("status", "submitted")
        .order("submitted_at", desc=True)
        .limit(1)
        .execute()
    )

    if not attempt_response.data:
        return False

    original_attempt = attempt_response.data[0]

    if float(original_attempt.get("score") or 0) >= 50:
        return True

    assessment_response = (
        supabase.table("quiz_assessments")
        .select("id")
        .eq(
            "quiz_attempt_id",
            str(original_attempt["id"])
        )
        .eq("user_id", DEMO_USER_ID)
        .limit(1)
        .execute()
    )

    if not assessment_response.data:
        return False

    assessment_id = str(assessment_response.data[0]["id"])

    review_response = (
        supabase.table("review_plans")
        .select("id, status")
        .eq("assessment_id", assessment_id)
        .eq("user_id", DEMO_USER_ID)
        .limit(1)
        .execute()
    )

    if not review_response.data:
        return False

    return review_response.data[0].get("status") == "completed"


def _is_study_session_unlocked(current_session, all_sessions):
    """
    Chỉ mở buổi học khi tất cả buổi học thuộc những ngày trước
    trong cùng kế hoạch đã vượt qua Quiz.
    Các buổi học cùng ngày không khóa lẫn nhau.
    """
    current_scheduled_start = current_session.get("scheduled_start")

    if not current_scheduled_start:
        return False

    try:
        current_study_day = datetime.fromisoformat(
            str(current_scheduled_start).replace("Z", "+00:00")
        ).date()
    except (ValueError, TypeError):
        return False

    for previous_session in all_sessions:
        if str(previous_session.get("id")) == str(current_session.get("id")):
            continue

        previous_scheduled_start = previous_session.get("scheduled_start")

        if not previous_scheduled_start:
            continue

        try:
            previous_study_day = datetime.fromisoformat(
                str(previous_scheduled_start).replace("Z", "+00:00")
            ).date()
        except (ValueError, TypeError):
            continue

        if previous_study_day < current_study_day:
            if not _has_passed_session_quiz(previous_session):
                return False

    return True

@app.post("/api/study-sessions/{session_id}/start")
def start_study_session(session_id: UUID):
    """Start or resume a study session with sequential lesson unlocking."""
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # 1. Lấy buổi học hiện tại
        existing_response = (
            supabase.table("study_sessions")
            .select(
                "id, topic_id, scheduled_start, status, started_at, "
                "last_activity_at, actual_study_seconds"
            )
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not existing_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy buổi học."
            )

        study_session = existing_response.data[0]
        current_status = study_session.get("status")

        if current_status == "completed":
            return {
                "message": "Buổi học này đã hoàn thành.",
                "data": study_session,
                "resumed": False
            }

        # 2. Kiểm tra ngày học và kế hoạch tương ứng
        scheduled_value = study_session.get("scheduled_start")

        if not scheduled_value:
            raise HTTPException(
                status_code=400,
                detail="Buổi học chưa có thời gian bắt đầu hợp lệ."
            )

        try:
            current_scheduled_start = datetime.fromisoformat(
                scheduled_value.replace("Z", "+00:00")
            )
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="Thời gian học không hợp lệ."
            )

        current_study_day = current_scheduled_start.date()
        current_topic_id = study_session.get("topic_id")

        if not current_topic_id:
            raise HTTPException(
                status_code=400,
                detail="Buổi học chưa được liên kết với chủ đề."
            )

        topic_response = (
            supabase.table("topics")
            .select("id, exam_plan_id")
            .eq("id", str(current_topic_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not topic_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy chủ đề của buổi học."
            )

        exam_plan_id = topic_response.data[0].get("exam_plan_id")

        if not exam_plan_id:
            raise HTTPException(
                status_code=400,
                detail="Chủ đề chưa được liên kết với kế hoạch ôn thi."
            )

        # 3. Lấy tất cả chủ đề thuộc cùng kế hoạch
        topics_response = (
            supabase.table("topics")
            .select("id")
            .eq("exam_plan_id", str(exam_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("is_active", True)
            .execute()
        )

        topic_ids = [
            str(topic["id"])
            for topic in (topics_response.data or [])
        ]

        # Luôn giữ chủ đề của buổi học hiện tại
        if str(current_topic_id) not in topic_ids:
            topic_ids.append(str(current_topic_id))

        if not topic_ids:
            raise HTTPException(
                status_code=404,
                detail="Kế hoạch chưa có chủ đề học tập."
            )

        # 4. Lấy tất cả buổi học trong cùng kế hoạch
        sessions_response = (
            supabase.table("study_sessions")
            .select("id, topic_id, scheduled_start, status")
            .eq("user_id", DEMO_USER_ID)
            .in_("topic_id", topic_ids)
            .order("scheduled_start")
            .execute()
        )

        all_sessions = sessions_response.data or []

        # 5. Kiểm tra Quiz của từng buổi học trước đó
        def has_passed_session_quiz(previous_session):
            if previous_session.get("status") != "completed":
                return False

            previous_session_id = str(previous_session["id"])

            # Tìm Quiz gốc của buổi học
            previous_quiz_response = (
                supabase.table("quizzes")
                .select("id")
                .eq("user_id", DEMO_USER_ID)
                .eq("study_session_id", previous_session_id)
                .eq("status", "active")
                .limit(1)
                .execute()
            )

            if not previous_quiz_response.data:
                return False

            original_quiz_id = str(
                previous_quiz_response.data[0]["id"]
            )

            # Lấy lượt làm Quiz gốc gần nhất đã nộp
            attempt_response = (
                supabase.table("quiz_attempts")
                .select("id, score, status, submitted_at")
                .eq("user_id", DEMO_USER_ID)
                .eq("quiz_id", original_quiz_id)
                .eq("status", "submitted")
                .order("submitted_at", desc=True)
                .limit(1)
                .execute()
            )

            if not attempt_response.data:
                return False

            original_attempt = attempt_response.data[0]
            original_score = float(
                original_attempt.get("score") or 0
            )

            # Quiz gốc đạt từ 50% trở lên
            if original_score >= 50:
                return True

            # Quiz gốc dưới 50%: tìm AI Assessment
            assessment_response = (
                supabase.table("quiz_assessments")
                .select("id")
                .eq(
                    "quiz_attempt_id",
                    str(original_attempt["id"])
                )
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if not assessment_response.data:
                return False

            assessment_id = str(
                assessment_response.data[0]["id"]
            )

            # Tìm kế hoạch ôn tập liên kết với Assessment
            review_response = (
                supabase.table("review_plans")
                .select("id, status")
                .eq("assessment_id", assessment_id)
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if not review_response.data:
                return False

            review_plan = review_response.data[0]

            # Review Plan chỉ hoàn thành khi Retake Quiz đạt yêu cầu
            return review_plan.get("status") == "completed"

        # Chỉ kiểm tra các ngày trước ngày của buổi học hiện tại.
        # Các buổi học cùng ngày không khóa lẫn nhau.
        for previous_session in all_sessions:
            if str(previous_session["id"]) == str(session_id):
                continue

            previous_scheduled_value = previous_session.get(
                "scheduled_start"
            )

            if not previous_scheduled_value:
                continue

            try:
                previous_study_day = datetime.fromisoformat(
                    previous_scheduled_value.replace("Z", "+00:00")
                ).date()
            except (ValueError, TypeError):
                continue

            if previous_study_day < current_study_day:
                if not has_passed_session_quiz(previous_session):
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "Bài học đang bị khóa. Bạn cần hoàn thành "
                            "toàn bộ bài học và đạt ít nhất 50% Quiz "
                            "của những ngày học trước đó."
                        )
                    )

        # 6. Kiểm tra trạng thái buổi học
        now = datetime.now(timezone.utc)

        if current_status == "in_progress":
            # Tiếp tục buổi học, không đặt lại thời gian đã tích lũy
            response = (
                supabase.table("study_sessions")
                .update({
                    "last_activity_at": now.isoformat(),
                    "updated_at": now.isoformat()
                })
                .eq("id", str(session_id))
                .eq("user_id", DEMO_USER_ID)
                .eq("status", "in_progress")
                .execute()
            )

            if not response.data:
                raise HTTPException(
                    status_code=409,
                    detail="Buổi học vừa được cập nhật. Vui lòng tải lại."
                )

            return {
                "message": "Đã tiếp tục buổi học.",
                "data": response.data[0],
                "resumed": True
            }

        if current_status != "scheduled":
            raise HTTPException(
                status_code=400,
                detail="Buổi học không ở trạng thái có thể bắt đầu."
            )

        # 7. Bắt đầu buổi học
        # Không kiểm tra ngày lịch nữa vì thứ tự mở bài
        # đã được kiểm soát bằng kết quả học tập phía trên.
        response = (
            supabase.table("study_sessions")
            .update({
                "status": "in_progress",
                "started_at": now.isoformat(),
                "last_activity_at": now.isoformat(),
                "actual_study_seconds": int(
                    study_session.get("actual_study_seconds") or 0
                ),
                "updated_at": now.isoformat()
            })
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "scheduled")
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=409,
                detail="Buổi học đã được cập nhật. Vui lòng tải lại."
            )

        return {
            "message": "Bắt đầu buổi học thành công!",
            "data": response.data[0],
            "resumed": False
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể bắt đầu buổi học: {str(error)}"
        )


@app.post("/api/study-sessions/{session_id}/activity")
def record_study_activity(
    session_id: UUID,
    action: str = "heartbeat"
):
    try:
        if action not in ("heartbeat", "pause", "resume"):
            raise HTTPException(
                status_code=400,
                detail="Thao tác ghi nhận thời gian không hợp lệ."
            )

        # 1. Lấy thông tin buổi học
        existing_response = (
            supabase
            .table("study_sessions")
            .select(
                "id, status, last_activity_at, actual_study_seconds"
            )
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not existing_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy buổi học."
            )

        study_session = existing_response.data[0]

        if study_session["status"] != "in_progress":
            raise HTTPException(
                status_code=400,
                detail="Buổi học hiện không ở trạng thái đang học."
            )

        last_activity = study_session.get("last_activity_at")
        current_seconds = int(
            study_session.get("actual_study_seconds") or 0
        )

        now = datetime.now(timezone.utc)

        # 2. Tạm dừng: chốt thời gian của phiên học hiện tại
        if action == "pause" and not last_activity:
            return {
                "message": "Buổi học đã được tạm dừng.",
                "actual_study_seconds": current_seconds,
                "credited_seconds": 0,
                "is_paused": True
            }

        # 3. Tính thời gian từ mốc hoạt động gần nhất
        credited_seconds = 0

        if last_activity:
            last_activity_time = datetime.fromisoformat(
                last_activity.replace("Z", "+00:00")
            )

            if last_activity_time.tzinfo is None:
                last_activity_time = last_activity_time.replace(
                    tzinfo=timezone.utc
                )

            elapsed_seconds = int(
                (now - last_activity_time).total_seconds()
            )

            # Chỉ tính khoảng thời gian có heartbeat hợp lệ
            if 0 <= elapsed_seconds <= 60:
                credited_seconds = elapsed_seconds

        total_seconds = current_seconds + credited_seconds

        # 4. Xác định mốc hoạt động tiếp theo
        if action == "pause":
            next_activity_at = None
        else:
            next_activity_at = now.isoformat()

        update_data = {
            "actual_study_seconds": total_seconds,
            "last_activity_at": next_activity_at,
            "updated_at": now.isoformat()
        }

        # 5. Cập nhật có đối chiếu mốc cũ để tránh cộng trùng
        update_query = (
            supabase
            .table("study_sessions")
            .update(update_data)
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "in_progress")
        )

        if last_activity is None:
            update_query = update_query.is_(
                "last_activity_at",
                "null"
            )
        else:
            update_query = update_query.eq(
                "last_activity_at",
                last_activity
            )

        response = update_query.execute()

        if not response.data:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Buổi học vừa được cập nhật ở một yêu cầu khác. "
                    "Vui lòng thử lại."
                )
            )

        return {
            "message": (
                "Đã tạm dừng buổi học."
                if action == "pause"
                else "Đã ghi nhận hoạt động học tập."
            ),
            "actual_study_seconds": total_seconds,
            "credited_seconds": credited_seconds,
            "minimum_required_seconds": 300,
            "is_eligible_for_quiz": total_seconds >= 300,
            "is_paused": action == "pause"
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể ghi nhận thời gian học: {str(error)}"
        )

@app.post("/api/study-sessions/{session_id}/complete")
def complete_study_session(session_id: UUID):
    try:
        # 1. Lấy thông tin buổi học
        existing_response = (
            supabase
            .table("study_sessions")
            .select(
                "id, status, last_activity_at, actual_study_seconds"
            )
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not existing_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy buổi học."
            )

        study_session = existing_response.data[0]

        # 2. Kiểm tra trạng thái
        if study_session["status"] != "in_progress":
            raise HTTPException(
                status_code=400,
                detail="Buổi học chưa được bắt đầu hoặc đã hoàn thành."
            )

        last_activity = study_session.get("last_activity_at")

        if not last_activity:
            raise HTTPException(
                status_code=400,
                detail="Không tìm thấy thời gian hoạt động gần nhất."
            )

        # 3. Tính thời gian hoạt động cuối cùng
        last_activity_time = datetime.fromisoformat(
            last_activity.replace("Z", "+00:00")
        )

        if last_activity_time.tzinfo is None:
            last_activity_time = last_activity_time.replace(
                tzinfo=timezone.utc
            )

        now = datetime.now(timezone.utc)

        elapsed_seconds = int(
            (now - last_activity_time).total_seconds()
        )

        if 0 <= elapsed_seconds <= 60:
            credited_seconds = elapsed_seconds
        else:
            credited_seconds = 0

        current_seconds = int(
            study_session.get("actual_study_seconds") or 0
        )

        total_seconds = current_seconds + credited_seconds

        # 4. Lưu thời gian và đối chiếu hoạt động gần nhất
        time_response = (
            supabase
            .table("study_sessions")
            .update({
                "actual_study_seconds": total_seconds,
                "last_activity_at": now.isoformat(),
                "updated_at": now.isoformat()
            })
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "in_progress")
            .eq("last_activity_at", last_activity)
            .execute()
        )

        if not time_response.data:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Buổi học vừa được cập nhật ở một yêu cầu khác. "
                    "Vui lòng tải lại."
                )
            )


        # 5. Bắt buộc học tối thiểu 5 phút
        required_seconds = 5 * 60

        if total_seconds < required_seconds:
            remaining_seconds = required_seconds - total_seconds
            remaining_minutes = (remaining_seconds + 59) // 60

            raise HTTPException(
                status_code=400,
                detail=(
                    f"Bạn cần học thêm khoảng {remaining_minutes} phút "
                    "trước khi hoàn thành buổi học."
                )
            )

        # 6. Đánh dấu hoàn thành
        response = (
            supabase
            .table("study_sessions")
            .update({
                "status": "completed",
                "completed_at": now.isoformat(),
                "updated_at": now.isoformat()
            })
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "in_progress")
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=409,
                detail="Buổi học đã được cập nhật. Vui lòng tải lại."
            )

        return {
            "message": "Bạn đã hoàn thành buổi học!",
            "actual_study_seconds": total_seconds,
            "required_study_seconds": required_seconds,
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể hoàn thành buổi học: {str(error)}"
        )


@app.get("/api/study-sessions")
def get_study_sessions(
    topic_id: UUID | None = None,
    exam_plan_id: UUID | None = None
):
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        effective_plan_id = (
            str(exam_plan_id) if exam_plan_id else None
        )

        # 1. Kiểm tra kế hoạch nếu có bộ lọc
        if exam_plan_id:
            plan_response = (
                supabase.table("exam_plans")
                .select("id")
                .eq("id", str(exam_plan_id))
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if not plan_response.data:
                raise HTTPException(
                    status_code=404,
                    detail="Không tìm thấy kế hoạch ôn thi."
                )

        # 2. Kiểm tra chủ đề nếu có bộ lọc
        if topic_id:
            topic_response = (
                supabase.table("topics")
                .select("id, exam_plan_id")
                .eq("id", str(topic_id))
                .eq("user_id", DEMO_USER_ID)
                .eq("is_active", True)
                .limit(1)
                .execute()
            )

            if not topic_response.data:
                raise HTTPException(
                    status_code=404,
                    detail="Không tìm thấy chủ đề."
                )

            topic = topic_response.data[0]
            topic_plan_id = str(topic.get("exam_plan_id") or "")

            if (
                effective_plan_id
                and topic_plan_id != effective_plan_id
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Chủ đề không thuộc kế hoạch ôn thi đã chọn."
                )

            effective_plan_id = topic_plan_id

        # 3. Lấy tất cả buổi học cần thiết để kiểm tra thứ tự mở khóa
        if effective_plan_id:
            topics_response = (
                supabase.table("topics")
                .select("id")
                .eq("exam_plan_id", effective_plan_id)
                .eq("user_id", DEMO_USER_ID)
                .eq("is_active", True)
                .execute()
            )

            topic_ids = [
                str(item["id"])
                for item in (topics_response.data or [])
            ]

            if not topic_ids:
                return {
                    "total_sessions": 0,
                    "completed_sessions": 0,
                    "remaining_sessions": 0,
                    "progress_percent": 0,
                    "data": []
                }

            sessions_response = (
                supabase.table("study_sessions")
                .select("*")
                .eq("user_id", DEMO_USER_ID)
                .in_("topic_id", topic_ids)
                .order("scheduled_start")
                .execute()
            )

            all_sessions = sessions_response.data or []

            # Nếu lọc theo chủ đề, chỉ trả về chủ đề đó.
            sessions = [
                session
                for session in all_sessions
                if (
                    not topic_id
                    or str(session.get("topic_id")) == str(topic_id)
                )
            ]

            plan_sessions = {
                effective_plan_id: all_sessions
            }

        else:
            # Không lọc kế hoạch: lấy toàn bộ buổi học của người dùng.
            sessions_response = (
                supabase.table("study_sessions")
                .select("*")
                .eq("user_id", DEMO_USER_ID)
                .order("scheduled_start")
                .execute()
            )

            all_sessions = sessions_response.data or []

            if topic_id:
                sessions = [
                    session
                    for session in all_sessions
                    if str(session.get("topic_id")) == str(topic_id)
                ]
            else:
                sessions = all_sessions

            # Xác định kế hoạch tương ứng của từng chủ đề.
            all_topic_ids = list({
                str(session["topic_id"])
                for session in all_sessions
                if session.get("topic_id")
            })

            topic_plan_map = {}

            if all_topic_ids:
                topics_response = (
                    supabase.table("topics")
                    .select("id, exam_plan_id")
                    .eq("user_id", DEMO_USER_ID)
                    .in_("id", all_topic_ids)
                    .execute()
                )

                topic_plan_map = {
                    str(topic["id"]): str(topic["exam_plan_id"])
                    for topic in (topics_response.data or [])
                    if topic.get("id") and topic.get("exam_plan_id")
                }

            plan_sessions = {}

            for session in all_sessions:
                session_topic_id = str(
                    session.get("topic_id") or ""
                )

                plan_id = topic_plan_map.get(session_topic_id)

                if plan_id:
                    plan_sessions.setdefault(
                        plan_id,
                        []
                    ).append(session)

        # 4. Gắn trạng thái mở khóa cho từng buổi học
        for session in sessions:
            status = session.get("status")

            # Buổi đã bắt đầu hoặc hoàn thành luôn được phép truy cập
            # để người học tiếp tục hoặc xem lại.
            if status in ["completed", "in_progress"]:
                session["is_unlocked"] = True
                session["lock_reason"] = None
                continue

            session_topic_id = str(
                session.get("topic_id") or ""
            )

            if effective_plan_id:
                plan_id = effective_plan_id
            else:
                plan_id = None

                for candidate_plan_id, candidate_sessions in plan_sessions.items():
                    if any(
                        str(item.get("topic_id")) == session_topic_id
                        for item in candidate_sessions
                    ):
                        plan_id = candidate_plan_id
                        break

            current_plan_sessions = (
                plan_sessions.get(plan_id, [])
                if plan_id
                else []
            )

            is_unlocked = (
                _is_study_session_unlocked(
                    session,
                    current_plan_sessions
                )
                if current_plan_sessions
                else False
            )

            session["is_unlocked"] = is_unlocked
            session["lock_reason"] = (
                None
                if is_unlocked
                else (
                    "Bạn cần hoàn thành các bài học và đạt ít nhất "
                    "50% Quiz của những ngày trước."
                )
            )

        # 5. Tổng hợp tiến độ
        total_sessions = len(sessions)

        completed_sessions = sum(
            1
            for session in sessions
            if session.get("status") == "completed"
        )

        remaining_sessions = (
            total_sessions - completed_sessions
        )

        progress_percent = (
            round(
                completed_sessions / total_sessions * 100,
                2
            )
            if total_sessions > 0
            else 0
        )

        return {
            "total_sessions": total_sessions,
            "completed_sessions": completed_sessions,
            "remaining_sessions": remaining_sessions,
            "progress_percent": progress_percent,
            "data": sessions
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy danh sách buổi học: {str(error)}"
        )

@app.get("/api/study-sessions/{session_id}")
def get_study_session_detail(session_id: UUID):
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # 1. Lấy thông tin buổi học
        session_response = (
            supabase.table("study_sessions")
            .select("*")
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not session_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy buổi học."
            )

        session = session_response.data[0]

                # 2. Lấy thông tin chủ đề và kế hoạch
        topic_response = (
            supabase.table("topics")
            .select(
                "id, name, description, hierarchy, "
                "source_material_id, exam_plan_id, content_sections"
            )
            .eq("id", str(session["topic_id"]))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not topic_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy chủ đề của buổi học."
            )

        topic = topic_response.data[0]

        # 3. Chỉ cho phép xem buổi học chưa bắt đầu
        # khi đã đáp ứng điều kiện mở khóa tuần tự.
        # Buổi đang học hoặc đã hoàn thành vẫn được truy cập lại.
        if session.get("status") == "scheduled":
            exam_plan_id = topic.get("exam_plan_id")

            if not exam_plan_id:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Chủ đề chưa được liên kết với kế hoạch ôn tập."
                    )
                )

            topics_response = (
                supabase.table("topics")
                .select("id")
                .eq("exam_plan_id", str(exam_plan_id))
                .eq("user_id", DEMO_USER_ID)
                .eq("is_active", True)
                .execute()
            )

            topic_ids = [
                str(item["id"])
                for item in (topics_response.data or [])
            ]

            if str(topic["id"]) not in topic_ids:
                topic_ids.append(str(topic["id"]))

            sessions_response = (
                supabase.table("study_sessions")
                .select(
                    "id, topic_id, scheduled_start, status, "
                    "actual_study_seconds"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("topic_id", topic_ids)
                .order("scheduled_start")
                .execute()
            )

            plan_sessions = sessions_response.data or []

            # Bảo đảm buổi học hiện tại có trong danh sách kiểm tra
            if not any(
                str(item.get("id")) == str(session_id)
                for item in plan_sessions
            ):
                plan_sessions.append(session)

            if not _is_study_session_unlocked(
                session,
                plan_sessions
            ):
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Bài học đang bị khóa. Bạn cần hoàn thành "
                        "toàn bộ bài học và đạt ít nhất 50% Quiz "
                        "của những ngày học trước đó."
                    )
                )

        # 4. Lấy các đoạn tài liệu được phân bổ cho buổi học
        source_chunk_ids = session.get("source_chunk_ids") or []

        if not isinstance(source_chunk_ids, list) or not source_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail="Buổi học chưa được phân bổ nội dung tài liệu."
            )

        chunk_response = (
            supabase.table("material_chunks")
            .select(
                "id, chunk_index, page_number, content, material_id"
            )
            .eq("user_id", DEMO_USER_ID)
            .in_("id", source_chunk_ids)
            .execute()
        )

        chunks = chunk_response.data or []

        # 5. Kiểm tra tất cả chunks được phân bổ đều tồn tại
        found_chunk_ids = {
            str(chunk["id"])
            for chunk in chunks
        }

        expected_chunk_ids = {
            str(chunk_id)
            for chunk_id in source_chunk_ids
        }

        if found_chunk_ids != expected_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Một số nội dung được phân bổ cho buổi học "
                    "không còn tồn tại hoặc không truy xuất được."
                )
            )

        # 6. Giữ đúng thứ tự chunks đã được phân bổ
        chunk_order = {
            str(chunk_id): index
            for index, chunk_id in enumerate(source_chunk_ids)
        }

        chunks.sort(
            key=lambda chunk: chunk_order[str(chunk["id"])]
        )

        return {
            "message": "Lấy thông tin buổi học thành công!",
            "session": session,
            "topic": topic,
            "chunks": chunks
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy thông tin buổi học: {str(error)}"
        )

@app.patch("/api/study-sessions/{session_id}")
def update_study_session(
    session_id: UUID,
    session: StudySessionUpdate
):
    try:
        # 1. Kiểm tra buổi học thuộc người dùng hiện tại
        existing_response = (
            supabase
            .table("study_sessions")
            .select("id")
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not existing_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy buổi học."
            )

        # 2. Lấy thông tin được phép cập nhật
        update_data = session.model_dump(
            exclude_unset=True,
            exclude_none=True
        )

        if not update_data:
            raise HTTPException(
                status_code=400,
                detail="Bạn chưa cung cấp thông tin cần cập nhật."
            )

        # 3. Cập nhật thời gian chỉnh sửa
        update_data["updated_at"] = (
            datetime.now(timezone.utc).isoformat()
        )

        # 4. Lưu vào Supabase
        response = (
            supabase
            .table("study_sessions")
            .update(update_data)
            .eq("id", str(session_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        return {
            "message": "Cập nhật buổi học thành công!",
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể cập nhật buổi học: {str(error)}"
        )


@app.post("/api/study-materials/upload")
async def upload_study_material(
    exam_plan_id: UUID = Form(...),
    material_type: Literal["textbook", "question_bank"] = Form(...),
    file: UploadFile = File(...)
):
    storage_path = None

    try:
        # 1. Kiểm tra kế hoạch ôn thi
        plan_response = (
            supabase
            .table("exam_plans")
            .select("id")
            .eq("id", str(exam_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not plan_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn thi."
            )

        # 2. Kiểm tra định dạng file
        original_name = (
            (file.filename or "")
            .replace("\\", "/")
            .split("/")[-1]
        )
        extension = os.path.splitext(original_name)[1].lower()

        allowed_types = {
            ".pdf": "application/pdf",
            ".doc": "application/msword",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".ppt": "application/vnd.ms-powerpoint",
            ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        }

        if extension not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Chỉ chấp nhận file PDF, DOC, DOCX, PPT và PPTX."
                )
            )

        mime_type = allowed_types[extension]

        # 3. Đọc file (giới hạn 50 MB)
        file_content = await file.read(
            50 * 1024 * 1024 + 1
        )

        if len(file_content) > 50 * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail="Dung lượng file không được vượt quá 50 MB."
            )

        if not file_content:
            raise HTTPException(
                status_code=400,
                detail="File không được để trống."
            )

        # 4. Tạo đường dẫn lưu file trên Supabase Storage
        unique_filename = f"{uuid4()}{extension}"

        storage_path = (
            f"{DEMO_USER_ID}/{exam_plan_id}/{unique_filename}"
        )

        supabase.storage.from_("study-materials").upload(
            storage_path,
            file_content,
            {
                "content-type": mime_type,
                "upsert": "false"
            }
        )

        # 5. Lưu thông tin file vào database
        response = (
            supabase
            .table("study_materials")
            .insert({
                "user_id": DEMO_USER_ID,
                "exam_plan_id": str(exam_plan_id),
                "file_name": original_name,
                "storage_path": storage_path,
                "mime_type": mime_type,
                "file_size_bytes": len(file_content),
                "material_type": material_type,
                "processing_status": "pending"
            })
            .execute()
        )

        return {
            "message": "Tải tài liệu lên thành công!",
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        # Xóa file trên Storage nếu lưu database thất bại
        if storage_path:
            try:
                supabase.storage.from_("study-materials").remove(
                    [storage_path]
                )
            except Exception:
                pass

        raise HTTPException(
            status_code=500,
            detail=f"Không thể tải tài liệu lên: {str(error)}"
        )

@app.get("/api/study-materials")
def get_study_materials(exam_plan_id: UUID | None = None):
    try:
        query = (
            supabase
            .table("study_materials")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
        )

        if exam_plan_id:
            query = query.eq("exam_plan_id", str(exam_plan_id))

        response = (
            query
            .order("created_at", desc=True)
            .execute()
        )

        return {
            "data": response.data
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy danh sách tài liệu: {str(error)}"
        )

@app.get("/api/study-materials/{material_id}/download-url")
def get_study_material_download_url(material_id: UUID):
    try:
        # 1. Tìm tài liệu thuộc người dùng hiện tại
        material_response = (
            supabase
            .table("study_materials")
            .select("id, file_name, storage_path")
            .eq("id", str(material_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not material_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy tài liệu."
            )

        material = material_response.data[0]

        # 2. Tạo đường dẫn tải tạm thời có hiệu lực 1 giờ
        signed_response = (
            supabase
            .storage
            .from_("study-materials")
            .create_signed_url(
                material["storage_path"],
                3600
            )
        )

        signed_url = (
            signed_response.get("signedURL")
            or signed_response.get("signedUrl")
        )

        if not signed_url:
            raise Exception("Không thể tạo đường dẫn tải tài liệu.")

        # 3. Trả kết quả
        return {
            "message": "Tạo đường dẫn tải tài liệu thành công!",
            "file_name": material["file_name"],
            "signed_url": signed_url,
            "expires_in": 3600
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo đường dẫn tải tài liệu: {str(error)}"
        )
    

@app.post("/api/study-materials/{material_id}/process")
def process_study_material(material_id: UUID):
    temp_path = None
    processing_started = False
    old_chunks_deleted = False
    old_chunks = []
    previous_status = "pending"

    def rollback_processing():
        try:
            # Chỉ khôi phục dữ liệu nếu chunks cũ đã bị xóa
            if old_chunks_deleted:
                supabase.table("material_chunks").delete().eq(
                    "material_id", str(material_id)
                ).eq(
                    "user_id", DEMO_USER_ID
                ).execute()

                # Khôi phục chunks cũ theo từng nhóm 100
                for i in range(0, len(old_chunks), 100):
                    batch = old_chunks[i:i + 100]

                    supabase.table("material_chunks").insert(
                        batch
                    ).execute()

            # Khôi phục trạng thái trước khi xử lý
            restore_status = (
                previous_status
                if old_chunks
                else "failed"
            )

            supabase.table("study_materials").update({
                "processing_status": restore_status
            }).eq(
                "id", str(material_id)
            ).eq(
                "user_id", DEMO_USER_ID
            ).execute()

        except Exception:
            pass

    try:
        # 1. Kiểm tra tài liệu
        material_response = (
            supabase
            .table("study_materials")
            .select("*")
            .eq("id", str(material_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not material_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy tài liệu."
            )

        material = material_response.data[0]

        # 2. Chỉ xử lý giáo trình ở phiên bản này
        if material["material_type"] != "textbook":
            raise HTTPException(
                status_code=400,
                detail="API hiện chỉ hỗ trợ xử lý giáo trình."
            )

        previous_status = (
            material.get("processing_status") or "pending"
        )

        # 3. Lưu lại chunks cũ để có thể khôi phục
        old_chunks_response = (
            supabase.table("material_chunks")
            .select("*")
            .eq("material_id", str(material_id))
            .eq("user_id", DEMO_USER_ID)
            .order("chunk_index")
            .execute()
        )

        old_chunks = old_chunks_response.data or []

        # 4. Cập nhật trạng thái đang xử lý
        supabase.table("study_materials").update({
            "processing_status": "processing"
        }).eq(
            "id", str(material_id)
        ).eq(
            "user_id", DEMO_USER_ID
        ).execute()

        processing_started = True

        # 5. Tải file từ Supabase Storage
        file_content = (
            supabase.storage
            .from_("study-materials")
            .download(material["storage_path"])
        )

        extension = os.path.splitext(
            material["file_name"]
        )[1].lower()

        # 6. Lưu tạm file vào máy chủ
        with tempfile.NamedTemporaryFile(
            suffix=extension,
            delete=False
        ) as temp_file:
            temp_file.write(file_content)
            temp_path = temp_file.name

        # 7. Trích xuất nội dung
        pages = extract_text(temp_path)

        if not pages:
            raise ValueError(
                "Không trích xuất được nội dung văn bản từ tài liệu."
            )

        # 8. Chia nội dung thành chunks
        chunk_records = []
        chunk_index = 0

        for page in pages:
            chunks = split_into_chunks(page["content"])

            for chunk in chunks:
                chunk_records.append({
                    "user_id": DEMO_USER_ID,
                    "material_id": str(material_id),
                    "chunk_index": chunk_index,
                    "content": chunk,
                    "page_number": page["page_number"],
                    "token_count": len(chunk.split())
                })

                chunk_index += 1

        if not chunk_records:
            raise ValueError(
                "Tài liệu không có nội dung phù hợp để chia nhỏ."
            )

        # 9. Chỉ thay thế chunks cũ sau khi xử lý nội dung mới thành công
        supabase.table("material_chunks").delete().eq(
            "material_id", str(material_id)
        ).eq(
            "user_id", DEMO_USER_ID
        ).execute()

        old_chunks_deleted = True

        # 10. Lưu chunks mới theo từng nhóm 100
        for i in range(0, len(chunk_records), 100):
            batch = chunk_records[i:i + 100]

            supabase.table("material_chunks").insert(
                batch
            ).execute()

        # 11. Cập nhật trạng thái hoàn thành
        supabase.table("study_materials").update({
            "processing_status": "processed"
        }).eq(
            "id", str(material_id)
        ).eq(
            "user_id", DEMO_USER_ID
        ).execute()

        # 12. Trả kết quả
        return {
            "message": "Xử lý tài liệu thành công!",
            "material_id": str(material_id),
            "total_pages": len(pages),
            "total_chunks": len(chunk_records),
            "processing_status": "processed"
        }

    except HTTPException:
        if processing_started:
            rollback_processing()

        raise

    except Exception as error:
        if processing_started:
            rollback_processing()

        raise HTTPException(
            status_code=500,
            detail=f"Không thể xử lý tài liệu: {str(error)}"
        )

    finally:
        # Xóa file tạm sau khi xử lý
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

    
@app.get("/api/study-materials/{material_id}/chunks")
def get_material_chunks(material_id: UUID):
    try:
        # 1. Kiểm tra tài liệu có thuộc người dùng hiện tại không
        material_response = (
            supabase
            .table("study_materials")
            .select("id, file_name")
            .eq("id", str(material_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not material_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy tài liệu."
            )

        # 2. Lấy các đoạn nội dung của tài liệu
        chunks_response = (
            supabase
            .table("material_chunks")
            .select(
                "id, chunk_index, content, page_number, token_count, created_at"
            )
            .eq("material_id", str(material_id))
            .eq("user_id", DEMO_USER_ID)
            .order("chunk_index")
            .execute()
        )

        # 3. Trả kết quả
        return {
            "message": "Lấy nội dung tài liệu thành công!",
            "material_id": str(material_id),
            "file_name": material_response.data[0]["file_name"],
            "total_chunks": len(chunks_response.data),
            "data": chunks_response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy nội dung tài liệu: {str(error)}"
        )


@app.post("/api/flashcards/generate")
def generate_flashcards(request: FlashcardGenerateRequest):
    try:
        # 1. Kiểm tra tài liệu
        material_response = (
            supabase.table("study_materials")
            .select("id, material_type, processing_status")
            .eq("id", str(request.material_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not material_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy tài liệu."
            )

        material = material_response.data[0]

        if material["material_type"] != "textbook":
            raise HTTPException(
                status_code=400,
                detail="Chỉ hỗ trợ tạo Flashcard từ giáo trình."
            )

        if material["processing_status"] != "processed":
            raise HTTPException(
                status_code=400,
                detail="Tài liệu chưa được xử lý hoàn tất."
            )

        # 2. Kiểm tra chủ đề có thuộc tài liệu được chọn không
        topic_response = (
            supabase.table("topics")
            .select("id, name, source_material_id, source_chunk_ids")
            .eq("id", str(request.topic_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not topic_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy chủ đề."
            )

        topic = topic_response.data[0]

        if str(topic.get("source_material_id")) != str(request.material_id):
            raise HTTPException(
                status_code=400,
                detail="Chủ đề không thuộc tài liệu được chọn."
            )

        # 3. Lấy đúng các đoạn tài liệu thuộc chủ đề
        source_chunk_ids = topic.get("source_chunk_ids") or []

        if not isinstance(source_chunk_ids, list) or not source_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail="Chủ đề chưa được phân bổ nội dung tài liệu."
            )

        source_chunk_ids = list(dict.fromkeys(
            str(chunk_id) for chunk_id in source_chunk_ids
        ))

        chunks_response = (
            supabase.table("material_chunks")
            .select("id, chunk_index, page_number, content")
            .eq("material_id", str(request.material_id))
            .eq("user_id", DEMO_USER_ID)
            .in_("id", source_chunk_ids)
            .execute()
        )

        chunks = chunks_response.data or []

        found_chunk_ids = {
            str(chunk["id"]) for chunk in chunks
        }

        if found_chunk_ids != set(source_chunk_ids):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Một số nội dung thuộc chủ đề không còn tồn tại "
                    "hoặc không truy xuất được."
                )
            )

        chunk_order = {
            chunk_id: index
            for index, chunk_id in enumerate(source_chunk_ids)
        }

        chunks.sort(
            key=lambda chunk: chunk_order[str(chunk["id"])]
        )

        chunk_data = [
            {
                "source_chunk_id": str(chunk["id"]),
                "page_number": chunk.get("page_number"),
                "content": chunk["content"]
            }
            for chunk in chunks
        ]

        # 4. Lấy Flashcard đã tồn tại để hạn chế tạo thẻ trùng
        existing_response = (
            supabase.table("flashcards")
            .select("front, back")
            .eq("user_id", DEMO_USER_ID)
            .eq("topic_id", str(request.topic_id))
            .eq("status", "active")
            .execute()
        )

        existing_cards = existing_response.data or []

        existing_keys = {
            (
                str(card.get("front", "")).strip().casefold(),
                str(card.get("back", "")).strip().casefold()
            )
            for card in existing_cards
        }

        # 5. Chuẩn bị prompt tạo Flashcard
        prompt = f"""
Bạn là trợ lý AI StudyPilot, chuyên tạo Flashcard
giúp sinh viên ghi nhớ kiến thức từ tài liệu học tập.

CHỦ ĐỀ:
{topic.get("name") or "Chủ đề học tập"}

Hãy tạo đúng {request.number_of_cards} Flashcard bằng tiếng Việt
dựa trên nội dung tài liệu được cung cấp.

YÊU CẦU:
- Mỗi Flashcard gồm một mặt trước (front) và một mặt sau (back).
- Front phải là câu hỏi, thuật ngữ hoặc khái niệm cần ghi nhớ.
- Back chỉ được gồm 1-2 ý chính ngắn gọn như nội dung tóm tắt trên slide.
- Mỗi ý trong Back phải nằm trên một dòng riêng, bắt đầu bằng "- ".
- Mỗi ý không quá 18 từ; không viết đoạn văn dài, không thêm ví dụ lan man.
- Tập trung vào định nghĩa, nguyên lý, đặc điểm, công thức,
  quy trình và kiến thức quan trọng.
- Câu hỏi phải ngắn gọn, rõ ràng.
- Không tạo các thẻ có nội dung trùng lặp.
- Không tự bịa thông tin hoặc sử dụng kiến thức ngoài tài liệu.
- Mỗi Flashcard phải có source_chunk_id chính xác
  của đoạn tài liệu dùng để tạo thẻ.
- Phân bổ nội dung hợp lý giữa các đoạn tài liệu.
- Chỉ trả về JSON hợp lệ, không có Markdown
  hoặc giải thích bên ngoài JSON.

ĐỊNH DẠNG JSON BẮT BUỘC:
{{
    "cards": [
        {{
            "front": "Câu hỏi hoặc khái niệm",
            "back": "Câu trả lời hoặc giải thích",
            "source_chunk_id": "UUID của đoạn tài liệu"
        }}
    ]
}}

NỘI DUNG TÀI LIỆU:
{json.dumps(chunk_data, ensure_ascii=False)}
"""

        # 6. Gọi AI Groq
        ai_response = generate_text(prompt)

        if not isinstance(ai_response, str) or not ai_response.strip():
            raise ValueError("AI không trả về nội dung Flashcard.")

        cleaned_response = ai_response.strip()

        if cleaned_response.startswith("```"):
            lines = cleaned_response.splitlines()

            if lines and lines[0].startswith("```"):
                lines = lines[1:]

            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]

            cleaned_response = "\n".join(lines).strip()

        result = json.loads(cleaned_response)

        if not isinstance(result, dict):
            raise ValueError("Định dạng dữ liệu AI trả về không hợp lệ.")

        cards = result.get("cards", [])

        if not isinstance(cards, list) or not cards:
            raise ValueError("AI không tạo được danh sách Flashcard.")

        # 7. Kiểm tra và lọc Flashcard AI tạo ra
        valid_chunk_ids = set(source_chunk_ids)

        flashcard_records = []
        generated_keys = set()

        for card in cards:
            if len(flashcard_records) >= request.number_of_cards:
                break

            if not isinstance(card, dict):
                continue

            front = card.get("front")
            back = card.get("back")
            source_chunk_id = str(
                card.get("source_chunk_id") or ""
            )

            if not isinstance(front, str) or not front.strip():
                continue

            if not isinstance(back, str) or not back.strip():
                continue

            front = front.strip()
            back = back.strip()

            if source_chunk_id not in valid_chunk_ids:
                continue

            card_key = (
                front.casefold(),
                back.casefold()
            )

            if card_key in existing_keys or card_key in generated_keys:
                continue

            generated_keys.add(card_key)

            flashcard_records.append({
                "user_id": DEMO_USER_ID,
                "topic_id": str(request.topic_id),
                "source_chunk_id": source_chunk_id,
                "front": front,
                "back": back,
                "source": "ai",
                "status": "active"
            })

        if not flashcard_records:
            raise ValueError(
                "AI không trả về Flashcard hợp lệ hoặc các thẻ đều bị trùng."
            )

        # 8. Lưu Flashcard vào Supabase
        save_response = (
            supabase.table("flashcards")
            .insert(flashcard_records)
            .execute()
        )

        saved_cards = save_response.data or []

        if not saved_cards:
            raise ValueError("Không thể lưu Flashcard vào cơ sở dữ liệu.")

        return {
            "message": "Tạo Flashcard bằng AI thành công!",
            "material_id": str(request.material_id),
            "topic_id": str(request.topic_id),
            "requested_cards": request.number_of_cards,
            "created_cards": len(saved_cards),
            "data": saved_cards
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo Flashcard: {str(error)}"
        )


@app.get("/api/quizzes/{quiz_id}/questions")
def get_quiz_questions(quiz_id: UUID):
    try:
        # 1. Kiểm tra Quiz có tồn tại và thuộc người dùng
        quiz_response = (
            supabase.table("quizzes")
            .select("*")
            .eq("id", str(quiz_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "active")
            .execute()
        )

        if not quiz_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy Quiz."
            )

        quiz = quiz_response.data[0]

        # 2. Lấy danh sách câu hỏi
        questions_response = (
            supabase.table("quiz_questions")
            .select(
                "id, question_text, question_type, "
                "options, points, question_order, difficulty_level"
            )
            .eq("quiz_id", str(quiz_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "ready")
            .order("question_order")
            .execute()
        )

        return {
            "message": "Lấy danh sách câu hỏi thành công!",
            "quiz": {
                "id": quiz["id"],
                "title": quiz["title"],
                "description": quiz["description"],
                "time_limit_minutes": quiz["time_limit_minutes"]
            },
            "total_questions": len(questions_response.data),
            "data": questions_response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy câu hỏi Quiz: {str(error)}"
        )




@app.post("/api/quizzes/{quiz_id}/start")
def start_quiz(quiz_id: UUID):
    try:
        if not DEMO_USER_ID:
            raise HTTPException(
                status_code=500,
                detail="Chưa cấu hình DEMO_USER_ID trong file .env"
            )

        # 1. Kiểm tra Quiz
        quiz_response = (
            supabase.table("quizzes")
            .select("id, title, time_limit_minutes, study_session_id")
            .eq("id", str(quiz_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "active")
            .limit(1)
            .execute()
        )

        if not quiz_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy Quiz."
            )

        quiz = quiz_response.data[0]
        study_session_id = quiz.get("study_session_id")

        # 2. Kiểm tra điều kiện mở Quiz
        if study_session_id:
            # Quiz học bình thường
            session_response = (
                supabase.table("study_sessions")
                .select(
                    "id, topic_id, status, scheduled_start, "
                    "actual_study_seconds"
                )
                .eq("id", str(study_session_id))
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if not session_response.data:
                raise HTTPException(
                    status_code=404,
                    detail="Không tìm thấy buổi học của Quiz."
                )

            session = session_response.data[0]

            # Quiz của buổi học được mở ngay sau khi tạo, không yêu cầu
            # hoàn thành bài học hoặc đủ thời gian học tối thiểu.

        else:
            # Quiz ôn tập lại: không áp dụng khóa tuần tự.
            # Người học có thể làm ngay sau khi bài được tạo.
            review_response = (
                supabase.table("review_plans")
                .select("id, status, review_study_seconds")
                .eq("retake_quiz_id", str(quiz_id))
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if not review_response.data:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Quiz không được liên kết với "
                        "kế hoạch ôn tập hợp lệ."
                    )
                )

            review_plan = review_response.data[0]

            if review_plan.get("status") not in ["pending", "in_progress"]:
                raise HTTPException(
                    status_code=403,
                    detail="Kế hoạch ôn tập không còn hoạt động."
                )

        # 3. Kiểm tra Quiz có câu hỏi không
        questions_response = (
            supabase.table("quiz_questions")
            .select("id")
            .eq("quiz_id", str(quiz_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "ready")
            .execute()
        )

        questions = questions_response.data or []

        if not questions:
            raise HTTPException(
                status_code=400,
                detail="Quiz chưa có câu hỏi để làm."
            )

        # 4. Khôi phục lượt làm bài đang diễn ra nếu tải lại trang
        existing_attempt_response = (
            supabase.table("quiz_attempts")
            .select("id, started_at, status")
            .eq("user_id", DEMO_USER_ID)
            .eq("quiz_id", str(quiz_id))
            .eq("status", "in_progress")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )

        if existing_attempt_response.data:
            attempt = existing_attempt_response.data[0]
        else:
            attempt_response = (
                supabase.table("quiz_attempts")
                .insert({
                    "id": str(uuid4()),
                    "user_id": DEMO_USER_ID,
                    "quiz_id": str(quiz_id),
                    "status": "in_progress",
                    "total_questions": len(questions)
                })
                .execute()
            )

            if not attempt_response.data:
                raise Exception("Không thể tạo lượt làm bài.")

            attempt = attempt_response.data[0]

        attempt_id = attempt.get("id")

        try:
            UUID(str(attempt_id))
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(
                status_code=500,
                detail="Không thể tạo lượt làm bài hợp lệ. Vui lòng thử lại."
            )

        # 5. Trả kết quả
        return {
            "message": "Bắt đầu làm bài Quiz thành công!",
            "attempt_id": str(attempt_id),
            "quiz_id": str(quiz_id),
            "title": quiz["title"],
            "time_limit_minutes": quiz["time_limit_minutes"],
            "total_questions": len(questions),
            "status": attempt["status"],
            "started_at": attempt["started_at"]
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể bắt đầu Quiz: {str(error)}"
        )


@app.get("/api/review-plans/{review_plan_id}/review-material")
def get_review_material(review_plan_id: UUID):
    try:
        # 1. Lấy Review Plan và nội dung học bổ trợ
        review_response = (
            supabase.table("review_plans")
            .select(
                "id, status, assessment_id, retake_quiz_id, "
                "review_items, overall_goal, "
                "review_study_seconds, review_study_completed_at"
            )
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not review_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn tập."
            )

        review_plan = review_response.data[0]

        if review_plan["status"] not in ["pending", "in_progress"]:
            raise HTTPException(
                status_code=403,
                detail="Kế hoạch ôn tập không còn hoạt động."
            )

        review_items = review_plan.get("review_items") or []
        retake_quiz_id = review_plan.get("retake_quiz_id")
        is_supplemental_only = not bool(retake_quiz_id)

        # 2. Lấy Quiz gốc từ AI Assessment
        assessment_response = (
            supabase.table("quiz_assessments")
            .select("quiz_id")
            .eq("id", str(review_plan["assessment_id"]))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not assessment_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kết quả đánh giá gốc."
            )

        original_quiz_id = assessment_response.data[0]["quiz_id"]

        # 3. Lấy thông tin Quiz gốc
        quiz_response = (
            supabase.table("quizzes")
            .select("id, title, study_session_id")
            .eq("id", str(original_quiz_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not quiz_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy Quiz gốc."
            )

        original_quiz = quiz_response.data[0]
        study_session_id = original_quiz.get("study_session_id")

        chunks = []
        topic_id = None
        topic_name = None

        # 4. Lấy tài liệu gốc nếu Quiz có liên kết buổi học
        if study_session_id:
            session_response = (
                supabase.table("study_sessions")
                .select("id, topic_id, source_chunk_ids, notes")
                .eq("id", str(study_session_id))
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if session_response.data:
                session = session_response.data[0]

                topic_id = session.get("topic_id")
                topic_name = session.get("notes")

                source_chunk_ids = (
                    session.get("source_chunk_ids") or []
                )

                if source_chunk_ids:
                    chunks_response = (
                        supabase.table("material_chunks")
                        .select(
                            "id, material_id, content, "
                            "page_number, chunk_index"
                        )
                        .eq("user_id", DEMO_USER_ID)
                        .in_("id", source_chunk_ids)
                        .execute()
                    )

                    chunks = chunks_response.data or []

                    chunk_order = {
                        str(chunk_id): index
                        for index, chunk_id in enumerate(
                            source_chunk_ids
                        )
                    }

                    chunks.sort(
                        key=lambda chunk: chunk_order.get(
                            str(chunk["id"]),
                            999999
                        )
                    )

        # 5. Nếu không có tài liệu gốc và cũng không có
        # nội dung bổ trợ thì không thể mở kế hoạch.
        if not chunks and not review_items:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy nội dung để ôn tập."
            )

        actual_seconds = int(
            review_plan.get("review_study_seconds") or 0
        )

        required_seconds = 0

        return {
            "review_plan_id": str(review_plan_id),
            "original_quiz_id": str(original_quiz_id),
            "retake_quiz_id": retake_quiz_id,
            "original_quiz_title": original_quiz["title"],
            "study_session_id": (
                str(study_session_id)
                if study_session_id
                else None
            ),
            "topic_id": topic_id,
            "topic_name": topic_name,
            "overall_goal": review_plan.get("overall_goal"),
            "review_items": review_items,
            "is_supplemental_only": is_supplemental_only,
            "requires_retake": bool(retake_quiz_id),
            "chunks": chunks,
            "total_chunks": len(chunks),
            "review_study_seconds": actual_seconds,
            "review_study_completed_at": review_plan.get(
                "review_study_completed_at"
            ),
            "required_review_seconds": required_seconds,
            "is_eligible_for_quiz": (
                bool(retake_quiz_id)
                and review_plan["status"] in ["pending", "in_progress"]
            )
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tải tài liệu ôn tập: {str(error)}"
        )



@app.post("/api/review-plans/{review_plan_id}/start-review")
def start_review_plan(review_plan_id: UUID):
    try:
        review_response = (
            supabase.table("review_plans")
            .select(
                "id, status, retake_quiz_id, "
                "review_study_started_at, review_study_seconds"
            )
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not review_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn tập."
            )

        review_plan = review_response.data[0]

        if review_plan["status"] not in ["pending", "in_progress"]:
            raise HTTPException(
                status_code=403,
                detail="Kế hoạch ôn tập không còn hoạt động."
            )

        now = datetime.now(timezone.utc).isoformat()

        started_at = (
            review_plan.get("review_study_started_at") or now
        )

        update_response = (
            supabase.table("review_plans")
            .update({
                "status": "in_progress",
                "review_study_started_at": started_at,
                "review_study_last_activity_at": now
            })
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not update_response.data:
            raise Exception("Không thể bắt đầu phiên ôn tập.")

        updated_plan = update_response.data[0]

        actual_seconds = int(
            updated_plan.get("review_study_seconds") or 0
        )

        requires_retake = bool(
            updated_plan.get("retake_quiz_id")
        )

        required_seconds = 0

        return {
            "message": "Bắt đầu ôn tập thành công.",
            "review_plan_id": str(review_plan_id),
            "review_study_seconds": actual_seconds,
            "required_seconds": required_seconds,
            "requires_retake": requires_retake,
            "is_supplemental_only": not requires_retake,
            "is_eligible_for_quiz": (
                requires_retake
            )
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể bắt đầu ôn tập: {str(error)}"
        )


@app.post("/api/review-plans/{review_plan_id}/review-activity")
def record_review_activity(review_plan_id: UUID):
    try:
        review_response = (
            supabase.table("review_plans")
            .select(
                "id, status, retake_quiz_id, "
                "review_study_last_activity_at, "
                "review_study_seconds, "
                "review_study_completed_at"
            )
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not review_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn tập."
            )

        review_plan = review_response.data[0]

        if review_plan["status"] not in ["pending", "in_progress"]:
            raise HTTPException(
                status_code=403,
                detail="Kế hoạch ôn tập không còn hoạt động."
            )

        if not review_plan.get("retake_quiz_id"):
            raise HTTPException(
                status_code=400,
                detail="Kế hoạch chưa có Quiz ôn tập."
            )

        last_activity_raw = review_plan.get(
            "review_study_last_activity_at"
        )

        if not last_activity_raw:
            raise HTTPException(
                status_code=400,
                detail="Bạn cần bắt đầu phiên ôn tập trước."
            )

        last_activity = datetime.fromisoformat(
            str(last_activity_raw).replace("Z", "+00:00")
        )

        if last_activity.tzinfo is None:
            last_activity = last_activity.replace(
                tzinfo=timezone.utc
            )

        now = datetime.now(timezone.utc)
        elapsed = int((now - last_activity).total_seconds())

        credited_seconds = (
            elapsed if 0 <= elapsed <= 60 else 0
        )

        current_seconds = int(
            review_plan.get("review_study_seconds") or 0
        )

        total_seconds = current_seconds + credited_seconds

        update_payload = {
            "review_study_last_activity_at": now.isoformat(),
            "review_study_seconds": total_seconds
        }

        if (
            total_seconds > 0
            and not review_plan.get("review_study_completed_at")
        ):
            update_payload["review_study_completed_at"] = (
                now.isoformat()
            )

        update_response = (
            supabase.table("review_plans")
            .update(update_payload)
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .eq(
                "review_study_last_activity_at",
                last_activity_raw
            )
            .execute()
        )

        if not update_response.data:
            latest_response = (
                supabase.table("review_plans")
                .select("review_study_seconds")
                .eq("id", str(review_plan_id))
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            latest_seconds = (
                int(
                    latest_response.data[0].get(
                        "review_study_seconds"
                    ) or 0
                )
                if latest_response.data
                else current_seconds
            )

            return {
                "message": "Thời gian ôn tập đã được cập nhật.",
                "review_study_seconds": latest_seconds,
                "required_seconds": 0,
                "is_eligible_for_quiz": True
            }

        return {
            "message": "Đã ghi nhận thời gian ôn tập.",
            "review_study_seconds": total_seconds,
            "credited_seconds": credited_seconds,
            "required_seconds": 0,
            "is_eligible_for_quiz": True
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể ghi nhận thời gian ôn tập: {str(error)}"
        )

@app.post("/api/review-plans/{review_plan_id}/complete-supplemental")
def complete_supplemental_review(review_plan_id: UUID):
    try:
        review_response = (
            supabase.table("review_plans")
            .select("id, status, retake_quiz_id")
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not review_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch học bổ trợ."
            )

        review_plan = review_response.data[0]

        if review_plan.get("retake_quiz_id"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Kế hoạch này yêu cầu hoàn thành Quiz ôn tập, "
                    "không thể hoàn thành theo luồng học bổ trợ."
                )
            )

        if review_plan.get("status") == "completed":
            return {
                "message": "Bạn đã hoàn thành lộ trình học bổ trợ.",
                "review_plan_id": str(review_plan_id),
                "status": "completed"
            }

        if review_plan.get("status") not in ["pending", "in_progress"]:
            raise HTTPException(
                status_code=403,
                detail="Kế hoạch học bổ trợ không còn hoạt động."
            )

        update_response = (
            supabase.table("review_plans")
            .update({
                "status": "completed"
            })
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not update_response.data:
            raise Exception(
                "Không thể cập nhật trạng thái hoàn thành."
            )

        return {
            "message": "Bạn đã hoàn thành lộ trình học bổ trợ.",
            "review_plan_id": str(review_plan_id),
            "status": "completed"
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể hoàn thành lộ trình: {str(error)}"
        )


@app.post("/api/quiz-attempts/{attempt_id}/answers")
def save_quiz_answer(
    attempt_id: UUID,
    request: QuizAnswerCreate
):
    try:
        # 1. Kiểm tra lượt làm bài
        attempt_response = (
            supabase.table("quiz_attempts")
            .select("id, quiz_id, status, started_at")
            .eq("id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not attempt_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy lượt làm bài."
            )

        attempt = attempt_response.data[0]

        if attempt["status"] != "in_progress":
            raise HTTPException(
                status_code=400,
                detail="Lượt làm bài không còn hoạt động."
            )

        # Không cho phép thay đổi đáp án sau khi hết thời gian làm bài.
        quiz_time_response = (
            supabase.table("quizzes")
            .select("time_limit_minutes")
            .eq("id", attempt["quiz_id"])
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not quiz_time_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy thông tin thời gian của Quiz."
            )

        time_limit_minutes = quiz_time_response.data[0].get(
            "time_limit_minutes"
        )
        started_at_value = attempt.get("started_at")

        if time_limit_minutes and started_at_value:
            started_at = datetime.fromisoformat(
                str(started_at_value).replace("Z", "+00:00")
            )
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)

            elapsed_seconds = (
                datetime.now(timezone.utc) - started_at
            ).total_seconds()

            if elapsed_seconds >= int(time_limit_minutes) * 60:
                raise HTTPException(
                    status_code=403,
                    detail="Đã hết thời gian làm bài. Hệ thống không nhận thêm đáp án."
                )

        # 2. Kiểm tra câu hỏi thuộc Quiz đang làm
        question_response = (
            supabase.table("quiz_questions")
            .select("id, options, question_type")
            .eq("id", str(request.question_id))
            .eq("quiz_id", attempt["quiz_id"])
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "ready")
            .execute()
        )

        if not question_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy câu hỏi trong Quiz này."
            )

        question = question_response.data[0]

        
                # 3. Kiểm tra đáp án có hợp lệ không
        question_type = question["question_type"]

        # Hỗ trợ cả hai cấu trúc options đang được lưu:
        # - Quiz thông thường: [{"key": "A", "text": "..."}]
        # - Retake Quiz: {"A": "...", "B": "...", ...}
        raw_options = question.get("options") or []

        if isinstance(raw_options, dict):
            valid_option_keys = list(raw_options.keys())
        elif isinstance(raw_options, list):
            valid_option_keys = [
                option.get("key")
                for option in raw_options
                if isinstance(option, dict) and option.get("key") is not None
            ]
        else:
            valid_option_keys = []

        if question_type == "fill_blank":
            if not isinstance(request.selected_answer, str):
                raise HTTPException(
                    status_code=400,
                    detail="Câu trả lời phải là dạng văn bản."
                )

            if not request.selected_answer.strip():
                raise HTTPException(
                    status_code=400,
                    detail="Câu trả lời không được để trống."
                )

        elif question_type == "multiple_choice":
            if not isinstance(request.selected_answer, list):
                raise HTTPException(
                    status_code=400,
                    detail="Câu hỏi này yêu cầu chọn nhiều đáp án."
                )

            if not request.selected_answer:
                raise HTTPException(
                    status_code=400,
                    detail="Vui lòng chọn ít nhất một đáp án."
                )

            if len(request.selected_answer) != len(set(request.selected_answer)):
                raise HTTPException(
                    status_code=400,
                    detail="Không được chọn trùng đáp án."
                )

            if not all(
                answer in valid_option_keys
                for answer in request.selected_answer
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Có đáp án không hợp lệ."
                )

        elif question_type in ["single_choice", "true_false"]:
            if not isinstance(request.selected_answer, str):
                raise HTTPException(
                    status_code=400,
                    detail="Câu hỏi này chỉ yêu cầu một đáp án."
                )

            if request.selected_answer not in valid_option_keys:
                raise HTTPException(
                    status_code=400,
                    detail="Đáp án không hợp lệ."
                )

        else:
            raise HTTPException(
                status_code=400,
                detail="Loại câu hỏi chưa được hỗ trợ."
            )
        # 4. Lưu hoặc cập nhật câu trả lời
        answer_response = (
            supabase.table("quiz_answers")
            .upsert(
                {
                    "user_id": DEMO_USER_ID,
                    "attempt_id": str(attempt_id),
                    "question_id": str(request.question_id),
                    "selected_answer": request.selected_answer,
                    "response_time_seconds": request.response_time_seconds,
                    "answered_at": datetime.now(timezone.utc).isoformat()
                },
                on_conflict="attempt_id,question_id"
            )
            .execute()
        )

        if not answer_response.data:
            raise Exception("Không thể lưu câu trả lời.")

        return {
            "message": "Lưu câu trả lời thành công!",
            "attempt_id": str(attempt_id),
            "question_id": str(request.question_id),
            "selected_answer": request.selected_answer,
            "data": answer_response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lưu câu trả lời: {str(error)}"
        )


@app.get("/api/quiz-attempts/{attempt_id}/answers")
def get_quiz_attempt_answers(attempt_id: UUID):
    try:
        attempt_response = (
            supabase.table("quiz_attempts")
            .select("id, status")
            .eq("id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not attempt_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy lượt làm bài."
            )

        answers_response = (
            supabase.table("quiz_answers")
            .select("question_id, selected_answer")
            .eq("attempt_id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        return {
            "attempt_id": str(attempt_id),
            "status": attempt_response.data[0]["status"],
            "data": answers_response.data or []
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tải câu trả lời đã lưu: {str(error)}"
        )


@app.post("/api/quizzes/generate")
def generate_quiz(request: QuizGenerateRequest):
    try:
        # 1. Kiểm tra tài liệu
        material_response = (
            supabase.table("study_materials")
            .select("id, exam_plan_id, material_type, processing_status")
            .eq("id", str(request.material_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not material_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy tài liệu."
            )

        material = material_response.data[0]

        if material["material_type"] != "textbook":
            raise HTTPException(
                status_code=400,
                detail="Chỉ hỗ trợ tạo Quiz từ giáo trình."
            )

        if material["processing_status"] != "processed":
            raise HTTPException(
                status_code=400,
                detail="Tài liệu chưa được xử lý hoàn tất."
            )

        
        # 2. Lấy và xác thực buổi học
        session_response = (
            supabase.table("study_sessions")
            .select(
                "id, topic_id, scheduled_start, status, "
                "duration_minutes, actual_study_seconds, "
                "source_chunk_ids"
            )
            .eq("id", str(request.study_session_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not session_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy buổi học."
            )

        session = session_response.data[0]

        

        # 3. Lấy chủ đề thuộc buổi học
        topics_response = (
            supabase.table("topics")
            .select("id, name, description, difficulty_level, source_material_id")
            .eq("id", session["topic_id"])
            .eq("user_id", DEMO_USER_ID)
            .eq("is_active", True)
            .execute()
        )

        topics = topics_response.data or []

        if not topics:
            raise HTTPException(
                status_code=400,
                detail="Không tìm thấy chủ đề của buổi học."
            )

        if str(topics[0]["source_material_id"]) != str(request.material_id):
            raise HTTPException(
                status_code=400,
                detail="Buổi học không thuộc tài liệu được chọn."
            )
        
        # 3.1. Lấy nội dung được phân bổ riêng cho buổi học này
        source_chunk_ids = session.get("source_chunk_ids") or []

        if not isinstance(source_chunk_ids, list) or not source_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Buổi học chưa được phân bổ nội dung tài liệu. "
                    "Vui lòng tạo lại lịch học."
                )
            )

        chunks_response = (
            supabase.table("material_chunks")
            .select(
                "id, content, page_number, material_id, chunk_index"
            )
            .eq("user_id", DEMO_USER_ID)
            .eq("material_id", str(request.material_id))
            .in_("id", source_chunk_ids)
            .execute()
        )

        chunks = chunks_response.data or []

        # Kiểm tra tất cả đoạn tài liệu được yêu cầu đều tồn tại
        found_chunk_ids = {
            str(chunk["id"])
            for chunk in chunks
        }

        expected_chunk_ids = {
            str(chunk_id)
            for chunk_id in source_chunk_ids
        }

        if found_chunk_ids != expected_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Một số nội dung được phân bổ cho buổi học "
                    "không tồn tại hoặc không thuộc tài liệu đã chọn."
                )
            )

        # Giữ thứ tự nội dung theo danh sách phân bổ của buổi học
        chunk_order = {
            str(chunk_id): index
            for index, chunk_id in enumerate(source_chunk_ids)
        }

        chunks.sort(
            key=lambda chunk: chunk_order[str(chunk["id"])]
        )
                # 3.2. Kiểm tra Quiz đã tồn tại cho buổi học này
        existing_quiz_response = (
            supabase.table("quizzes")
            .select("id")
            .eq("user_id", DEMO_USER_ID)
            .eq("study_session_id", str(request.study_session_id))
            .eq("status", "active")
            .limit(1)
            .execute()
        )

        if existing_quiz_response.data:
            existing_quiz_id = existing_quiz_response.data[0]["id"]

            existing_questions_response = (
                supabase.table("quiz_questions")
                .select("id")
                .eq("quiz_id", str(existing_quiz_id))
                .eq("user_id", DEMO_USER_ID)
                .execute()
            )

            existing_question_count = len(
                existing_questions_response.data or []
            )

            if existing_question_count > 0:
                return {
                    "message": "Quiz của buổi học này đã được tạo trước đó.",
                    "quiz_id": existing_quiz_id,
                    "study_session_id": str(request.study_session_id),
                    "material_id": str(request.material_id),
                    "total_questions": existing_question_count,
                    "mapped_questions": 0,
                    "skipped_mappings": 0,
                    "mapping_error": None
                }

            # Xóa Quiz cũ nếu trước đó chỉ tạo được bản ghi Quiz
            # nhưng chưa lưu được câu hỏi.
            supabase.table("quizzes").delete().eq(
                "id", str(existing_quiz_id)
            ).eq(
                "user_id", DEMO_USER_ID
            ).execute()


        # 4. Chuẩn bị nội dung cho AI
        topics_text = json.dumps(
            topics,
            ensure_ascii=False
        )

        chunks_text = json.dumps(
            chunks,
            ensure_ascii=False
        )

        # 5. Tạo prompt cho Groq AI
        prompt = f"""
Bạn là trợ lý AI của StudyPilot, chuyên tạo câu hỏi
trắc nghiệm phục vụ sinh viên ôn thi.

Dựa trên các chủ đề và nội dung giáo trình sau:

DANH SÁCH CHỦ ĐỀ:
{topics_text}

NỘI DUNG GIÁO TRÌNH:
{chunks_text}

Hãy tạo chính xác {request.number_of_questions} câu hỏi
trắc nghiệm bằng tiếng Việt.

Yêu cầu:
- Mỗi câu có 4 phương án A, B, C, D.
- Chỉ có một đáp án đúng.
- Câu hỏi phải dựa trên nội dung giáo trình.
- Độ khó từ 1 đến 5.
- Giải thích ngắn gọn đáp án đúng.
- source_chunk_id phải là ID của đoạn tài liệu
  thực sự được sử dụng để tạo câu hỏi.

Trả về JSON hợp lệ theo cấu trúc:

{{
    "questions": [
        {{
            "question_text": "Nội dung câu hỏi",
            "options": [
                {{"key": "A", "text": "Phương án A"}},
                {{"key": "B", "text": "Phương án B"}},
                {{"key": "C", "text": "Phương án C"}},
                {{"key": "D", "text": "Phương án D"}}
            ],
            "correct_answer": "A",
            "explanation": "Giải thích đáp án",
            "difficulty_level": 2,
            "source_chunk_id": "ID đoạn tài liệu"
        }}
    ]
}}

Chỉ trả về JSON, không thêm Markdown hoặc nội dung khác.
"""

        
        # 6. Gọi Groq AI. Nếu hết quota, tạo câu hỏi dự phòng từ chunks.
        try:
            ai_result = generate_text(prompt)
        except Exception as ai_error:
            print(
                "Không thể gọi AI tạo Quiz, dùng câu hỏi dự phòng:",
                str(ai_error)
            )
            fallback_questions = []

            for index in range(request.number_of_questions):
                source_chunk = chunks[index % len(chunks)]
                source_text = str(
                    source_chunk.get("content") or ""
                ).strip()
                source_sentences = [
                    sentence.strip()
                    for sentence in re.split(
                        r"(?<=[.!?])\s+",
                        source_text
                    )
                    if sentence.strip()
                ]
                answer_text = (
                    source_sentences[0][:180]
                    if source_sentences
                    else source_text[:180]
                )
                distractors = [
                    str(chunks[(index + offset) % len(chunks)].get("content") or "")
                    .strip()
                    .replace("\n", " ")[:180]
                    for offset in range(1, 4)
                ]

                fallback_questions.append({
                    "question_text": (
                        f"Theo tài liệu, nội dung nào được đề cập "
                        f"trong phần học {index + 1}?"
                    ),
                    "options": [
                        {"key": "A", "text": answer_text or "Nội dung chính"},
                        {"key": "B", "text": distractors[0] or "Nội dung khác"},
                        {"key": "C", "text": distractors[1] or "Nội dung khác"},
                        {"key": "D", "text": distractors[2] or "Nội dung khác"}
                    ],
                    "correct_answer": "A",
                    "explanation": (
                        "Đáp án được lấy từ nội dung đoạn tài liệu "
                        "được phân bổ cho buổi học."
                    ),
                    "difficulty_level": 2,
                    "source_chunk_id": str(source_chunk["id"])
                })

            ai_result = json.dumps(
                {"questions": fallback_questions},
                ensure_ascii=False
            )

        # 7. Làm sạch và chuyển kết quả AI thành JSON
        cleaned_ai_result = ai_result.strip()

        if cleaned_ai_result.startswith("```"):
            lines = cleaned_ai_result.splitlines()

            if lines and lines[0].startswith("```"):
                lines = lines[1:]

            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]

            cleaned_ai_result = "\n".join(lines).strip()

        try:
            parsed_result = json.loads(cleaned_ai_result)
        except json.JSONDecodeError:
            raise HTTPException(
                status_code=502,
                detail="AI trả về dữ liệu JSON không hợp lệ."
            )


        questions = parsed_result.get("questions", [])

        # 8. Kiểm tra cấu trúc và số lượng câu hỏi
        questions = (
            parsed_result.get("questions")
            if isinstance(parsed_result, dict)
            else None
        )

        if (
            not isinstance(questions, list)
            or len(questions) != request.number_of_questions
        ):
            raise HTTPException(
                status_code=502,
                detail="AI không trả về danh sách câu hỏi hợp lệ hoặc không đúng số lượng yêu cầu."
            )


       
        # 9. Kiểm tra từng câu hỏi
        valid_chunk_ids = {
            str(chunk["id"]) for chunk in chunks
        }

        for question_index, question in enumerate(questions):

            if not isinstance(question, dict):
                raise HTTPException(
                    status_code=502,
                    detail="Dữ liệu câu hỏi AI trả về không hợp lệ."
                )

            required_fields = [
                "question_text",
                "options",
                "correct_answer",
                "explanation",
                "difficulty_level",
                "source_chunk_id"
            ]

            if not all(
                field in question and question[field] is not None
                for field in required_fields
            ):
                raise HTTPException(
                    status_code=502,
                    detail="Câu hỏi AI tạo bị thiếu thông tin."
                )

            # Kiểm tra nội dung câu hỏi
            if (
                not isinstance(question["question_text"], str)
                or not question["question_text"].strip()
                or not isinstance(question["explanation"], str)
                or not question["explanation"].strip()
            ):
                raise HTTPException(
                    status_code=502,
                    detail="Nội dung câu hỏi hoặc giải thích không hợp lệ."
                )

            # Kiểm tra danh sách phương án
            options = question["options"]

            if (
                not isinstance(options, list)
                or len(options) != 4
                or not all(isinstance(option, dict) for option in options)
            ):
                raise HTTPException(
                    status_code=502,
                    detail="Danh sách phương án không hợp lệ."
                )

            option_keys = {
                option.get("key") for option in options
            }

            if (
                option_keys != {"A", "B", "C", "D"}
                or not all(
                    isinstance(option.get("text"), str)
                    and option["text"].strip()
                    for option in options
                )
                or question["correct_answer"] not in option_keys
            ):
                raise HTTPException(
                    status_code=502,
                    detail="Câu hỏi có phương án hoặc đáp án không hợp lệ."
                )

            # Kiểm tra độ khó
            difficulty = question["difficulty_level"]

            if (
                not isinstance(difficulty, int)
                or isinstance(difficulty, bool)
                or difficulty not in [1, 2, 3, 4, 5]
            ):
                raise HTTPException(
                    status_code=502,
                    detail="Mức độ khó của câu hỏi không hợp lệ."
                )

            # Kiểm tra nguồn tài liệu
            if str(question["source_chunk_id"]) not in valid_chunk_ids:
                # Một số lần AI trả về ID gần đúng nhưng không nằm trong
                # danh sách chunk của buổi học. Giữ câu hỏi và gắn vào
                # chunk hợp lệ theo thứ tự để Quiz không bị mất toàn bộ.
                fallback_chunk_id = str(
                    chunks[
                        question_index % len(chunks)
                    ]["id"]
                ) if chunks else ""

                if not fallback_chunk_id:
                    raise HTTPException(
                        status_code=502,
                        detail="Không tìm thấy nguồn tài liệu hợp lệ."
                    )

                question["source_chunk_id"] = fallback_chunk_id
        # 10. Tạo Quiz trong Supabase
        quiz_response = (
            supabase.table("quizzes")
            .insert({
                "user_id": DEMO_USER_ID,
                "exam_plan_id": material["exam_plan_id"],
                "study_session_id": str(request.study_session_id),
                "title": request.title,
                "description": request.description,
                "source_mode": "textbook",
                "time_limit_minutes": request.time_limit_minutes,
                "status": "active"
            })
            .execute()
        )

        if not quiz_response.data:
            raise HTTPException(
                status_code=500,
                detail="Không thể lưu Quiz vào database."
            )

        quiz_id = quiz_response.data[0]["id"]

        # 11. Chuẩn bị danh sách câu hỏi
        question_records = []

        for index, question in enumerate(questions, start=1):
            question_records.append({
                "source_chunk_id": question["source_chunk_id"],
                "quiz_id": quiz_id,
                "user_id": DEMO_USER_ID,
                "source_material_id": str(request.material_id),
                "source_type": "textbook",
                "question_text": question["question_text"],
                "question_type": "single_choice",
                "options": question["options"],
                "correct_answer": question["correct_answer"],
                "explanation": question["explanation"],
                "difficulty_level": question["difficulty_level"],
                "points": 1,
                "question_order": index,
                "status": "ready"
            })

        
        # 12. Lưu câu hỏi vào Supabase
        try:
            question_insert_response = (
                supabase.table("quiz_questions")
                .insert(question_records)
                .execute()
            )

            if not question_insert_response.data:
                raise Exception("Không thể lưu danh sách câu hỏi.")

        except Exception:
            # Xóa Quiz nếu không lưu được câu hỏi
            supabase.table("quizzes").delete().eq(
                "id", quiz_id
            ).eq(
                "user_id", DEMO_USER_ID
            ).execute()

            raise

        # 13. Chuẩn bị dữ liệu để AI liên kết chủ đề
        chunk_lookup = {
            str(chunk["id"]): chunk
            for chunk in chunks
        }

        mapping_questions = []

        for saved_question, generated_question in zip(
            question_insert_response.data,
            questions
        ):
            source_chunk_id = str(
                generated_question["source_chunk_id"]
            )

            source_chunk = chunk_lookup[source_chunk_id]

            mapping_questions.append({
                "question_id": saved_question["id"],
                "question_text": saved_question["question_text"],
                "source_chunk_id": source_chunk_id,
                "source_content": source_chunk["content"]
            })

        # 14. Tạo prompt phân loại chủ đề
        mapping_prompt = f"""
Bạn là AI chuyên phân loại câu hỏi theo chủ đề kiến thức.

DANH SÁCH CHỦ ĐỀ:
{topics_text}

DANH SÁCH CÂU HỎI:
{json.dumps(mapping_questions, ensure_ascii=False)}

Nhiệm vụ:
- Xác định chủ đề phù hợp nhất cho từng câu hỏi.
- Chỉ chọn topic_id có trong danh sách chủ đề.
- Dựa vào nội dung câu hỏi và đoạn tài liệu nguồn.
- confidence_score là độ tin cậy từ 0 đến 1.
- mapping_reason giải thích ngắn gọn lý do lựa chọn.

Trả về JSON theo cấu trúc:

{{
    "mappings": [
        {{
            "question_id": "ID câu hỏi",
            "topic_id": "ID chủ đề",
            "confidence_score": 0.95,
            "mapping_reason": "Giải thích lý do"
        }}
    ]
}}

Nếu không xác định được chủ đề phù hợp,
hãy trả về topic_id là null và confidence_score là 0.

Chỉ trả về JSON hợp lệ, không thêm Markdown.
"""

        

        # 15. Gọi AI và lưu kết quả phân loại chủ đề
        mapping_count = 0
        skipped_mapping_count = 0
        mapping_error = None

        try:
            mapping_ai_result = generate_text(mapping_prompt)

            # Xóa Markdown code fence nếu AI trả về
            cleaned_mapping_result = mapping_ai_result.strip()

            if cleaned_mapping_result.startswith("```"):
                cleaned_mapping_result = (
                    cleaned_mapping_result
                    .replace("```json", "", 1)
                    .replace("```", "")
                    .strip()
                )

            # Chuyển kết quả AI thành JSON
            parsed_mapping = json.loads(cleaned_mapping_result)

            mappings = parsed_mapping.get("mappings", [])

            if not isinstance(mappings, list):
                raise ValueError("Danh sách mappings không hợp lệ.")

            # Các ID được phép sử dụng
            valid_question_ids = {
                str(item["question_id"])
                for item in mapping_questions
            }

            valid_topic_ids = {
                str(topic["id"])
                for topic in topics
            }

            # Lấy source_chunk_id từ dữ liệu đã xác thực
            question_chunk_lookup = {
                str(item["question_id"]): str(item["source_chunk_id"])
                for item in mapping_questions
            }

            mapping_records = []

            for item in mappings:
                if not isinstance(item, dict):
                    skipped_mapping_count += 1
                    continue

                question_id = str(item.get("question_id", ""))
                topic_id = item.get("topic_id")
                confidence = item.get("confidence_score", 0)

                # Kiểm tra câu hỏi
                if question_id not in valid_question_ids:
                    skipped_mapping_count += 1
                    continue

                # Không lưu mapping nếu AI không tìm được chủ đề
                if topic_id is None:
                    skipped_mapping_count += 1
                    continue

                topic_id = str(topic_id)

                if topic_id not in valid_topic_ids:
                    skipped_mapping_count += 1
                    continue

                # Kiểm tra độ tin cậy
                try:
                    confidence = float(confidence)
                except (TypeError, ValueError):
                    skipped_mapping_count += 1
                    continue

                if not 0 <= confidence <= 1:
                    skipped_mapping_count += 1
                    continue

                # Xác định trạng thái mapping
                mapping_status = (
                    "mapped"
                    if confidence >= 0.75
                    else "needs_review"
                )

                mapping_records.append({
                    "user_id": DEMO_USER_ID,
                    "question_id": question_id,
                    "topic_id": topic_id,
                    "material_chunk_id": question_chunk_lookup[question_id],
                    "mapping_method": "ai",
                    "confidence_score": confidence,
                    "mapping_status": mapping_status,
                    "mapping_reason": str(
                        item.get("mapping_reason") or ""
                    )
                })

            # Lưu mapping vào Supabase
            if mapping_records:
                (
                    supabase.table("question_topic_mappings")
                    .insert(mapping_records)
                    .execute()
                )

                mapping_count = len(mapping_records)

        except Exception as mapping_exception:
            # Không làm mất Quiz đã tạo nếu AI mapping gặp lỗi
            mapping_error = str(mapping_exception)

        # 16. Trả kết quả
        return {
    "message": "Tạo và lưu Quiz thành công!",
    "quiz_id": quiz_id,
    "study_session_id": str(request.study_session_id),
    "material_id": str(request.material_id),
    "total_questions": len(question_records),
    "mapped_questions": mapping_count,
    "skipped_mappings": skipped_mapping_count,
    "mapping_error": mapping_error
}

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo Quiz: {str(error)}"
        )


@app.get("/api/quizzes")

def get_quizzes(exam_plan_id: UUID | None = None):
    try:
        # 1. Lấy danh sách Quiz
        query = (
            supabase.table("quizzes")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "active")
        )

        if exam_plan_id:
            query = query.eq(
                "exam_plan_id",
                str(exam_plan_id)
            )

        response = (
            query
            .order("created_at", desc=True)
            .execute()
        )

        quizzes = response.data or []

        if not quizzes:
            return {
                "message": "Lấy danh sách Quiz thành công!",
                "total_quizzes": 0,
                "data": []
            }

        # 2. Phân loại Quiz thường và Quiz ôn tập lại
        quiz_ids = [
            str(quiz["id"])
            for quiz in quizzes
        ]

        retake_response = (
            supabase.table("review_plans")
            .select(
                "id, retake_quiz_id, assessment_id, status, "
                "review_study_seconds"
            )
            .eq("user_id", DEMO_USER_ID)
            .in_("retake_quiz_id", quiz_ids)
            .execute()
        )

        review_plans = retake_response.data or []

        review_plan_map = {
            str(plan["retake_quiz_id"]): plan
            for plan in review_plans
            if plan.get("retake_quiz_id")
        }

        # 3. Lấy Quiz gốc từ các bài kiểm tra lại
        assessment_ids = list({
            str(plan["assessment_id"])
            for plan in review_plans
            if plan.get("assessment_id")
        })

        assessment_map = {}

        if assessment_ids:
            assessment_response = (
                supabase.table("quiz_assessments")
                .select("id, quiz_id")
                .in_("id", assessment_ids)
                .execute()
            )

            assessment_map = {
                str(item["id"]): item
                for item in (assessment_response.data or [])
            }

        original_quiz_ids = list({
            str(assessment["quiz_id"])
            for assessment in assessment_map.values()
            if assessment.get("quiz_id")
        })

        original_quiz_map = {}

        if original_quiz_ids:
            original_response = (
                supabase.table("quizzes")
                .select("id, study_session_id, exam_plan_id")
                .in_("id", original_quiz_ids)
                .execute()
            )

            original_quiz_map = {
                str(item["id"]): item
                for item in (original_response.data or [])
            }

        # 4. Xác định buổi học tương ứng của từng Quiz
        session_ids = set()

        for quiz in quizzes:
            if quiz.get("study_session_id"):
                session_ids.add(
                    str(quiz["study_session_id"])
                )

        for plan in review_plans:
            assessment = assessment_map.get(
                str(plan.get("assessment_id"))
            )

            if not assessment:
                continue

            original_quiz = original_quiz_map.get(
                str(assessment.get("quiz_id"))
            )

            if (
                original_quiz
                and original_quiz.get("study_session_id")
            ):
                session_ids.add(
                    str(original_quiz["study_session_id"])
                )

        session_map = {}

        if session_ids:
            session_response = (
                supabase.table("study_sessions")
                .select(
                    "id, scheduled_start, topic_id, notes, "
                    "status, actual_study_seconds"
                )
                .in_("id", list(session_ids))
                .execute()
            )

            session_map = {
                str(session["id"]): session
                for session in (session_response.data or [])
            }

        # 5. Lấy tên chủ đề
        topic_ids = list({
            str(session["topic_id"])
            for session in session_map.values()
            if session.get("topic_id")
        })

        topic_map = {}

        if topic_ids:
            topic_response = (
                supabase.table("topics")
                .select("id, name, exam_plan_id")
                .in_("id", topic_ids)
                .execute()
            )

            topic_map = {
                str(topic["id"]): topic
                for topic in (topic_response.data or [])
            }

        # 6. Gắn thông tin ngày học vào từng Quiz
        for quiz in quizzes:
            quiz_id = str(quiz["id"])

            review_plan = review_plan_map.get(quiz_id)
            is_retake = review_plan is not None

            source_quiz = quiz
            study_session_id = quiz.get("study_session_id")

            if is_retake:
                assessment = assessment_map.get(
                    str(review_plan.get("assessment_id"))
                )

                original_quiz = (
                    original_quiz_map.get(
                        str(assessment.get("quiz_id"))
                    )
                    if assessment
                    else None
                )

                if original_quiz:
                    source_quiz = original_quiz
                    study_session_id = original_quiz.get(
                        "study_session_id"
                    )

            session = (
                session_map.get(str(study_session_id))
                if study_session_id
                else None
            )

            topic = (
                topic_map.get(str(session["topic_id"]))
                if session and session.get("topic_id")
                else None
            )

            quiz["is_retake"] = is_retake
            quiz["review_plan_id"] = (
                review_plan["id"]
                if review_plan
                else None
            )
            quiz["review_status"] = (
                review_plan.get("status")
                if review_plan
                else None
            )
            quiz["review_study_seconds"] = (
                review_plan.get("review_study_seconds", 0)
                if review_plan
                else 0
            )

            quiz["study_session_id"] = study_session_id
            quiz["scheduled_start"] = (
                session.get("scheduled_start")
                if session
                else None
            )
            quiz["topic_name"] = (
                topic.get("name")
                if topic
                else None
            )
            quiz["session_status"] = (
                session.get("status")
                if session
                else None
            )
            quiz["actual_study_seconds"] = (
                session.get("actual_study_seconds", 0)
                if session
                else 0
            )
            quiz["exam_plan_id"] = (
                source_quiz.get("exam_plan_id")
                or quiz.get("exam_plan_id")
            )

                        # 7. Đánh số ngày học dựa trên toàn bộ lịch học
        plan_ids = set()

        for quiz in quizzes:
            if quiz.get("exam_plan_id"):
                plan_ids.add(str(quiz["exam_plan_id"]))

        for topic in topic_map.values():
            if topic.get("exam_plan_id"):
                plan_ids.add(str(topic["exam_plan_id"]))

        # 7.1. Lấy tên kế hoạch và tên môn học
        plan_subject_map = {}
        plan_title_map = {}

        if plan_ids:
            plans_response = (
                supabase.table("exam_plans")
                .select(
                    "id, subject_id, title, study_days_per_week"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("id", list(plan_ids))
                .execute()
            )

            exam_plans = plans_response.data or []

            subject_ids = list({
                str(plan["subject_id"])
                for plan in exam_plans
                if plan.get("subject_id")
            })

            subjects_map = {}

            if subject_ids:
                subjects_response = (
                    supabase.table("subjects")
                    .select("id, name")
                    .eq("user_id", DEMO_USER_ID)
                    .in_("id", subject_ids)
                    .execute()
                )

                subjects_map = {
                    str(subject["id"]): subject
                    for subject in (subjects_response.data or [])
                }

            for plan in exam_plans:
                plan_id = str(plan["id"])
                subject = subjects_map.get(
                    str(plan.get("subject_id") or "")
                )

                plan_subject_map[plan_id] = (
                    subject.get("name")
                    if subject
                    else "Chưa xác định môn học"
                )

                plan_title_map[plan_id] = (
                    plan.get("title") or "Kế hoạch ôn tập"
                )

        for quiz in quizzes:
            plan_id = str(quiz.get("exam_plan_id") or "")

            quiz["subject_name"] = plan_subject_map.get(
                plan_id,
                "Chưa xác định môn học"
            )

            quiz["plan_title"] = plan_title_map.get(
                plan_id,
                "Kế hoạch ôn tập"
            )

        all_topics = []

        if plan_ids:
            all_topics_response = (
                supabase.table("topics")
                .select("id, exam_plan_id")
                .eq("user_id", DEMO_USER_ID)
                .in_("exam_plan_id", list(plan_ids))
                .execute()
            )

            all_topics = all_topics_response.data or []

        topic_plan_map = {
            str(topic["id"]): str(topic["exam_plan_id"])
            for topic in all_topics
            if topic.get("id") and topic.get("exam_plan_id")
        }

        all_topic_ids = list(topic_plan_map.keys())

        all_sessions = []

        if all_topic_ids:
            all_sessions_response = (
                supabase.table("study_sessions")
                .select(
                    "id, topic_id, scheduled_start, status, "
                    "actual_study_seconds"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("topic_id", all_topic_ids)
                .execute()
            )

            all_sessions = all_sessions_response.data or []

        plan_dates = {}

        for session in all_sessions:
            topic_id = str(session.get("topic_id") or "")
            scheduled_start = session.get("scheduled_start")

            plan_id = topic_plan_map.get(topic_id)

            if not plan_id or not scheduled_start:
                continue

            study_date = str(scheduled_start)[:10]

            plan_dates.setdefault(
                plan_id,
                set()
            ).add(study_date)

        day_maps = {}

        for plan_id, dates in plan_dates.items():
            sorted_dates = sorted(dates)

            day_maps[plan_id] = {
                study_date: index + 1
                for index, study_date in enumerate(sorted_dates)
            }

        for quiz in quizzes:
            scheduled_start = quiz.get("scheduled_start")

            if not scheduled_start:
                quiz["study_day"] = None
                continue

            plan_id = str(quiz.get("exam_plan_id") or "")

            if not plan_id:
                session = session_map.get(
                    str(quiz.get("study_session_id"))
                )

                topic = (
                    topic_map.get(str(session.get("topic_id")))
                    if session and session.get("topic_id")
                    else None
                )

                if topic and topic.get("exam_plan_id"):
                    plan_id = str(topic["exam_plan_id"])

            study_date = str(scheduled_start)[:10]

            quiz["study_day"] = (
                day_maps.get(plan_id, {}).get(study_date)
                if plan_id
                else None
            )

            study_day = quiz["study_day"]
            plan_study_days = (
                int(
                    next(
                        (
                            plan.get("study_days_per_week")
                            for plan in exam_plans
                            if str(plan.get("id")) == plan_id
                        ),
                        1
                    )
                    or 1
                )
                if plan_id
                else 1
            )

            quiz["study_week"] = (
                ((study_day - 1) // plan_study_days) + 1
                if study_day
                else None
            )
            quiz["study_day_in_week"] = (
                ((study_day - 1) % plan_study_days) + 1
                if study_day
                else None
            )

        # 8. Xác định trạng thái khóa/mở Quiz
        for quiz in quizzes:
            is_unlocked = False
            lock_reason = None

            # 8.1. Quiz ôn tập lại
            if quiz.get("is_retake"):
                review_status = quiz.get("review_status")
                review_seconds = int(
                    quiz.get("review_study_seconds") or 0
                )

                if review_status == "completed":
                    lock_reason = "Đã hoàn thành bài kiểm tra lại."

                elif review_status not in ["pending", "in_progress"]:
                    lock_reason = "Kế hoạch ôn tập không còn hoạt động."

                else:
                    is_unlocked = True

            # 8.2. Quiz học bình thường
            else:
                study_session_id = quiz.get("study_session_id")

                session = (
                    session_map.get(str(study_session_id))
                    if study_session_id
                    else None
                )

                if not session:
                    lock_reason = "Không tìm thấy buổi học tương ứng."

                else:
                    is_unlocked = True

            quiz["is_unlocked"] = is_unlocked
            quiz["lock_reason"] = lock_reason

        return {
            "message": "Lấy danh sách Quiz thành công!",
            "total_quizzes": len(quizzes),
            "data": quizzes
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy danh sách Quiz: {str(error)}"
        )

@app.post("/api/flashcards/review")
def review_flashcard(request: FlashcardReviewCreate):
    try:
        # 1. Kiểm tra Flashcard
        flashcard_response = (
            supabase.table("flashcards")
            .select("id")
            .eq("id", str(request.flashcard_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "active")
            .execute()
        )

        if not flashcard_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy Flashcard."
            )

        # 2. Lấy lịch sử ôn tập gần nhất
        history_response = (
            supabase.table("flashcard_reviews")
            .select("interval_days")
            .eq("flashcard_id", str(request.flashcard_id))
            .eq("user_id", DEMO_USER_ID)
            .order("reviewed_at", desc=True)
            .limit(1)
            .execute()
        )

        previous_interval = 0

        if history_response.data:
            previous_interval = int(
                history_response.data[0]["interval_days"]
            )

        # 3. Tính khoảng thời gian ôn tập tiếp theo
        if request.rating == 1:
            interval_days = 1

        elif request.rating == 2:
            interval_days = max(1, previous_interval)

        elif request.rating == 3:
            interval_days = (
                2 if previous_interval == 0
                else previous_interval * 2
            )

        else:
            interval_days = (
                4 if previous_interval == 0
                else previous_interval * 3
            )

        # 4. Tính ngày ôn tập tiếp theo
        reviewed_at = datetime.now(timezone.utc)
        next_review_at = reviewed_at + timedelta(
            days=interval_days
        )

        # 5. Lưu lịch sử ôn tập
        review_response = (
            supabase.table("flashcard_reviews")
            .insert({
                "user_id": DEMO_USER_ID,
                "flashcard_id": str(request.flashcard_id),
                "rating": request.rating,
                "response_time_seconds": request.response_time_seconds,
                "reviewed_at": reviewed_at.isoformat(),
                "interval_days": interval_days,
                "next_review_at": next_review_at.isoformat()
            })
            .execute()
        )

        return {
            "message": "Lưu kết quả ôn tập thành công!",
            "flashcard_id": str(request.flashcard_id),
            "rating": request.rating,
            "interval_days": interval_days,
            "next_review_at": next_review_at.isoformat(),
            "data": review_response.data
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lưu kết quả ôn tập: {str(error)}"
        )
@app.get("/api/flashcards/due")
def get_due_flashcards(topic_id: UUID | None = None):
    try:
        # 1. Lấy danh sách Flashcard đang hoạt động
        query = (
            supabase.table("flashcards")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "active")
        )

        if topic_id:
            query = query.eq("topic_id", str(topic_id))

        flashcard_response = query.execute()
        flashcards = flashcard_response.data

        if not flashcards:
            return {
                "message": "Không có Flashcard cần ôn tập.",
                "total_due": 0,
                "data": []
            }

        # 2. Lấy lịch sử ôn tập
        review_response = (
            supabase.table("flashcard_reviews")
            .select(
                "flashcard_id, interval_days, reviewed_at, next_review_at"
            )
            .eq("user_id", DEMO_USER_ID)
            .order("reviewed_at", desc=True)
            .execute()
        )

        # 3. Lấy lần ôn tập gần nhất của từng Flashcard
        latest_reviews = {}

        for review in review_response.data:
            flashcard_id = review["flashcard_id"]

            if flashcard_id not in latest_reviews:
                latest_reviews[flashcard_id] = review

        # 4. Xác định Flashcard đến hạn
        now = datetime.now(timezone.utc)
        due_flashcards = []

        for card in flashcards:
            review = latest_reviews.get(card["id"])

            # Chưa từng ôn tập
            if not review:
                due_flashcards.append({
                    **card,
                    "last_reviewed_at": None,
                    "interval_days": 0,
                    "next_review_at": None
                })
                continue

            next_review_at = review["next_review_at"]

            # Chưa có lịch ôn tiếp theo
            if not next_review_at:
                is_due = True
            else:
                next_review = datetime.fromisoformat(
                    next_review_at.replace("Z", "+00:00")
                )
                is_due = next_review <= now

            if is_due:
                due_flashcards.append({
                    **card,
                    "last_reviewed_at": review["reviewed_at"],
                    "interval_days": review["interval_days"],
                    "next_review_at": next_review_at
                })

        return {
            "message": "Lấy danh sách Flashcard đến hạn thành công!",
            "total_due": len(due_flashcards),
            "data": due_flashcards
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy Flashcard đến hạn: {str(error)}"
        )

@app.get("/api/flashcards")
def get_flashcards(topic_id: UUID | None = None):
    try:
        # 1. Lấy danh sách Flashcard đang hoạt động
        query = (
            supabase.table("flashcards")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "active")
        )

        # 2. Lọc theo chủ đề nếu có yêu cầu
        if topic_id:
            query = query.eq("topic_id", str(topic_id))

        # 3. Sắp xếp Flashcard mới nhất trước
        response = (
            query
            .order("created_at", desc=True)
            .execute()
        )

        flashcards = response.data or []

        return {
            "message": "Lấy danh sách Flashcard thành công!",
            "total": len(flashcards),
            "data": flashcards
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy danh sách Flashcard: {str(error)}"
        )



@app.post("/api/review-plans/{review_plan_id}/generate-retake-quiz")
def generate_retake_quiz(
    review_plan_id: UUID,
    request: RetakeQuizGenerateRequest
):
    try:
        # 1. Kiểm tra Review Plan
        review_response = (
            supabase.table("review_plans")
            .select("*")
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not review_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kế hoạch ôn tập."
            )

        review_plan = review_response.data[0]

        if review_plan["status"] not in ["pending", "in_progress"]:
            raise HTTPException(
                status_code=400,
                detail="Kế hoạch ôn tập không còn hoạt động."
            )

        if review_plan.get("retake_quiz_id"):
            raise HTTPException(
                status_code=409,
                detail="Kế hoạch này đã có Retake Quiz. Bạn có thể làm lại Quiz hiện tại."
            )

        # 2. Kiểm tra số lượng câu hỏi và tỷ lệ 30/70
        total_questions = request.number_of_questions

        if total_questions < 10 or total_questions % 10 != 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Số câu hỏi Retake Quiz phải từ 10 câu "
                    "và là bội số của 10 để bảo đảm tỷ lệ 30/70."
                )
            )

        mcq_count = total_questions * 30 // 100
        fill_blank_count = total_questions - mcq_count

        # 3. Lấy kết quả đánh giá
        assessment_response = (
            supabase.table("quiz_assessments")
            .select("id, quiz_id, weak_areas")
            .eq("id", str(review_plan["assessment_id"]))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not assessment_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy kết quả đánh giá."
            )

        assessment = assessment_response.data[0]
        weak_areas = assessment.get("weak_areas") or []

        if not isinstance(weak_areas, list):
            weak_areas = []

        # 4. Lấy Quiz gốc
        original_quiz_response = (
            supabase.table("quizzes")
            .select("id, title, exam_plan_id")
            .eq("id", str(assessment["quiz_id"]))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not original_quiz_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy Quiz gốc."
            )

        original_quiz = original_quiz_response.data[0]

        # 5. Lấy nguồn tài liệu từ câu hỏi Quiz gốc
        original_questions_response = (
            supabase.table("quiz_questions")
            .select("source_material_id, source_chunk_id")
            .eq("quiz_id", str(original_quiz["id"]))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        original_questions = original_questions_response.data or []

        material_ids = list({
            str(question["source_material_id"])
            for question in original_questions
            if question.get("source_material_id")
        })

        if len(material_ids) != 1:
            raise HTTPException(
                status_code=400,
                detail="Không xác định được tài liệu nguồn của Quiz."
            )

        material_id = material_ids[0]

        original_chunk_ids = list(dict.fromkeys(
            str(question["source_chunk_id"])
            for question in original_questions
            if question.get("source_chunk_id")
        ))

        if not original_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail="Quiz gốc không có nguồn nội dung hợp lệ."
            )

        # 6. Ưu tiên các đoạn kiến thức yếu
        weak_chunk_ids = {
            str(item["source_chunk_id"])
            for item in weak_areas
            if isinstance(item, dict) and item.get("source_chunk_id")
        }

        selected_chunk_ids = [
            chunk_id
            for chunk_id in original_chunk_ids
            if chunk_id in weak_chunk_ids
        ]

        # Nếu không có nguồn yếu hợp lệ, dùng toàn bộ nguồn Quiz gốc
        if not selected_chunk_ids:
            selected_chunk_ids = original_chunk_ids

        # 7. Truy xuất nội dung tài liệu
        chunks_response = (
            supabase.table("material_chunks")
            .select("id, content, page_number")
            .eq("user_id", DEMO_USER_ID)
            .eq("material_id", material_id)
            .in_("id", selected_chunk_ids)
            .execute()
        )

        chunks_data = chunks_response.data or []

        chunk_lookup = {
            str(chunk["id"]): chunk
            for chunk in chunks_data
        }

        # Bảo đảm tất cả nguồn được chọn đều tồn tại
        missing_chunk_ids = [
            chunk_id
            for chunk_id in selected_chunk_ids
            if chunk_id not in chunk_lookup
        ]

        if missing_chunk_ids:
            raise HTTPException(
                status_code=400,
                detail="Một số đoạn tài liệu nguồn không còn tồn tại."
            )

        # Giữ đúng thứ tự nguồn tài liệu
        chunks = [
            chunk_lookup[chunk_id]
            for chunk_id in selected_chunk_ids
        ]

        valid_chunk_ids = set(selected_chunk_ids)

        chunks_text = "\n\n".join(
            [
                f"Chunk ID: {chunk['id']}\n"
                f"Trang: {chunk.get('page_number')}\n"
                f"Nội dung: {chunk['content']}"
                for chunk in chunks
            ]
        )

        weak_areas_text = json.dumps(
            weak_areas,
            ensure_ascii=False
        )

        # 8. Tạo Prompt cho AI
        prompt = f"""
Bạn là chuyên gia thiết kế bài kiểm tra ôn tập cho sinh viên.

NHIỆM VỤ:
Tạo một bài Retake Quiz tập trung vào những kiến thức
sinh viên chưa nắm vững.

CÁC CHỦ ĐỀ CẦN ÔN TẬP:
{weak_areas_text}

NỘI DUNG TÀI LIỆU GỐC:
{chunks_text}

YÊU CẦU:
- Tổng cộng chính xác {total_questions} câu hỏi.
- Có chính xác {mcq_count} câu trắc nghiệm một đáp án.
- Có chính xác {fill_blank_count} câu điền vào chỗ trống.
- Câu hỏi tập trung vào các chủ đề còn yếu.
- Chỉ sử dụng kiến thức trong tài liệu được cung cấp.
- Mỗi câu hỏi phải có source_chunk_id thuộc danh sách Chunk ID.
- Không tạo câu hỏi trùng lặp.
- Độ khó từ 1 đến 5.
- Câu trắc nghiệm có đúng 4 lựa chọn A, B, C, D.
- Câu điền khuyết phải có đáp án rõ ràng.

ĐỊNH DẠNG JSON BẮT BUỘC:
{{
    "questions": [
        {{
            "question_type": "single_choice",
            "question_text": "Nội dung câu hỏi",
            "options": {{
                "A": "Đáp án A",
                "B": "Đáp án B",
                "C": "Đáp án C",
                "D": "Đáp án D"
            }},
            "correct_answer": "A",
            "explanation": "Giải thích đáp án",
            "difficulty_level": 2,
            "source_chunk_id": "UUID"
        }},
        {{
            "question_type": "fill_blank",
            "question_text": "Nội dung câu hỏi có chỗ trống ____",
            "options": {{}},
            "correct_answer": "Đáp án chính xác",
            "explanation": "Giải thích đáp án",
            "difficulty_level": 2,
            "source_chunk_id": "UUID"
        }}
    ]
}}

Chỉ trả về JSON hợp lệ, không thêm Markdown.
"""

        # 9. Gọi AI Groq
        ai_response = generate_text(prompt)
        cleaned_response = ai_response.strip()

        if cleaned_response.startswith("```"):
            cleaned_response = cleaned_response.split("\n", 1)[1]
            cleaned_response = cleaned_response.rsplit("```", 1)[0].strip()

        result = json.loads(cleaned_response)
        questions = result.get("questions", [])

        if not isinstance(questions, list):
            raise HTTPException(
                status_code=502,
                detail="AI trả về dữ liệu câu hỏi không hợp lệ."
            )

        if len(questions) != total_questions:
            raise HTTPException(
                status_code=502,
                detail="AI tạo không đúng số lượng câu hỏi yêu cầu."
            )

        # 10. Kiểm tra chất lượng câu hỏi
        actual_mcq_count = 0
        actual_fill_blank_count = 0
        question_texts = set()

        for question in questions:
            if not isinstance(question, dict):
                raise HTTPException(
                    status_code=502,
                    detail="Dữ liệu câu hỏi AI không hợp lệ."
                )

            question_type = question.get("question_type")
            question_text = str(question.get("question_text", "")).strip()

            if not question_text:
                raise HTTPException(
                    status_code=502,
                    detail="Câu hỏi không được để trống."
                )

            normalized_question = question_text.casefold()

            if normalized_question in question_texts:
                raise HTTPException(
                    status_code=502,
                    detail="AI tạo câu hỏi trùng lặp."
                )

            question_texts.add(normalized_question)

            if question_type == "single_choice":
                actual_mcq_count += 1

                options = question.get("options")

                if not isinstance(options, dict) or set(options.keys()) != {
                    "A", "B", "C", "D"
                }:
                    raise HTTPException(
                        status_code=502,
                        detail="Câu trắc nghiệm có bộ đáp án không hợp lệ."
                    )

                if question.get("correct_answer") not in [
                    "A", "B", "C", "D"
                ]:
                    raise HTTPException(
                        status_code=502,
                        detail="Đáp án trắc nghiệm không hợp lệ."
                    )

                if any(
                    not str(value).strip()
                    for value in options.values()
                ):
                    raise HTTPException(
                        status_code=502,
                        detail="Lựa chọn trắc nghiệm không được để trống."
                    )

            elif question_type == "fill_blank":
                actual_fill_blank_count += 1
                question["options"] = {}

                if not str(question.get("correct_answer", "")).strip():
                    raise HTTPException(
                        status_code=502,
                        detail="Câu điền khuyết chưa có đáp án."
                    )

            else:
                raise HTTPException(
                    status_code=502,
                    detail="AI tạo loại câu hỏi không được hỗ trợ."
                )

            if str(question.get("source_chunk_id")) not in valid_chunk_ids:
                raise HTTPException(
                    status_code=502,
                    detail="Câu hỏi tham chiếu đến nguồn tài liệu không hợp lệ."
                )

            difficulty = question.get("difficulty_level")

            if (
                not isinstance(difficulty, int)
                or isinstance(difficulty, bool)
                or not 1 <= difficulty <= 5
            ):
                raise HTTPException(
                    status_code=502,
                    detail="Độ khó câu hỏi không hợp lệ."
                )

        if (
            actual_mcq_count != mcq_count
            or actual_fill_blank_count != fill_blank_count
        ):
            raise HTTPException(
                status_code=502,
                detail="AI không tạo đúng tỷ lệ câu hỏi 30/70."
            )

        # 11. Tạo Quiz ôn tập
        quiz_response = (
            supabase.table("quizzes")
            .insert({
                "user_id": DEMO_USER_ID,
                "exam_plan_id": original_quiz["exam_plan_id"],
                "study_session_id": None,
                "title": f"Ôn tập lại - {original_quiz['title']}",
                "description": review_plan.get("overall_goal"),
                "source_mode": "textbook",
                "time_limit_minutes": request.time_limit_minutes,
                "status": "active"
            })
            .execute()
        )

        if not quiz_response.data:
            raise Exception("Không thể tạo Retake Quiz.")

        new_quiz = quiz_response.data[0]
        new_quiz_id = str(new_quiz["id"])

        # 12. Lưu câu hỏi vào Database
        question_records = []

        for index, question in enumerate(questions, start=1):
            question_records.append({
                "quiz_id": new_quiz_id,
                "user_id": DEMO_USER_ID,
                "source_material_id": material_id,
                "source_chunk_id": str(question["source_chunk_id"]),
                "source_type": "textbook",
                "question_text": question["question_text"],
                "question_type": question["question_type"],
                "options": question["options"],
                "correct_answer": question["correct_answer"],
                "explanation": question.get("explanation", ""),
                "difficulty_level": question["difficulty_level"],
                "points": 1,
                "question_order": index,
                "status": "ready"
            })

        saved_questions_response = (
            supabase.table("quiz_questions")
            .insert(question_records)
            .execute()
        )

        if len(saved_questions_response.data or []) != total_questions:
            raise Exception("Không thể lưu đầy đủ câu hỏi Retake Quiz.")

        # 13. Liên kết Quiz với Review Plan
        update_response = (
            supabase.table("review_plans")
            .update({
                "retake_quiz_id": new_quiz_id,
                "status": "in_progress",
                "updated_at": datetime.now(timezone.utc).isoformat()
            })
            .eq("id", str(review_plan_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not update_response.data:
            raise Exception("Không thể liên kết Retake Quiz với Review Plan.")

        # 14. Trả kết quả
        return {
            "message": "Tạo Retake Quiz thành công!",
            "review_plan_id": str(review_plan_id),
            "quiz_id": new_quiz_id,
            "title": new_quiz["title"],
            "total_questions": len(saved_questions_response.data),
            "single_choice_questions": mcq_count,
            "fill_blank_questions": fill_blank_count,
            "time_limit_minutes": request.time_limit_minutes,
            "status": "active"
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo Retake Quiz: {str(error)}")

@app.post("/api/quiz-attempts/{attempt_id}/submit")
def submit_quiz_attempt(attempt_id: UUID):
    try:
        # 1. Kiểm tra lượt làm bài
        attempt_response = (
            supabase.table("quiz_attempts")
            .select("*")
            .eq("id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not attempt_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy lượt làm bài."
            )

        attempt = attempt_response.data[0]

        if attempt["status"] != "in_progress":
            raise HTTPException(
                status_code=400,
                detail="Lượt làm bài đã được nộp hoặc không còn hoạt động."
            )

        # 2. Lấy toàn bộ câu hỏi
        questions_response = (
            supabase.table("quiz_questions")
            .select(
                "id, question_text, question_type, options, "
                "correct_answer, explanation, points, question_order, "
                "source_chunk_id, source_material_id"
            )
            .eq("quiz_id", attempt["quiz_id"])
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "ready")
            .order("question_order")
            .execute()
        )

        questions = questions_response.data or []

        if not questions:
            raise HTTPException(
                status_code=400,
                detail="Quiz không có câu hỏi để chấm điểm."
            )

        # 3. Lấy câu trả lời của sinh viên
        answers_response = (
            supabase.table("quiz_answers")
            .select("*")
            .eq("attempt_id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        answers = {
            str(answer["question_id"]): answer
            for answer in (answers_response.data or [])
        }

        # 4. Chấm điểm
        correct_count = 0
        earned_points = 0
        total_points = 0
        results = []

        for question in questions:
            question_id = question["id"]
            question_id_str = str(question_id)

            points = float(question.get("points") or 1)
            total_points += points

            answer = answers.get(question_id_str)

            correct_answer = question.get("correct_answer")
            selected_answer = (
                answer.get("selected_answer")
                if answer
                else None
            )

            # 4.1. Chấm câu hỏi điền khuyết
            if not answer:
                is_correct = False

            elif question["question_type"] == "fill_blank":
                expected_answers = (
                    correct_answer
                    if isinstance(correct_answer, list)
                    else [correct_answer]
                )

                normalized_selected = normalize_answer(
                    selected_answer
                )

                is_correct = any(
                    normalized_selected == normalize_answer(expected)
                    for expected in expected_answers
                    if expected is not None
                )

            # 4.2. Chấm câu hỏi trắc nghiệm
            elif question["question_type"] == "multiple_choice":
                is_correct = (
                    isinstance(selected_answer, list)
                    and isinstance(correct_answer, list)
                    and set(selected_answer) == set(correct_answer)
                )

            else:
                is_correct = selected_answer == correct_answer

            question_earned_points = (
                points if is_correct else 0
            )

            if is_correct:
                correct_count += 1
                earned_points += points

            # 4.3. Cập nhật câu trả lời
            if answer:
                (
                    supabase.table("quiz_answers")
                    .update({
                        "is_correct": is_correct,
                        "earned_points": question_earned_points,
                        "graded_at": datetime.now(
                            timezone.utc
                        ).isoformat()
                    })
                    .eq("id", answer["id"])
                    .eq("user_id", DEMO_USER_ID)
                    .execute()
                )

            results.append({
                "question_id": question_id,
                "question_text": question["question_text"],
                "question_type": question["question_type"],
                "selected_answer": selected_answer,
                "correct_answer": correct_answer,
                "is_correct": is_correct,
                "points": points,
                "earned_points": question_earned_points,
                "explanation": question.get("explanation"),
                "source_chunk_id": question.get("source_chunk_id"),
                "source_material_id": question.get("source_material_id")
            })

        # 5. Truy xuất nội dung tài liệu nguồn
        chunk_ids = list({
            str(result["source_chunk_id"])
            for result in results
            if result.get("source_chunk_id")
        })

        chunks_by_id = {}

        if chunk_ids:
            chunks_response = (
                supabase.table("material_chunks")
                .select(
                    "id, content, page_number, chunk_index, material_id"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("id", chunk_ids)
                .execute()
            )

            chunks_by_id = {
                str(chunk["id"]): chunk
                for chunk in (chunks_response.data or [])
            }

        # 6. Truy xuất Topic liên quan đến câu hỏi
        question_ids = [
            str(result["question_id"])
            for result in results
        ]

        mappings_response = (
            supabase.table("question_topic_mappings")
            .select("question_id, topic_id")
            .eq("user_id", DEMO_USER_ID)
            .eq("mapping_status", "mapped")
            .in_("question_id", question_ids)
            .execute()
        )

        topic_ids_by_question = {}

        for mapping in (mappings_response.data or []):
            topic_ids_by_question.setdefault(
                str(mapping["question_id"]),
                []
            ).append(str(mapping["topic_id"]))

        all_topic_ids = list({
            topic_id
            for topic_ids in topic_ids_by_question.values()
            for topic_id in topic_ids
        })

        topics_by_id = {}

        if all_topic_ids:
            topics_response = (
                supabase.table("topics")
                .select(
                    "id, name, description, hierarchy, difficulty_level"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("id", all_topic_ids)
                .execute()
            )

            topics_by_id = {
                str(topic["id"]): topic
                for topic in (topics_response.data or [])
            }

        # 7. Ghép dữ liệu nguồn vào từng câu trả lời
        for result in results:
            chunk_id = result.get("source_chunk_id")

            source_chunk = (
                chunks_by_id.get(str(chunk_id))
                if chunk_id
                else None
            )

            result["source_content"] = (
                source_chunk.get("content")
                if source_chunk
                else None
            )

            result["source_page"] = (
                source_chunk.get("page_number")
                if source_chunk
                else None
            )
            result["source_location"] = (
                {
                    "page_number": source_chunk.get("page_number"),
                    "chunk_index": source_chunk.get("chunk_index"),
                    "material_id": source_chunk.get("material_id"),
                    "content": source_chunk.get("content"),
                }
                if source_chunk
                else None
            )

            result["topics"] = [
                topics_by_id[topic_id]
                for topic_id in topic_ids_by_question.get(
                    str(result["question_id"]),
                    []
                )
                if topic_id in topics_by_id
            ]

        # 8. Tính điểm phần trăm
        score = (
            round(earned_points / total_points * 100, 2)
            if total_points > 0
            else 0
        )

        # 9. Cập nhật lượt làm bài
        submitted_at = datetime.now(timezone.utc).isoformat()

        (
            supabase.table("quiz_attempts")
            .update({
                "score": score,
                "total_points": total_points,
                "correct_count": correct_count,
                "total_questions": len(questions),
                "status": "submitted",
                "submitted_at": submitted_at
            })
            .eq("id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "in_progress")
            .execute()
        )

        # 10. Phân loại kết quả
        if score > 80:
            mastery_level = "mastered"
        elif score >= 50:
            mastery_level = "needs_review"
        else:
            mastery_level = "not_mastered"

        # 11. Tạo đánh giá dự phòng
        assessment_data = {
            "mastery_level": mastery_level,
            "summary": "",
            "strengths": [],
            "weak_areas": [],
            "recommendations": []
        }

        # 11.1. Thu thập kiến thức đã nắm vững
        seen_strengths = set()

        for result in results:
            if not result["is_correct"]:
                continue

            for topic in result.get("topics", []):
                topic_name = (
                    topic.get("name")
                    or "Kiến thức liên quan"
                )

                if topic_name not in seen_strengths:
                    assessment_data["strengths"].append({
                        "topic_name": topic_name,
                        "description": (
                            "Bạn đã trả lời đúng câu hỏi thuộc kiến thức này."
                        )
                    })

                    seen_strengths.add(topic_name)

        # 11.2. Thu thập kiến thức còn yếu
        seen_weak_areas = set()

        for result in results:
            if result["is_correct"]:
                continue

            topics = result.get("topics") or []

            topic_names = [
                topic.get("name")
                for topic in topics
                if topic.get("name")
            ]

            topic_name = (
                ", ".join(topic_names)
                if topic_names
                else "Kiến thức trong câu hỏi"
            )

            source_chunk_id = result.get("source_chunk_id")

            weak_key = (
                str(source_chunk_id or ""),
                topic_name
            )

            if weak_key in seen_weak_areas:
                continue

            seen_weak_areas.add(weak_key)

            assessment_data["weak_areas"].append({
                "topic_name": topic_name,
                "hierarchy": " > ".join(
                    [
                        str(topic.get("hierarchy") or "").strip()
                        for topic in topics
                        if str(topic.get("hierarchy") or "").strip()
                    ][:1]
                ),
                "difficulty_level": max(
                    [
                        int(topic.get("difficulty_level") or 3)
                        for topic in topics
                        if str(topic.get("difficulty_level") or "").isdigit()
                    ]
                    or [3]
                ),
                "description": (
                    f"Bạn chưa trả lời chính xác câu hỏi: "
                    f"{result['question_text']}"
                ),
                "source_page": result.get("source_page"),
                "source_chunk_id": source_chunk_id,
                "source_content": result.get("source_content"),
                "recommendation": (
                    "Đọc lại nội dung tài liệu liên quan và luyện tập "
                    "thêm các câu hỏi cùng chủ đề."
                )
            })

        # 11.3. Nhận xét dự phòng theo mức điểm
        if score < 50:
            assessment_data["summary"] = (
                "Bạn chưa đạt yêu cầu của bài kiểm tra. "
                "Hãy ôn tập lại các kiến thức còn yếu trước khi kiểm tra lại."
            )

            assessment_data["recommendations"] = [
                "Đọc lại các nội dung kiến thức đã trả lời sai.",
                "Ôn tập các chủ đề còn yếu trong tài liệu.",
                "Luyện tập lại trước khi thực hiện bài kiểm tra tiếp theo."
            ]

        elif score <= 70:
            assessment_data["summary"] = (
                "Bạn đã đạt yêu cầu bài kiểm tra. "
                "Tuy nhiên, vẫn còn một số kiến thức cần củng cố thêm."
            )

            assessment_data["recommendations"] = (
                [
                    "Ôn lại những câu hỏi đã trả lời chưa chính xác.",
                    "Củng cố các chủ đề còn hạn chế."
                ]
                if assessment_data["weak_areas"]
                else []
            )

        elif score <= 80:
            assessment_data["summary"] = (
                "Bạn có kết quả học tập tốt và đã nắm được phần lớn "
                "kiến thức. Hãy tiếp tục củng cố những nội dung còn thiếu."
            )

            assessment_data["recommendations"] = (
                [
                    "Ôn lại các kiến thức còn sai để nâng cao mức độ thành thạo."
                ]
                if assessment_data["weak_areas"]
                else []
            )

        else:
            assessment_data["summary"] = (
                "Xuất sắc! Bạn đã nắm vững các kiến thức được đánh giá "
                "trong bài kiểm tra."
            )

            assessment_data["recommendations"] = []

        # 12. Gọi Groq để tạo đánh giá chi tiết
        used_ai_assessment = False

        try:
            analysis_payload = {
                "score": score,
                "correct_count": correct_count,
                "total_questions": len(questions),
                "results": results
            }

            prompt = f"""
Bạn là chuyên gia đánh giá năng lực học tập của sinh viên.

Hãy phân tích kết quả Quiz dưới đây.

DỮ LIỆU:
{json.dumps(analysis_payload, ensure_ascii=False)}

YÊU CẦU:
1. Đánh giá mức độ nắm vững kiến thức.
2. Xác định kiến thức sinh viên đã hiểu tốt.
3. Xác định kiến thức còn yếu dựa trên câu trả lời sai.
4. Với mỗi kiến thức yếu, sử dụng Topic và tài liệu nguồn
   để chỉ ra đúng chương/mục, nội dung và số trang cần học lại.
5. Đề xuất cách cải thiện cụ thể cho từng kiến thức yếu.
6. Không tự bịa số trang, chương/mục hoặc nội dung không có trong dữ liệu.
7. Mỗi weak_area phải gắn với một câu sai và giữ đúng source_page,
   source_chunk_id, source_content từ câu hỏi tương ứng.
8. Nếu không có câu sai, weak_areas phải là [].

QUY TẮC ĐÁNH GIÁ:
- Dưới 50 điểm: Chưa đạt, cần ôn tập và kiểm tra lại.
- Từ 50 đến 70 điểm: Đạt, cần chỉ ra nội dung cải thiện.
- Trên 70 đến 80 điểm: Kết quả tốt.
- Trên 80 điểm: Xuất sắc, không cần đề xuất cải thiện.

CHỈ TRẢ VỀ JSON HỢP LỆ, KHÔNG DÙNG MARKDOWN.

CẤU TRÚC:
{{
    "mastery_level": "mastered | needs_review | not_mastered",
    "summary": "Nhận xét tổng quan",
    "strengths": [
        {{
            "topic_name": "Tên kiến thức",
            "description": "Nội dung đã nắm vững"
        }}
    ],
    "weak_areas": [
        {{
            "topic_name": "Tên kiến thức còn yếu",
            "hierarchy": "Chương/Mục trong tài liệu",
            "description": "Nội dung chưa hiểu",
            "source_page": 1,
            "source_chunk_id": "UUID hoặc null",
            "source_content": "Nội dung tài liệu liên quan",
            "recommendation": "Hướng dẫn học lại"
        }}
    ],
    "recommendations": [
        "Đề xuất cải thiện"
    ]
}}
"""

            ai_response = generate_text(prompt).strip()

            if ai_response.startswith("```"):
                ai_response = ai_response.split(
                    "\n",
                    1
                )[1]

                ai_response = ai_response.rsplit(
                    "```",
                    1
                )[0].strip()

            generated_assessment = json.loads(ai_response)

            if not isinstance(generated_assessment, dict):
                raise ValueError("AI trả về dữ liệu không hợp lệ.")

            for field in [
                "strengths",
                "weak_areas",
                "recommendations"
            ]:
                if not isinstance(
                    generated_assessment.get(field),
                    list
                ):
                    raise ValueError(
                        f"AI trả về {field} không hợp lệ."
                    )

            if not isinstance(
                generated_assessment.get("summary"),
                str
            ):
                raise ValueError(
                    "AI trả về summary không hợp lệ."
                )

            # Không để AI tự quyết định mức độ thành thạo
            generated_assessment["mastery_level"] = mastery_level

            deterministic_weak_areas = assessment_data["weak_areas"]
            generated_weak_areas = generated_assessment.get(
                "weak_areas",
                []
            )

            # Không để AI làm mất vị trí tài liệu hoặc bỏ qua câu sai.
            if deterministic_weak_areas and not generated_weak_areas:
                generated_weak_areas = deterministic_weak_areas

            for generated_item in generated_weak_areas:
                if not isinstance(generated_item, dict):
                    continue

                generated_topic = str(
                    generated_item.get("topic_name") or ""
                ).casefold()
                matching_item = next(
                    (
                        item
                        for item in deterministic_weak_areas
                        if generated_topic
                        and generated_topic in str(
                            item.get("topic_name") or ""
                        ).casefold()
                    ),
                    None
                )

                if matching_item:
                    for field in [
                        "hierarchy",
                        "source_page",
                        "source_chunk_id",
                        "source_content"
                    ]:
                        if not generated_item.get(field):
                            generated_item[field] = matching_item.get(field)

            generated_assessment["weak_areas"] = generated_weak_areas

            assessment_data = generated_assessment
            used_ai_assessment = True

        except Exception as ai_error:
            print(
                "Groq gặp lỗi, sử dụng đánh giá dự phòng:",
                str(ai_error)
            )

        # 13. Lưu đánh giá vào database.
        assessment_persisted = True
        assessment_save_error = None

        try:
            assessment_insert_response = (
                supabase.table("quiz_assessments")
                .insert({
                    "user_id": DEMO_USER_ID,
                    "quiz_attempt_id": str(attempt_id),
                    "quiz_id": attempt["quiz_id"],
                    "mastery_level": mastery_level,
                    "summary": assessment_data["summary"],
                    "strengths": assessment_data["strengths"],
                    "weak_areas": assessment_data["weak_areas"],
                    "recommendations": assessment_data["recommendations"],
                    "ai_model": (
                        "Groq"
                        if used_ai_assessment
                        else "Fallback"
                    ),
                    "assessment_status": "completed"
                })
                .execute()
            )

            if not assessment_insert_response.data:
                raise Exception("Không nhận được bản ghi đánh giá.")

            ai_assessment = assessment_insert_response.data[0]

        except Exception as assessment_error:
            # Không để lỗi quyền của bảng đánh giá làm mất kết quả Quiz.
            assessment_persisted = False
            assessment_save_error = (
                "Không thể lưu đánh giá năng lực vào hệ thống. "
                "Kết quả Quiz vẫn được giữ lại."
            )
            print(
                "Không thể lưu quiz_assessments:",
                str(assessment_error)
            )
            ai_assessment = {
                **assessment_data,
                "id": None,
                "quiz_attempt_id": str(attempt_id),
                "quiz_id": attempt["quiz_id"],
                "assessment_status": "not_persisted"
            }

        
        # 14. Kiểm tra bài hiện tại có phải Retake Quiz không
        review_plan = None
        existing_retake_response = (
            supabase.table("review_plans")
            .select("id, status, retake_quiz_id")
            .eq("user_id", DEMO_USER_ID)
            .eq("retake_quiz_id", str(attempt["quiz_id"]))
            .limit(1)
            .execute()
        )

        existing_retake_plan = (
            existing_retake_response.data[0]
            if existing_retake_response.data
            else None
        )

        if existing_retake_plan:
            review_plan = existing_retake_plan

            # 14.1. Đây là bài kiểm tra lại
            if score < 50:
                (
                    supabase.table("review_plans")
                    .update({
                        "status": "pending",
                        "review_study_started_at": None,
                        "review_study_last_activity_at": None,
                        "review_study_seconds": 0,
                        "review_study_completed_at": None
                    })
                    .eq("id", existing_retake_plan["id"])
                    .eq("user_id", DEMO_USER_ID)
                    .execute()
                )

                print(
                    "Retake Quiz chưa đạt. "
                    "Giữ nguyên bài kiểm tra lại và yêu cầu "
                    "ôn tập thêm 15 phút."
                )

            else:
                (
                    supabase.table("review_plans")
                    .update({
                        "status": "completed"
                    })
                    .eq("id", existing_retake_plan["id"])
                    .eq("user_id", DEMO_USER_ID)
                    .execute()
                )

                print(
                    "Đã hoàn thành kế hoạch ôn tập."
                )

        elif assessment_persisted and assessment_data["weak_areas"]:
            # 14.2. Tạo Review Plan cho mọi bài có kiến thức yếu,
            # không chỉ các bài dưới 50 điểm.

            weak_areas = assessment_data["weak_areas"]
            review_items = []

            # 14.2.1. Tạo nội dung học bổ trợ bằng AI
            if weak_areas:
                try:
                    supplemental_payload = []

                    for index, weak_area in enumerate(weak_areas):
                        supplemental_payload.append({
                            "index": index,
                            "topic_name": weak_area.get(
                                "topic_name",
                                "Kiến thức cần củng cố"
                            ),
                            "description": weak_area.get(
                                "description",
                                ""
                            ),
                            "source_content": weak_area.get(
                                "source_content",
                                ""
                            ),
                            "source_page": weak_area.get(
                                "source_page"
                            ),
                            "recommendation": weak_area.get(
                                "recommendation",
                                ""
                            )
                        })

                    supplemental_prompt = f"""
Bạn là giảng viên chuyên thiết kế nội dung học bổ trợ
cho sinh viên dựa trên tài liệu học tập gốc.

Sinh viên vừa hoàn thành một Quiz và có các kiến thức
chưa nắm vững được liệt kê dưới đây.

DỮ LIỆU KIẾN THỨC CẦN CỦNG CỐ:
{json.dumps(supplemental_payload, ensure_ascii=False)}

NHIỆM VỤ:
Với MỖI kiến thức yếu, hãy tạo một nội dung học bổ trợ
ngắn gọn, dễ hiểu và tập trung đúng phần sinh viên chưa nắm vững.

YÊU CẦU:
1. Giải thích lại kiến thức dựa trên source_content.
2. Ưu tiên những khái niệm và ý chính quan trọng.
3. Không sao chép nguyên văn toàn bộ tài liệu.
4. Không tự thêm kiến thức không có căn cứ trong tài liệu.
5. Chia nội dung thành các mục nhỏ có tiêu đề rõ ràng.
6. Mỗi mục phải có heading, content và key_points.
7. Heading chỉ ghi tên mục chính, không ghi ngày tháng,
   Chapter hoặc số mục như 1.1, 1.1.1.
8. Content phải giải thích dễ hiểu, không viết thành một
   đoạn văn quá dài.
9. key_points gồm 2 đến 5 ý ngắn lấy từ content thật;
   không được lặp lại heading hoặc ghi tiêu đề thay cho nội dung.
10. learning_objective phải nêu rõ sinh viên cần hiểu
    hoặc ghi nhớ điều gì sau khi học.
11. Giữ nguyên thứ tự index của từng kiến thức đầu vào.
12. Không tự bịa số trang hoặc trích dẫn tài liệu.

CHỈ TRẢ VỀ JSON HỢP LỆ, KHÔNG DÙNG MARKDOWN.

CẤU TRÚC:
{{
    "learning_path": [
        {{
            "index": 0,
            "topic_name": "Tên kiến thức",
            "learning_objective": "Mục tiêu học tập",
            "content_sections": [
                {{
                    "heading": "Tiêu đề nội dung",
                    "content": "Giải thích kiến thức",
                    "key_points": [
                        "Ý chính 1",
                        "Ý chính 2"
                    ]
                }}
            ]
        }}
    ]
}}
"""

                    supplemental_response = generate_text(
                        supplemental_prompt
                    ).strip()

                    if supplemental_response.startswith("```"):
                        supplemental_response = supplemental_response.split(
                            "\n",
                            1
                        )[1]

                        supplemental_response = (
                            supplemental_response.rsplit(
                                "```",
                                1
                            )[0].strip()
                        )

                    generated_path = json.loads(
                        supplemental_response
                    )

                    if not isinstance(generated_path, dict):
                        raise ValueError(
                            "AI trả về learning_path không hợp lệ."
                        )

                    generated_items = generated_path.get(
                        "learning_path"
                    )

                    if not isinstance(generated_items, list):
                        raise ValueError(
                            "AI không trả về danh sách learning_path."
                        )

                    generated_by_index = {}

                    for generated_item in generated_items:
                        if not isinstance(generated_item, dict):
                            continue

                        generated_index = generated_item.get("index")

                        if isinstance(generated_index, int):
                            generated_by_index[generated_index] = (
                                generated_item
                            )

                    # Chuẩn hóa nội dung bổ trợ theo từng kiến thức yếu
                    for index, weak_area in enumerate(weak_areas):
                        generated_item = generated_by_index.get(
                            index,
                            {}
                        )

                        sections = generated_item.get(
                            "content_sections",
                            []
                        )

                        if not isinstance(sections, list):
                            sections = []

                        valid_sections = []

                        for section in sections:
                            if not isinstance(section, dict):
                                continue

                            heading = str(
                                section.get("heading") or ""
                            ).strip()

                            content = str(
                                section.get("content") or ""
                            ).strip()

                            key_points = section.get(
                                "key_points",
                                []
                            )

                            if not isinstance(key_points, list):
                                key_points = []

                            key_points = get_content_key_points(
                                heading,
                                key_points
                            )

                            if heading and content:
                                valid_sections.append({
                                    "heading": heading,
                                    "content": content,
                                    "key_points": key_points
                                })

                        # Nội dung dự phòng nếu AI không tạo được
                        # phần học bổ trợ cho một kiến thức cụ thể.
                        if not valid_sections:
                            fallback_content = str(
                                weak_area.get("source_content")
                                or weak_area.get("description")
                                or weak_area.get("recommendation")
                                or "Hãy đọc lại kiến thức này trong tài liệu gốc."
                            ).strip()

                            valid_sections = [{
                                "heading": str(
                                    weak_area.get("topic_name")
                                    or "Kiến thức cần củng cố"
                                ),
                                "content": fallback_content,
                                "key_points": []
                            }]

                        review_item = dict(weak_area)

                        review_item["supplemental_content"] = {
                            "learning_objective": str(
                                generated_item.get(
                                    "learning_objective"
                                )
                                or weak_area.get("recommendation")
                                or "Củng cố kiến thức còn yếu."
                            ),
                            "content_sections": valid_sections
                        }

                        review_items.append(review_item)

                except Exception as supplemental_error:
                    print(
                        "Lỗi tạo nội dung học bổ trợ bằng AI:",
                        str(supplemental_error)
                    )

                    # Không để lỗi tạo nội dung bổ trợ làm hỏng
                    # quá trình nộp Quiz và lưu kết quả.
                    review_items = []

                    for weak_area in weak_areas:
                        review_item = dict(weak_area)

                        fallback_content = str(
                            weak_area.get("source_content")
                            or weak_area.get("description")
                            or weak_area.get("recommendation")
                            or "Hãy đọc lại kiến thức này trong tài liệu gốc."
                        ).strip()

                        review_item["supplemental_content"] = {
                            "learning_objective": str(
                                weak_area.get("recommendation")
                                or "Củng cố kiến thức còn yếu."
                            ),
                            "content_sections": [{
                                "heading": str(
                                    weak_area.get("topic_name")
                                    or "Kiến thức cần củng cố"
                                ),
                                "content": fallback_content,
                                "key_points": []
                            }]
                        }

            # Gán nội dung yếu vào những ngày chưa có buổi học chính.
            # Lịch nằm trong review_items nên vẫn được lưu cùng Review Plan.
            try:
                quiz_context_response = (
                    supabase.table("quizzes")
                    .select("exam_plan_id")
                    .eq("id", str(attempt["quiz_id"]))
                    .eq("user_id", DEMO_USER_ID)
                    .limit(1)
                    .execute()
                )
                quiz_context = (
                    quiz_context_response.data[0]
                    if quiz_context_response.data
                    else {}
                )
                exam_plan_id = quiz_context.get("exam_plan_id")

                if exam_plan_id and review_items:
                    plan_response = (
                        supabase.table("exam_plans")
                        .select("exam_date")
                        .eq("id", str(exam_plan_id))
                        .eq("user_id", DEMO_USER_ID)
                        .limit(1)
                        .execute()
                    )
                    exam_date_value = (
                        plan_response.data[0].get("exam_date")
                        if plan_response.data
                        else None
                    )
                    topic_response = (
                        supabase.table("topics")
                        .select("id")
                        .eq("exam_plan_id", str(exam_plan_id))
                        .eq("user_id", DEMO_USER_ID)
                        .eq("is_active", True)
                        .execute()
                    )
                    topic_ids = [
                        str(topic["id"])
                        for topic in (topic_response.data or [])
                    ]
                    occupied_dates = set()

                    if topic_ids:
                        session_response = (
                            supabase.table("study_sessions")
                            .select("scheduled_start")
                            .eq("user_id", DEMO_USER_ID)
                            .in_("topic_id", topic_ids)
                            .execute()
                        )
                        occupied_dates = {
                            str(session["scheduled_start"])[:10]
                            for session in (session_response.data or [])
                            if session.get("scheduled_start")
                        }

                    primary_study_weekdays = set()
                    for occupied_date in occupied_dates:
                        try:
                            primary_study_weekdays.add(
                                date.fromisoformat(
                                    occupied_date
                                ).weekday()
                            )
                        except ValueError:
                            continue

                    vietnam_today = datetime.now(
                        timezone(timedelta(hours=7))
                    ).date()
                    exam_date = (
                        date.fromisoformat(str(exam_date_value))
                        if exam_date_value
                        else vietnam_today + timedelta(days=14)
                    )
                    available_dates = []
                    candidate_date = vietnam_today + timedelta(days=1)

                    while (
                        candidate_date < exam_date
                        and len(available_dates) < len(review_items)
                    ):
                        candidate_key = candidate_date.isoformat()
                        is_free_day = (
                            candidate_key not in occupied_dates
                            and (
                                not primary_study_weekdays
                                or candidate_date.weekday()
                                not in primary_study_weekdays
                            )
                        )

                        if is_free_day:
                            available_dates.append(candidate_key)
                        candidate_date += timedelta(days=1)

                    # Nếu lịch chính phủ kín cả tuần, vẫn gán vào ngày
                    # trống gần nhất để người học không mất lịch ôn.
                    if len(available_dates) < len(review_items):
                        candidate_date = vietnam_today + timedelta(days=1)

                        while (
                            candidate_date < exam_date
                            and len(available_dates) < len(review_items)
                        ):
                            candidate_key = candidate_date.isoformat()

                            if candidate_key not in occupied_dates:
                                available_dates.append(candidate_key)

                            candidate_date += timedelta(days=1)

                    priority_items = sorted(
                        enumerate(review_items),
                        key=lambda item: -int(
                            item[1].get("difficulty_level") or 3
                        )
                    )

                    for schedule_index, (_, review_item) in enumerate(
                        priority_items
                    ):
                        review_item["scheduled_date"] = (
                            available_dates[schedule_index]
                            if schedule_index < len(available_dates)
                            else None
                        )
            except Exception as schedule_error:
                print(
                    "Không thể tạo lịch ôn tập bổ trợ:",
                    str(schedule_error)
                )

            # 14.2.2. Lưu Review Plan và nội dung bổ trợ
            review_plan_response = (
                supabase.table("review_plans")
                .insert({
                    "user_id": DEMO_USER_ID,
                    "assessment_id": ai_assessment["id"],
                    "review_items": review_items,
                    "overall_goal": assessment_data["summary"],
                    "status": "pending"
                })
                .execute()
            )

            if review_plan_response.data:
                review_plan = review_plan_response.data[0]

                print(
                    "Đã tạo Review Plan:",
                    review_plan["id"]
                )

                print(
                    "Số kiến thức cần học bổ trợ:",
                    len(review_items)
                )

                # Chỉ tạo bài kiểm tra lại khi điểm dưới 50%.
                if score < 50:
                    try:
                        retake_quiz = generate_retake_quiz(
                            UUID(str(review_plan["id"])),
                            RetakeQuizGenerateRequest(
                                number_of_questions=10,
                                time_limit_minutes=15
                            )
                        )

                        print(
                            "Đã tạo Retake Quiz:",
                            retake_quiz.get("quiz_id")
                        )

                    except Exception as retake_error:
                        print(
                            "Lỗi tự động tạo Retake Quiz:",
                            str(retake_error)
                        )

                else:
                    print(
                        "Quiz đạt từ 70 điểm trở lên, không yêu cầu "
                        "bài kiểm tra lại."
                    )

        # 15. Trả kết quả
        return {
            "message": "Nộp bài và chấm điểm thành công!",
            "attempt_id": str(attempt_id),
            "score": score,
            "correct_count": correct_count,
            "total_questions": len(questions),
            "earned_points": earned_points,
            "total_points": total_points,
            "status": "submitted",
            "results": results,
            "ai_assessment": ai_assessment,
            "review_plan": review_plan,
            "assessment_persisted": assessment_persisted,
            "assessment_save_error": assessment_save_error,
            "next_session_unlocked": score >= 50,
            "requires_retake": score < 50
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể nộp bài Quiz: {str(error)}"
        )


@app.get("/api/quiz-attempts/{attempt_id}/result")
def get_quiz_attempt_result(attempt_id: UUID):
    try:
        # 1. Kiểm tra lượt làm bài
        attempt_response = (
            supabase.table("quiz_attempts")
            .select("*")
            .eq("id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not attempt_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy lượt làm bài."
            )

        attempt = attempt_response.data[0]

        if attempt["status"] != "submitted":
            raise HTTPException(
                status_code=400,
                detail="Lượt làm bài chưa được nộp."
            )

        # 2. Lấy thông tin Quiz
        quiz_response = (
            supabase.table("quizzes")
            .select("id, title")
            .eq("id", attempt["quiz_id"])
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        if not quiz_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy Quiz."
            )

        # 3. Lấy danh sách câu hỏi
        questions_response = (
            supabase.table("quiz_questions")
            .select(
                "id, question_text, correct_answer, "
                "explanation, points, question_order, "
                "source_chunk_id"
            )
            .eq("quiz_id", attempt["quiz_id"])
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "ready")
            .order("question_order")
            .execute()
        )

        questions = questions_response.data or []

        # 4. Lấy câu trả lời của sinh viên
        answers_response = (
            supabase.table("quiz_answers")
            .select(
                "question_id, selected_answer, "
                "is_correct, earned_points"
            )
            .eq("attempt_id", str(attempt_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        answers_by_question = {
            str(answer["question_id"]): answer
            for answer in (answers_response.data or [])
        }

        # 5. Lấy vị trí tài liệu nguồn của các câu hỏi
        source_chunk_ids = list({
            str(question["source_chunk_id"])
            for question in questions
            if question.get("source_chunk_id")
        })

        source_chunk_map = {}

        if source_chunk_ids:
            chunk_response = (
                supabase.table("material_chunks")
                .select(
                    "id, content, page_number, chunk_index, material_id"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("id", source_chunk_ids)
                .execute()
            )

            source_chunk_map = {
                str(chunk["id"]): chunk
                for chunk in (chunk_response.data or [])
            }

        # 6. Ghép câu hỏi, câu trả lời và nguồn tài liệu
        results = []

        for question in questions:
            answer = answers_by_question.get(
                str(question["id"])
            )

            source_chunk = (
                source_chunk_map.get(
                    str(question["source_chunk_id"])
                )
                if question.get("source_chunk_id")
                else None
            )

            results.append({
                "question_id": question["id"],
                "question_text": question["question_text"],
                "selected_answer": (
                    answer.get("selected_answer")
                    if answer
                    else None
                ),
                "correct_answer": question["correct_answer"],
                "is_correct": (
                    answer.get("is_correct", False)
                    if answer
                    else False
                ),
                "points": question["points"],
                "earned_points": (
                    answer.get("earned_points", 0)
                    if answer
                    else 0
                ),
                "explanation": question.get("explanation"),
                "source_location": (
                    {
                        "page_number": source_chunk.get(
                            "page_number"
                        ),
                        "chunk_index": source_chunk.get(
                            "chunk_index"
                        ),
                        "material_id": source_chunk.get(
                            "material_id"
                        ),
                        "content": source_chunk.get("content"),
                    }
                    if source_chunk
                    else None
                ),
            })

        # 7. Lấy đánh giá AI của lượt làm bài.
        # Kết quả điểm không được phụ thuộc vào quyền đọc bảng đánh giá.
        assessment_read_error = None

        try:
            assessment_response = (
                supabase.table("quiz_assessments")
                .select(
                    "id, mastery_level, summary, strengths, "
                    "weak_areas, recommendations, ai_model, "
                    "assessment_status, created_at"
                )
                .eq("quiz_attempt_id", str(attempt_id))
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            ai_assessment = (
                assessment_response.data[0]
                if assessment_response.data
                else None
            )

            if not ai_assessment:
                raise ValueError(
                    "Chưa có bản ghi đánh giá cho lượt làm bài."
                )
        except Exception as assessment_error:
            print(
                "Không thể đọc quiz_assessments:",
                str(assessment_error)
            )
            score = float(attempt.get("score") or 0)
            if score < 50:
                fallback_summary = (
                    "Bạn chưa đạt 50%. Hãy ôn lại các phần trả lời sai "
                    "trước khi làm bài kiểm tra lại."
                )
                fallback_recommendations = [
                    "Ôn lại toàn bộ nội dung trong các câu trả lời sai.",
                    "Làm bài kiểm tra lại và đạt từ 50% để học tiếp."
                ]
                fallback_mastery = "not_mastered"
            elif score < 70:
                fallback_summary = (
                    "Bạn được phép học tiếp, nhưng vẫn cần củng cố "
                    "các phần kiến thức còn yếu."
                )
                fallback_recommendations = [
                    "Ôn lại các câu trả lời chưa chính xác."
                ]
                fallback_mastery = "needs_review"
            elif score <= 80:
                fallback_summary = (
                    "Bạn đã đạt yêu cầu và có thể tiếp tục học ngày kế tiếp."
                )
                fallback_recommendations = [
                    "Tiếp tục củng cố các phần kiến thức còn thiếu."
                ]
                fallback_mastery = "needs_review"
            else:
                fallback_summary = (
                    "Xuất sắc! Bạn đã nắm vững phần lớn kiến thức."
                )
                fallback_recommendations = []
                fallback_mastery = "mastered"

            ai_assessment = {
                "id": None,
                "mastery_level": fallback_mastery,
                "summary": fallback_summary,
                "strengths": [],
                "weak_areas": [],
                "recommendations": fallback_recommendations,
                "ai_model": "Fallback",
                "assessment_status": "not_persisted"
            }
            assessment_read_error = (
                "Chưa thể tải đánh giá năng lực do thiếu quyền truy cập "
                "bảng quiz_assessments."
            )

        # 8. Tìm Review Plan
        review_plan = None

        # 8.1. Tìm theo assessment_id của lượt làm bài hiện tại
        if ai_assessment and ai_assessment.get("id"):
            review_plan_response = (
                supabase.table("review_plans")
                .select(
                    "id, assessment_id, review_items, "
                    "overall_goal, status, retake_quiz_id, "
                    "review_study_seconds, created_at, "
                    "updated_at"
                )
                .eq("assessment_id", ai_assessment["id"])
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if review_plan_response.data:
                review_plan = review_plan_response.data[0]

        # 8.2. Nếu đây là bài kiểm tra lại,
        # tìm Review Plan gốc bằng retake_quiz_id
        if not review_plan:
            review_plan_response = (
                supabase.table("review_plans")
                .select(
                    "id, assessment_id, review_items, "
                    "overall_goal, status, retake_quiz_id, "
                    "review_study_seconds, created_at, "
                    "updated_at"
                )
                .eq("retake_quiz_id", attempt["quiz_id"])
                .eq("user_id", DEMO_USER_ID)
                .limit(1)
                .execute()
            )

            if review_plan_response.data:
                review_plan = review_plan_response.data[0]

        # 9. Trả kết quả
        return {
            "message": "Lấy kết quả Quiz thành công!",
            "attempt_id": attempt["id"],
            "quiz_id": attempt["quiz_id"],
            "title": quiz_response.data[0]["title"],
            "score": attempt["score"],
            "correct_count": attempt["correct_count"],
            "total_questions": attempt["total_questions"],
            "earned_points": sum(
                float(item["earned_points"] or 0)
                for item in results
            ),
            "total_points": attempt["total_points"],
            "status": attempt["status"],
            "results": results,
            "ai_assessment": ai_assessment,
            "review_plan": review_plan,
            "assessment_save_error": assessment_read_error,
            "next_session_unlocked": float(attempt.get("score") or 0) >= 50,
            "requires_retake": float(attempt.get("score") or 0) < 50
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Không thể lấy kết quả Quiz: {str(error)}"
            )
        )


@app.get("/api/quiz-attempts")
def get_quiz_attempts(quiz_id: UUID | None = None):
    if not DEMO_USER_ID:
        raise HTTPException(
            status_code=500,
            detail="Chưa cấu hình DEMO_USER_ID trong file .env"
        )

    try:
        # 1. Lấy các lượt làm Quiz đã nộp
        query = (
            supabase.table("quiz_attempts")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "submitted")
        )

        if quiz_id:
            query = query.eq("quiz_id", str(quiz_id))

        attempts_response = (
            query
            .order("submitted_at", desc=True)
            .execute()
        )

        attempts = attempts_response.data or []

        if not attempts:
            return {
                "message": "Chưa có lịch sử làm bài Quiz.",
                "total_attempts": 0,
                "data": []
            }

        # 2. Lấy thông tin các Quiz xuất hiện trong lịch sử
        quiz_ids = list({
            attempt["quiz_id"]
            for attempt in attempts
        })

        quizzes_response = (
            supabase.table("quizzes")
            .select("id, title")
            .eq("user_id", DEMO_USER_ID)
            .in_("id", quiz_ids)
            .execute()
        )

        quiz_titles = {
            quiz["id"]: quiz["title"]
            for quiz in (quizzes_response.data or [])
        }

        # 3. Lấy đánh giá AI của từng lượt làm bài
        attempt_ids = [
            str(attempt["id"])
            for attempt in attempts
        ]

        assessment_rows = []

        try:
            assessments_response = (
                supabase.table("quiz_assessments")
                .select(
                    "id, quiz_attempt_id, mastery_level, summary, "
                    "strengths, weak_areas, recommendations, "
                    "ai_model, assessment_status, created_at"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("quiz_attempt_id", attempt_ids)
                .order("created_at", desc=True)
                .execute()
            )
        except Exception as assessment_error:
            print(
                "Không thể đọc lịch sử quiz_assessments:",
                str(assessment_error)
            )
        else:
            assessment_rows = assessments_response.data or []

        assessment_by_attempt = {}

        for assessment in assessment_rows:
            attempt_id = assessment["quiz_attempt_id"]

            if attempt_id not in assessment_by_attempt:
                assessment_by_attempt[attempt_id] = assessment

        # 4. Lấy lộ trình ôn tập theo assessment của các lượt làm
        assessment_ids = list({
            assessment["id"]
            for assessment in assessment_by_attempt.values()
        })

        review_plans = []

        if assessment_ids:
            review_response = (
                supabase.table("review_plans")
                .select(
                    "id, assessment_id, review_items, "
                    "overall_goal, status, retake_quiz_id, "
                    "review_study_seconds, "
                    "review_study_completed_at, "
                    "created_at, updated_at"
                )
                .eq("user_id", DEMO_USER_ID)
                .in_("assessment_id", assessment_ids)
                .order("updated_at", desc=True)
                .execute()
            )

            review_plans.extend(review_response.data or [])

        # 5. Đồng thời tìm lộ trình theo retake_quiz_id
        # Trường hợp người dùng đang xem trực tiếp lịch sử Quiz ôn tập
        retake_plan_response = (
            supabase.table("review_plans")
            .select(
                "id, assessment_id, review_items, "
                "overall_goal, status, retake_quiz_id, "
                "review_study_seconds, "
                "review_study_completed_at, "
                "created_at, updated_at"
            )
            .eq("user_id", DEMO_USER_ID)
            .in_("retake_quiz_id", quiz_ids)
            .order("updated_at", desc=True)
            .execute()
        )

        review_plans.extend(retake_plan_response.data or [])

        # 6. Tạo bản đồ lộ trình theo assessment và Quiz ôn tập
        review_by_assessment = {}
        review_by_retake_quiz = {}

        for plan in review_plans:
            assessment_id = plan.get("assessment_id")
            retake_quiz_id = plan.get("retake_quiz_id")

            if (
                assessment_id
                and assessment_id not in review_by_assessment
            ):
                review_by_assessment[assessment_id] = plan

            if (
                retake_quiz_id
                and retake_quiz_id not in review_by_retake_quiz
            ):
                review_by_retake_quiz[retake_quiz_id] = plan

        # 7. Lấy thông tin các Quiz ôn tập liên quan
        retake_quiz_ids = list({
            str(plan["retake_quiz_id"])
            for plan in review_plans
            if plan.get("retake_quiz_id")
        })

        retake_attempts_by_quiz = {}
        retake_quiz_titles = {}

        if retake_quiz_ids:
            retake_quizzes_response = (
                supabase.table("quizzes")
                .select("id, title")
                .eq("user_id", DEMO_USER_ID)
                .in_("id", retake_quiz_ids)
                .execute()
            )

            retake_quiz_titles = {
                quiz["id"]: quiz["title"]
                for quiz in (retake_quizzes_response.data or [])
            }

            retake_attempts_response = (
                supabase.table("quiz_attempts")
                .select(
                    "id, quiz_id, score, correct_count, "
                    "total_questions, started_at, submitted_at, status"
                )
                .eq("user_id", DEMO_USER_ID)
                .eq("status", "submitted")
                .in_("quiz_id", retake_quiz_ids)
                .order("submitted_at", desc=True)
                .execute()
            )

            for retake_attempt in (
                retake_attempts_response.data or []
            ):
                current_quiz_id = retake_attempt["quiz_id"]

                if current_quiz_id not in retake_attempts_by_quiz:
                    retake_attempts_by_quiz[current_quiz_id] = []

                retake_attempts_by_quiz[current_quiz_id].append({
                    "attempt_id": retake_attempt["id"],
                    "score": retake_attempt["score"],
                    "correct_count": retake_attempt["correct_count"],
                    "total_questions": retake_attempt["total_questions"],
                    "started_at": retake_attempt["started_at"],
                    "submitted_at": retake_attempt["submitted_at"],
                    "status": retake_attempt["status"]
                })

        # 8. Ghép dữ liệu lịch sử
        results = []

        for attempt in attempts:
            attempt_id = attempt["id"]
            current_quiz_id = attempt["quiz_id"]

            assessment = assessment_by_attempt.get(attempt_id)

            if not assessment:
                score = float(attempt.get("score") or 0)

                if score > 80:
                    mastery_level = "mastered"
                    summary = (
                        "Bạn đã nắm vững phần lớn kiến thức trong bài kiểm tra."
                    )
                    recommendations = [
                        "Tiếp tục ôn tập để duy trì kết quả."
                    ]
                elif score >= 50:
                    mastery_level = "needs_review"
                    summary = (
                        "Bạn đã đạt yêu cầu nhưng vẫn còn nội dung cần "
                        "củng cố thêm."
                    )
                    recommendations = [
                        "Ôn lại các câu hỏi đã trả lời chưa chính xác."
                    ]
                else:
                    mastery_level = "not_mastered"
                    summary = (
                        "Bạn cần ôn lại các nội dung trong bài kiểm tra "
                        "trước khi học tiếp."
                    )
                    recommendations = [
                        "Đọc lại tài liệu liên quan đến các câu trả lời sai.",
                        "Làm lại bài kiểm tra sau khi ôn tập."
                    ]

                assessment = {
                    "id": "",
                    "mastery_level": mastery_level,
                    "summary": summary,
                    "strengths": [],
                    "weak_areas": [],
                    "recommendations": recommendations,
                    "ai_model": "Fallback",
                    "assessment_status": "not_persisted",
                    "created_at": attempt.get("submitted_at")
                }

            # Tìm lộ trình theo assessment trước,
            # nếu là Quiz ôn tập thì tìm theo retake_quiz_id
            review_plan = None

            if assessment:
                review_plan = review_by_assessment.get(
                    assessment["id"]
                )

            if not review_plan:
                review_plan = review_by_retake_quiz.get(
                    current_quiz_id
                )

            retake_attempts = []

            if review_plan and review_plan.get("retake_quiz_id"):
                retake_quiz_id = review_plan["retake_quiz_id"]

                retake_attempts = retake_attempts_by_quiz.get(
                    retake_quiz_id,
                    []
                )

                review_plan = {
                    **review_plan,
                    "retake_quiz_title": retake_quiz_titles.get(
                        retake_quiz_id,
                        "Quiz ôn tập"
                    ),
                    "retake_attempt_count": len(retake_attempts)
                }

            results.append({
                "attempt_id": attempt_id,
                "quiz_id": current_quiz_id,
                "quiz_title": quiz_titles.get(
                    current_quiz_id,
                    retake_quiz_titles.get(
                        current_quiz_id,
                        "Quiz không tồn tại"
                    )
                ),
                "score": attempt.get("score"),
                "correct_count": attempt.get("correct_count"),
                "total_questions": attempt.get("total_questions"),
                "total_points": attempt.get("total_points"),
                "started_at": attempt.get("started_at"),
                "submitted_at": attempt.get("submitted_at"),
                "status": attempt.get("status"),
                "ai_assessment": assessment,
                "review_plan": review_plan,
                "retake_attempts": retake_attempts
            })

        return {
            "message": "Lấy lịch sử làm bài thành công!",
            "total_attempts": len(results),
            "data": results
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lấy lịch sử làm bài: {str(error)}"
        )
    
@app.get("/api/analytics/weak-areas")
def get_weak_areas():
    try:
        # 1. Lấy các lượt làm bài đã nộp
        attempts_response = (
            supabase.table("quiz_attempts")
            .select("id")
            .eq("user_id", DEMO_USER_ID)
            .eq("status", "submitted")
            .execute()
        )

        attempt_ids = [
            str(item["id"])
            for item in (attempts_response.data or [])
        ]

        if not attempt_ids:
            return {
                "total_submitted_attempts": 0,
                "total_graded_answers": 0,
                "weak_areas": []
            }

        # 2. Lấy câu trả lời thuộc các lượt đã nộp
        answers_response = (
            supabase.table("quiz_answers")
            .select("question_id, is_correct")
            .eq("user_id", DEMO_USER_ID)
            .in_("attempt_id", attempt_ids)
            .execute()
        )

        answers = [
            item for item in (answers_response.data or [])
            if item.get("is_correct") is not None
        ]

        question_ids = list({
            str(item["question_id"])
            for item in answers
        })

        if not question_ids:
            return {
                "total_submitted_attempts": len(attempt_ids),
                "total_graded_answers": 0,
                "weak_areas": []
            }

        # 3. Lấy mapping câu hỏi - chủ đề
        mappings_response = (
            supabase.table("question_topic_mappings")
            .select("question_id, topic_id")
            .eq("user_id", DEMO_USER_ID)
            .eq("mapping_status", "mapped")
            .in_("question_id", question_ids)
            .execute()
        )

        # Mỗi câu hỏi có thể liên kết nhiều chủ đề.
        # Dùng set để tránh đếm trùng cùng một chủ đề.
        question_topics = {}

        for item in (mappings_response.data or []):
            question_id = str(item["question_id"])
            topic_id = str(item["topic_id"])

            question_topics.setdefault(
                question_id, set()
            ).add(topic_id)

        topic_ids = list({
            topic_id
            for ids in question_topics.values()
            for topic_id in ids
        })

        if not topic_ids:
            return {
                "total_submitted_attempts": len(attempt_ids),
                "total_graded_answers": len(answers),
                "weak_areas": []
            }

        # 4. Lấy thông tin chủ đề
        topics_response = (
            supabase.table("topics")
            .select("id, name, description")
            .eq("user_id", DEMO_USER_ID)
            .in_("id", topic_ids)
            .execute()
        )

        # 5. Khởi tạo thống kê
        stats = {}

        for topic in (topics_response.data or []):
            topic_id = str(topic["id"])

            stats[topic_id] = {
                "topic_id": topic_id,
                "topic_name": topic["name"],
                "description": topic.get("description"),
                "total_answers": 0,
                "correct_answers": 0,
                "incorrect_answers": 0
            }

        # 6. Tính kết quả theo từng chủ đề
        for answer in answers:
            question_id = str(answer["question_id"])

            for topic_id in question_topics.get(
                question_id, set()
            ):
                if topic_id not in stats:
                    continue

                stats[topic_id]["total_answers"] += 1

                if answer["is_correct"]:
                    stats[topic_id]["correct_answers"] += 1
                else:
                    stats[topic_id]["incorrect_answers"] += 1

        # 7. Tính tỷ lệ đúng và phân loại
        weak_areas = []

        for item in stats.values():
            total = item["total_answers"]

            if total == 0:
                continue

            accuracy = (
                item["correct_answers"] / total
            ) * 100

            item["accuracy"] = round(accuracy, 2)

            if accuracy < 50:
                item["level"] = "weak"
                item["level_label"] = "Cần ôn tập"
            elif accuracy < 80:
                item["level"] = "improving"
                item["level_label"] = "Cần cải thiện"
            else:
                item["level"] = "mastered"
                item["level_label"] = "Nắm vững"

            weak_areas.append(item)

        # Chủ đề yếu nhất hiển thị trước
        weak_areas.sort(
            key=lambda item: item["accuracy"]
        )

        return {
            "total_submitted_attempts": len(attempt_ids),
            "total_graded_answers": len(answers),
            "weak_areas": weak_areas
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể phân tích điểm yếu: {str(error)}"
        )



@app.post("/api/study-materials/{material_id}/analyze")
def analyze_study_material(material_id: UUID):
    try:
        # 1. Kiểm tra tài liệu
        material_response = (
            supabase.table("study_materials")
            .select(
                "id, exam_plan_id, file_name, "
                "material_type, processing_status"
            )
            .eq("id", str(material_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        if not material_response.data:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy tài liệu."
            )

        material = material_response.data[0]

        if material["material_type"] != "textbook":
            raise HTTPException(
                status_code=400,
                detail="Chỉ hỗ trợ phân tích tài liệu học tập."
            )

        if material["processing_status"] != "processed":
            raise HTTPException(
                status_code=400,
                detail="Tài liệu chưa được xử lý thành công."
            )

        exam_plan_id = str(material["exam_plan_id"])

        # 2. Lấy nội dung tài liệu
        chunks_response = (
            supabase.table("material_chunks")
            .select("id, chunk_index, content, page_number")
            .eq("material_id", str(material_id))
            .eq("user_id", DEMO_USER_ID)
            .order("chunk_index")
            .execute()
        )

        chunks = chunks_response.data or []

        if not chunks:
            raise HTTPException(
                status_code=400,
                detail="Tài liệu chưa có nội dung để phân tích."
            )

        # 3. Hàm gộp các mục nội dung, tránh trùng tiêu đề
        def merge_content_sections(existing_sections, new_sections):
            merged = []
            section_lookup = {}

            for section in (
                (existing_sections or []) + (new_sections or [])
            ):
                if not isinstance(section, dict):
                    continue

                heading = str(
                    section.get("heading") or ""
                ).strip()

                if not heading:
                    continue

                if heading not in section_lookup:
                    copied_section = {
                        "heading": heading,
                        "content": str(
                            section.get("content") or ""
                        ).strip(),
                        "key_points": [],
                        "table": section.get("table"),
                        "subsections": []
                    }

                    section_lookup[heading] = copied_section
                    merged.append(copied_section)

                else:
                    copied_section = section_lookup[heading]

                    new_content = str(
                        section.get("content") or ""
                    ).strip()

                    old_content = copied_section["content"]

                    if (
                        new_content
                        and new_content != old_content
                        and new_content not in old_content
                    ):
                        copied_section["content"] = (
                            old_content + "\n\n" + new_content
                            if old_content
                            else new_content
                        )

                target = section_lookup[heading]

                raw_points = section.get("key_points", [])

                if isinstance(raw_points, list):
                    for point in raw_points:
                        point_text = str(point or "").strip()

                        if (
                            point_text
                            and point_text not in target["key_points"]
                        ):
                            target["key_points"].append(point_text)

                if not target.get("table") and isinstance(
                    section.get("table"),
                    dict
                ):
                    target["table"] = section["table"]

                target["subsections"] = merge_content_sections(
                    target["subsections"],
                    section.get("subsections", [])
                )

            return merged

        # 4. Chia thành nhóm 5 đoạn và phân tích bằng AI
        generated_topics = []

        chunk_id_by_index = {
            int(chunk["chunk_index"]): str(chunk["id"])
            for chunk in chunks
        }

        for start in range(0, len(chunks), 5):
            batch = chunks[start:start + 5]

            try:
                batch_topics = analyze_chunk_batch(batch)
            except Exception as analysis_error:
                print(
                    "Không thể gọi AI phân tích batch, dùng dữ liệu dự phòng:",
                    str(analysis_error)
                )
                batch_topics = []
                fallback_sections = []
                fallback_indices = []

                for chunk in batch:
                    content = str(chunk.get("content") or "").strip()
                    if not content:
                        continue

                    fallback_section = build_fallback_section(
                        content,
                        chunk.get("page_number")
                    )

                    if not fallback_section:
                        continue

                    fallback_indices.append(chunk.get("chunk_index"))
                    fallback_sections.append(fallback_section)

                if fallback_sections:
                    batch_topics.append({
                        "name": fallback_sections[0]["heading"],
                        "description": " ".join(
                            section["content"]
                            for section in fallback_sections[:2]
                        )[:500],
                        "hierarchy": "Tài liệu",
                        "difficulty_level": 3,
                        "estimated_minutes": max(
                            30,
                            len(fallback_sections) * 20
                        ),
                        "source_chunk_indices": fallback_indices,
                        "content_sections": fallback_sections
                    })

            for item in batch_topics:
                if not isinstance(item, dict):
                    continue

                name = str(item.get("name", "")).strip()

                if not name:
                    continue

                hierarchy = str(
                    item.get("hierarchy") or "Tài liệu"
                ).strip()

                try:
                    difficulty = int(
                        item.get("difficulty_level", 3)
                    )
                    estimated_minutes = int(
                        item.get("estimated_minutes", 30)
                    )
                except (TypeError, ValueError):
                    continue

                if estimated_minutes <= 0:
                    continue

                source_chunk_ids = []

                source_indices = item.get(
                    "source_chunk_indices", []
                )

                if isinstance(source_indices, list):
                    for raw_index in source_indices:
                        try:
                            chunk_index = int(raw_index)
                        except (TypeError, ValueError):
                            continue

                        chunk_id = chunk_id_by_index.get(
                            chunk_index
                        )

                        if (
                            chunk_id
                            and chunk_id not in source_chunk_ids
                        ):
                            source_chunk_ids.append(chunk_id)

                content_sections = item.get(
                    "content_sections", []
                )

                if not isinstance(content_sections, list):
                    content_sections = []

                if is_generic_topic_name(name):
                    section_headings = []

                    for section in content_sections:
                        if not isinstance(section, dict):
                            continue

                        section_heading = get_main_topic_title(
                            str(section.get("heading") or "")
                        ).strip()

                        if (
                            section_heading
                            and not is_generic_topic_name(section_heading)
                        ):
                            section_headings.append(section_heading)

                    if section_headings:
                        name = section_headings[0]
                    else:
                        source_indices_for_name = []

                        for raw_index in (
                            source_indices
                            if isinstance(source_indices, list)
                            else []
                        ):
                            try:
                                source_indices_for_name.append(
                                    int(raw_index)
                                )
                            except (TypeError, ValueError):
                                continue
                        first_index = (
                            min(source_indices_for_name)
                            if source_indices_for_name
                            else 0
                        )
                        name = (
                            f"Phần {first_index + 1} của tài liệu"
                        )

                source_key = create_topic_source_key(
                    hierarchy,
                    name
                )

                generated_topics.append({
                    "source_key": source_key,
                    "hierarchy": hierarchy,
                    "name": get_main_topic_title(name)[:150],
                    "description": str(
                        item.get("description") or ""
                    ),
                    "difficulty_level": max(
                        1, min(5, difficulty)
                    ),
                    "estimated_minutes": estimated_minutes,
                    "source_chunk_ids": source_chunk_ids,
                    "content_sections": content_sections
                })

        # 5. Loại bỏ chủ đề trùng lặp và gộp nội dung
        unique_topics = {}

        for item in generated_topics:
            source_key = item["source_key"]

            if source_key not in unique_topics:
                unique_topics[source_key] = item

            else:
                existing = unique_topics[source_key]

                existing["source_chunk_ids"] = list(
                    dict.fromkeys(
                        existing["source_chunk_ids"]
                        + item["source_chunk_ids"]
                    )
                )

                existing["content_sections"] = (
                    merge_content_sections(
                        existing["content_sections"],
                        item["content_sections"]
                    )
                )

        generated_topics = list(unique_topics.values())

        # 6. Lấy chủ đề AI cũ theo đúng khóa duy nhất
        existing_response = (
            supabase.table("topics")
            .select("id, source_key")
            .eq("user_id", DEMO_USER_ID)
            .eq("source_material_id", str(material_id))
            .eq("source_type", "ai")
            .execute()
        )

        existing_topics = {
            item["source_key"]: item
            for item in (existing_response.data or [])
            if item.get("source_key")
        }

        current_keys = set()
        created_count = 0
        updated_count = 0

        # 7. Cập nhật chủ đề cũ hoặc tạo chủ đề mới
        for item in generated_topics:
            source_key = item["source_key"]
            current_keys.add(source_key)

            topic_data = {
                "name": item["name"],
                "description": item["description"],
                "hierarchy": item["hierarchy"],
                "difficulty_level": item["difficulty_level"],
                "estimated_minutes": item["estimated_minutes"],
                "source_chunk_ids": item["source_chunk_ids"],
                "content_sections": item["content_sections"],
                "source_type": "ai",
                "source_material_id": str(material_id),
                "source_key": source_key,
                "is_active": True
            }

            if source_key in existing_topics:
                topic_id = existing_topics[source_key]["id"]

                (
                    supabase.table("topics")
                    .update(topic_data)
                    .eq("id", str(topic_id))
                    .eq("user_id", DEMO_USER_ID)
                    .execute()
                )

                updated_count += 1

            else:
                topic_data.update({
                    "user_id": DEMO_USER_ID,
                    "exam_plan_id": exam_plan_id,
                    "understanding_level": 1,
                    "priority": 3,
                    "status": "not_started"
                })

                (
                    supabase.table("topics")
                    .insert(topic_data)
                    .execute()
                )

                created_count += 1

        # 8. Lưu trữ chủ đề cũ không còn xuất hiện
        # Không xóa để bảo toàn liên kết với dữ liệu học tập
        archived_count = 0

        for source_key, old_topic in existing_topics.items():
            if source_key not in current_keys:
                (
                    supabase.table("topics")
                    .update({"is_active": False})
                    .eq("id", str(old_topic["id"]))
                    .eq("user_id", DEMO_USER_ID)
                    .execute()
                )

                archived_count += 1

        return {
            "success": True,
            "message": "AI đã phân tích tài liệu thành công!",
            "material_id": str(material_id),
            "total_chunks": len(chunks),
            "total_topics": len(generated_topics),
            "created_topics": created_count,
            "updated_topics": updated_count,
            "archived_topics": archived_count
        }

    except HTTPException:
        raise

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể phân tích tài liệu: {str(error)}"
        )

class StudyReminderCreate(BaseModel):
    study_session_id: UUID
    remind_at: str
    reminder_type: str = "before_session"
    message: str | None = None


@app.get("/api/study-reminders")
def get_study_reminders(study_session_id: UUID | None = None):
    try:
        query = (
            supabase.table("study_reminders")
            .select("*")
            .eq("user_id", DEMO_USER_ID)
        )

        if study_session_id:
            query = query.eq(
                "study_session_id",
                str(study_session_id)
            )

        response = (
            query
            .order("remind_at")
            .execute()
        )

        return {
            "data": response.data or []
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tải danh sách nhắc lịch: {str(e)}"
        )


@app.post("/api/study-reminders")
def create_study_reminder(request: StudyReminderCreate):
    try:
        allowed_types = [
            "before_session",
            "session_start",
            "overdue"
        ]

        if request.reminder_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail="Loại nhắc lịch không hợp lệ."
            )

        session_response = (
            supabase.table("study_sessions")
            .select("id, status")
            .eq("id", str(request.study_session_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        sessions = session_response.data or []

        if not sessions:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy buổi học."
            )

        if sessions[0]["status"] not in ["scheduled", "in_progress"]:
            raise HTTPException(
                status_code=400,
                detail="Không thể tạo nhắc lịch cho buổi học này."
            )

        existing_response = (
            supabase.table("study_reminders")
            .select("id")
            .eq("user_id", DEMO_USER_ID)
            .eq("study_session_id", str(request.study_session_id))
            .eq("reminder_type", request.reminder_type)
            .eq("remind_at", request.remind_at)
            .limit(1)
            .execute()
        )

        if existing_response.data:
            raise HTTPException(
                status_code=409,
                detail="Nhắc lịch này đã tồn tại."
            )

        insert_response = (
            supabase.table("study_reminders")
            .insert({
                "user_id": DEMO_USER_ID,
                "study_session_id": str(request.study_session_id),
                "remind_at": request.remind_at,
                "reminder_type": request.reminder_type,
                "message": request.message,
                "status": "scheduled"
            })
            .execute()
        )

        return {
            "message": "Tạo nhắc lịch thành công.",
            "data": insert_response.data[0]
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể tạo nhắc lịch: {str(e)}"
        )


@app.patch("/api/study-reminders/{reminder_id}/cancel")
def cancel_study_reminder(reminder_id: UUID):
    try:
        reminder_response = (
            supabase.table("study_reminders")
            .select("id, status")
            .eq("id", str(reminder_id))
            .eq("user_id", DEMO_USER_ID)
            .limit(1)
            .execute()
        )

        reminders = reminder_response.data or []

        if not reminders:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy nhắc lịch."
            )

        if reminders[0]["status"] != "scheduled":
            raise HTTPException(
                status_code=400,
                detail="Chỉ có thể hủy nhắc lịch đang chờ gửi."
            )

        update_response = (
            supabase.table("study_reminders")
            .update({
                "status": "cancelled"
            })
            .eq("id", str(reminder_id))
            .eq("user_id", DEMO_USER_ID)
            .execute()
        )

        return {
            "message": "Đã hủy nhắc lịch.",
            "data": update_response.data[0]
        }

    except HTTPException:
        raise

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Không thể hủy nhắc lịch: {str(e)}"
        )


