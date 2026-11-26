"""
Mindmap tổng hợp cuối chương (tính năng gói Pro).

- Nội dung mindmap lấy từ phần tóm tắt các bài trong chương (content_sections),
  không phụ thuộc vào kết quả làm bài.
- Claude chỉ tạo MỘT lần cho mỗi chương rồi lưu lại (bảng chapter_mindmaps trên
  Supabase; nếu chưa tạo bảng thì lưu tạm trong thư mục .mindmap_cache).
- Người dùng gói miễn phí KHÔNG nhận được nội dung mindmap: API chỉ trả về khung
  (tên các bài) để giao diện làm mờ, nên không tốn credit Claude.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from claude_client import generate_structured, is_claude_configured
from supabase_client import supabase
from content_language import language_rule, plan_language
from auth import current_user_id

router = APIRouter()

BASE_DIR = Path(__file__).resolve().parent
ACCOUNT_FILE = BASE_DIR / "account_settings.json"
CACHE_DIR = BASE_DIR / ".mindmap_cache"
MAX_BRANCHES = 7
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


# ==============================
# GÓI TÀI KHOẢN (free / pro)
# ==============================

def _read_account() -> dict:
    try:
        return json.loads(ACCOUNT_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def get_user_plan() -> str:
    # Mỗi tài khoản một gói riêng: {"users": {"<user_id>": "pro"}}
    plan = (_read_account().get("users") or {}).get(current_user_id()) or os.getenv("DEFAULT_PLAN", "free")
    return "pro" if str(plan).lower() == "pro" else "free"


def _can_switch_plan() -> bool:
    # Chỉ dùng khi phát triển/thử nghiệm. Khi có thanh toán thật thì tắt đi.
    return os.getenv("ALLOW_PLAN_SWITCH", "false").lower() in ("1", "true", "yes")


class PlanUpdate(BaseModel):
    plan: str = Field(pattern="^(free|pro)$")


@router.get("/api/account/plan")
def read_plan():
    return {"plan": get_user_plan(), "can_switch": _can_switch_plan()}


@router.put("/api/account/plan")
def update_plan(payload: PlanUpdate):
    if not _can_switch_plan():
        raise HTTPException(
            status_code=403,
            detail="Chưa mở thanh toán. Bật ALLOW_PLAN_SWITCH=true trong .env để thử gói Pro khi phát triển.",
        )
    data = _read_account()
    data.setdefault("users", {})[current_user_id()] = payload.plan
    ACCOUNT_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"plan": payload.plan, "can_switch": True}


# ==============================
# DỮ LIỆU CHƯƠNG
# ==============================

def _chapter_of(topic: dict) -> str:
    return str(topic.get("hierarchy") or "").split(">")[0].strip()


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().casefold()


def _load_chapter(exam_plan_id: str, chapter: str):
    topics = (
        supabase.table("topics")
        .select("id, name, hierarchy, description, content_sections, source_chunk_ids")
        .eq("exam_plan_id", exam_plan_id)
        .eq("user_id", current_user_id())
        .execute()
    ).data or []

    chapter_topics = [topic for topic in topics if _norm(_chapter_of(topic)) == _norm(chapter)]
    if not chapter_topics:
        raise HTTPException(status_code=404, detail="Không tìm thấy bài nào thuộc chương này.")

    # Thứ tự bài theo lịch học (buổi học sớm nhất của mỗi bài)
    sessions = (
        supabase.table("study_sessions")
        .select("topic_id, scheduled_start")
        .eq("user_id", current_user_id())
        .in_("topic_id", [str(topic["id"]) for topic in chapter_topics])
        .execute()
    ).data or []
    first_start: dict[str, str] = {}
    for session in sessions:
        key = str(session.get("topic_id"))
        start = str(session.get("scheduled_start") or "")
        if start and (key not in first_start or start < first_start[key]):
            first_start[key] = start
    chapter_topics.sort(key=lambda topic: first_start.get(str(topic["id"]), "9999"))

    # Trang tài liệu thật của từng bài
    chunk_ids = list({str(cid) for topic in chapter_topics for cid in (topic.get("source_chunk_ids") or [])})
    page_by_chunk: dict[str, int] = {}
    for start in range(0, len(chunk_ids), 100):
        rows = (
            supabase.table("material_chunks")
            .select("id, page_number")
            .in_("id", chunk_ids[start:start + 100])
            .execute()
        ).data or []
        for row in rows:
            if row.get("page_number"):
                page_by_chunk[str(row["id"])] = int(row["page_number"])

    for topic in chapter_topics:
        pages = sorted({page_by_chunk[str(cid)] for cid in (topic.get("source_chunk_ids") or []) if str(cid) in page_by_chunk})
        topic["_pages"] = [pages[0], pages[-1]] if pages else []

    return chapter_topics


def _content_digest(topics: list[dict]) -> str:
    # Chỉ dựa vào danh sách bài: nội dung tóm tắt có cập nhật thêm cũng không tạo lại (tiết kiệm credit)
    raw = json.dumps(
        [[topic["id"], topic.get("name")] for topic in topics],
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _lesson_text(index: int, topic: dict) -> str:
    lines = [f"[Bài {index}] {topic.get('name')}"]
    if topic.get("description"):
        lines.append(f"Mô tả: {str(topic['description'])[:300]}")
    for section in (topic.get("content_sections") or [])[:8]:
        if not isinstance(section, dict):
            continue
        heading = str(section.get("heading") or "").strip()
        points = [str(item) for item in (section.get("key_points") or [])][:4]
        formulas = [
            str(item.get("expression") or "")
            for item in (section.get("formulas") or [])
            if isinstance(item, dict) and item.get("expression")
        ][:3]
        content = " ".join(str(section.get("content") or "").split())[:260]
        lines.append(f"- Mục: {heading}")
        if content:
            lines.append(f"  Nội dung: {content}")
        if points:
            lines.append(f"  Ý chính: {' | '.join(points)}")
        if formulas:
            lines.append(f"  Công thức: {' | '.join(formulas)}")
    return "\n".join(lines)


# ==============================
# TẠO MINDMAP BẰNG CLAUDE
# ==============================

MINDMAP_SCHEMA = {
    "type": "object",
    "properties": {
        "central": {"type": "string"},
        "summary": {"type": "string"},
        "branches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "lesson_indices": {"type": "array", "items": {"type": "integer"}},
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "points": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["lesson_indices", "title", "summary", "points"],
            },
        },
        "links": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "from_branch": {"type": "integer"},
                    "from_point": {"type": "integer"},
                    "to_branch": {"type": "integer"},
                    "to_point": {"type": "integer"},
                    "label": {"type": "string"},
                },
                "required": ["from_branch", "from_point", "to_branch", "to_point", "label"],
            },
        },
    },
    "required": ["central", "summary", "branches", "links"],
}

MINDMAP_SYSTEM = f"""Bạn tạo mindmap tổng hợp KIẾN THỨC của một chương giáo trình cho sinh viên Việt Nam ôn thi.
Chỉ dùng nội dung được cung cấp, không thêm kiến thức ngoài, không nhắc tới điểm số hay bài làm.

YÊU CẦU:
- central: tên ngắn của chương (tối đa 40 ký tự, bỏ số chương và số mục).
- summary: 1-2 câu nói chương này giải quyết vấn đề gì.
- branches: mỗi nhánh là một bài (hoặc gộp vài bài ngắn cùng chủ đề), tối đa {MAX_BRANCHES} nhánh,
  giữ đúng thứ tự trong tài liệu. lesson_indices là số [Bài N] thuộc nhánh, mỗi bài nằm trong đúng một nhánh.
  title tối đa 32 ký tự, không đánh số. summary 1-2 câu ngắn.
  points: 2-4 ý chính, mỗi ý tối đa 55 ký tự, viết cô đọng như ghi chú (công thức, quy tắc,
  định nghĩa, phân loại). Công thức viết dạng chữ thường, chỉ số dùng dấu gạch dưới (E_D).
- links: 0-3 liên kết giữa các ý thuộc HAI NHÁNH KHÁC NHAU có quan hệ thật sự (nguyên nhân,
  hệ quả, trường hợp đặc biệt). Chỉ số nhánh và ý đếm từ 0. label tối đa 40 ký tự."""


def _generate(chapter: str, topics: list[dict], language: str = "vi") -> dict:
    prompt = f"{language_rule(language)}\n\nChương: {chapter}\n\n" + "\n\n".join(
        _lesson_text(index, topic) for index, topic in enumerate(topics, start=1)
    )
    data = generate_structured(
        tier="light",
        system=MINDMAP_SYSTEM,
        prompt=prompt[:60000],
        input_schema=MINDMAP_SCHEMA,
        max_tokens=3500,
    )

    used = set()
    branches = []
    for branch in data.get("branches") or []:
        indices = [
            index for index in branch.get("lesson_indices") or []
            if isinstance(index, int) and 1 <= index <= len(topics) and index not in used
        ]
        points = [str(point).strip()[:70] for point in branch.get("points") or [] if str(point).strip()][:4]
        if not indices or not points:
            continue
        used.update(indices)
        lesson_topics = [topics[index - 1] for index in indices]
        pages = sorted({page for topic in lesson_topics for page in topic["_pages"]})
        branches.append({
            "title": str(branch.get("title") or lesson_topics[0].get("name") or "").strip()[:40],
            "summary": str(branch.get("summary") or "").strip()[:300],
            "points": points,
            "topic_ids": [str(topic["id"]) for topic in lesson_topics],
            "pages": [pages[0], pages[-1]] if pages else [],
        })
        if len(branches) >= MAX_BRANCHES:
            break

    # Bài bị Claude bỏ sót vẫn có nhánh riêng (dùng các mục của bài làm ý chính)
    for index, topic in enumerate(topics, start=1):
        if index in used or len(branches) >= MAX_BRANCHES + 2:
            continue
        headings = [
            str(section.get("heading") or "").strip()[:55]
            for section in (topic.get("content_sections") or [])
            if isinstance(section, dict) and section.get("heading")
        ][:3]
        branches.append({
            "title": str(topic.get("name") or "Bài học")[:40],
            "summary": str(topic.get("description") or "")[:300],
            "points": headings or ["Xem phần tóm tắt của bài"],
            "topic_ids": [str(topic["id"])],
            "pages": topic["_pages"],
        })

    links = []
    for link in data.get("links") or []:
        try:
            a, ap, b, bp = (int(link[key]) for key in ("from_branch", "from_point", "to_branch", "to_point"))
        except (KeyError, TypeError, ValueError):
            continue
        if (
            a != b
            and 0 <= a < len(branches) and 0 <= b < len(branches)
            and 0 <= ap < len(branches[a]["points"]) and 0 <= bp < len(branches[b]["points"])
        ):
            links.append({
                "from": [a, ap],
                "to": [b, bp],
                "label": str(link.get("label") or "").strip()[:60],
            })
        if len(links) >= 3:
            break

    return {
        "central": str(data.get("central") or chapter).strip()[:60],
        "summary": str(data.get("summary") or "").strip()[:300],
        "branches": branches,
        "links": links,
    }


# ==============================
# LƯU TRỮ (Supabase, dự phòng file)
# ==============================

def _cache_key(exam_plan_id: str, chapter: str) -> str:
    return hashlib.sha256(f"{exam_plan_id}|{_norm(chapter)}".encode("utf-8")).hexdigest()[:24]


def _load_saved(exam_plan_id: str, chapter: str):
    key = _cache_key(exam_plan_id, chapter)
    try:
        rows = (
            supabase.table("chapter_mindmaps")
            .select("data")
            .eq("user_id", current_user_id())
            .eq("exam_plan_id", exam_plan_id)
            .eq("chapter_key", key)
            .limit(1)
            .execute()
        ).data or []
        if rows:
            return rows[0]["data"]
    except Exception as error:
        print("Chưa đọc được bảng chapter_mindmaps, dùng bộ nhớ tạm:", str(error)[:200])
    try:
        return json.loads((CACHE_DIR / f"{key}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _save(exam_plan_id: str, chapter: str, data: dict):
    key = _cache_key(exam_plan_id, chapter)
    try:
        supabase.table("chapter_mindmaps").upsert(
            {
                "user_id": current_user_id(),
                "exam_plan_id": exam_plan_id,
                "chapter_key": key,
                "chapter_name": chapter[:200],
                "data": data,
            },
            on_conflict="exam_plan_id,chapter_key",
        ).execute()
        return
    except Exception as error:
        print("Chưa lưu được vào chapter_mindmaps, lưu tạm vào file:", str(error)[:200])
    CACHE_DIR.mkdir(exist_ok=True)
    (CACHE_DIR / f"{key}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


# ==============================
# API
# ==============================

class MindmapRequest(BaseModel):
    chapter: str = Field(min_length=1, max_length=300)


@router.post("/api/exam-plans/{exam_plan_id}/chapter-mindmap")
def chapter_mindmap(exam_plan_id: str, payload: MindmapRequest):
    topics = _load_chapter(exam_plan_id, payload.chapter)
    lessons = [
        {"id": str(topic["id"]), "name": topic.get("name"), "pages": topic["_pages"]}
        for topic in topics
    ]

    plan = get_user_plan()
    if plan != "pro":
        # Gói miễn phí: chỉ trả khung để làm mờ, không gọi Claude
        return {
            "locked": True,
            "plan": plan,
            "can_switch": _can_switch_plan(),
            "chapter": payload.chapter,
            "lessons": lessons,
        }

    digest = _content_digest(topics)
    saved = _load_saved(exam_plan_id, payload.chapter)
    if saved and saved.get("digest") == digest:
        return {"locked": False, "plan": plan, "chapter": payload.chapter, "lessons": lessons, "data": saved}

    if not is_claude_configured():
        raise HTTPException(status_code=503, detail="Chưa cấu hình ANTHROPIC_API_KEY để tạo mindmap.")

    # Mỗi chương chỉ tạo một lần dù người dùng mở nhiều tab cùng lúc
    lock_key = _cache_key(exam_plan_id, payload.chapter)
    with _locks_guard:
        lock = _locks.setdefault(lock_key, threading.Lock())
    with lock:
        saved = _load_saved(exam_plan_id, payload.chapter)
        if saved and saved.get("digest") == digest:
            return {"locked": False, "plan": plan, "chapter": payload.chapter, "lessons": lessons, "data": saved}
        try:
            data = _generate(payload.chapter, topics, plan_language(supabase, exam_plan_id))
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"Chưa tạo được mindmap: {error}") from error
        data["digest"] = digest
        _save(exam_plan_id, payload.chapter, data)

    return {"locked": False, "plan": plan, "chapter": payload.chapter, "lessons": lessons, "data": data}
