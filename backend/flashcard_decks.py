"""
Bộ flashcard tự tải tài liệu lên (không cần tạo kế hoạch ôn thi).

- POST   /api/flashcard-decks          tải 1 file (PDF/DOC/DOCX/PPT/PPTX), AI soạn thẻ, lưu thành 1 bộ thẻ
- GET    /api/flashcard-decks          danh sách bộ thẻ kèm số thẻ
- DELETE /api/flashcard-decks/{id}     xoá bộ thẻ và các thẻ trong bộ

Thẻ của bộ nằm chung bảng `flashcards` (cột `deck_id`, `topic_id` để trống), nên
dùng lại được API chấm thẻ `/api/flashcards/review` và danh sách `/api/flashcards`.
File tài liệu chỉ đọc trong bộ nhớ để lấy chữ, không lưu lên Storage.

Cần chạy SQL tạo bảng `flashcard_decks` + cột `flashcards.deck_id` (xem supabase_grants.sql).
"""

from __future__ import annotations

import json
import os
import tempfile
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from claude_client import generate_structured, is_claude_configured
from document_processor import extract_text, split_into_chunks
from groq_client import generate_text
from flashcard_quality import cards_look_ok, parse_cards_json
from supabase_client import supabase
from auth import current_user_id
from ai_usage import record_document, set_usage_document

router = APIRouter()

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".ppt", ".pptx"}
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_SOURCE_CHARS = 28000  # đủ để AI bao quát tài liệu mà không quá tốn token
CARD_CHOICES = {10, 20, 30}

SETUP_HINT = (
    "Supabase chưa có bảng flashcard_decks hoặc cột flashcards.deck_id. "
    "Chạy đoạn SQL 'Bộ flashcard tự tải lên' trong backend/supabase_grants.sql rồi thử lại."
)

CARD_SCHEMA = {
    "type": "object",
    "properties": {
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "front": {"type": "string"},
                    "back": {"type": "string"},
                },
                "required": ["front", "back"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["cards"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = (
    "Bạn là trợ lý AI StudyPilot, soạn flashcard giúp sinh viên ghi nhớ kiến thức. "
    "Chỉ dùng thông tin có trong tài liệu, không bịa thêm."
)


def _is_schema_error(error: Exception) -> bool:
    text = str(error).lower()
    return any(
        key in text
        for key in ("flashcard_decks", "deck_id", "does not exist", "schema cache", "pgrst204", "42p01", "42703", "not-null", "null value")
    )


def _read_chunks(content: bytes, extension: str, file_name: str = "") -> list[dict]:
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=extension, delete=False) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name
        chunks = []
        pages = extract_text(temp_path) or []
        if pages:
            record_document(
                file_name,
                max((page.get("page_number") or 0 for page in pages), default=len(pages)),
            )
        for page in pages:
            for chunk in split_into_chunks(page["content"]):
                if chunk.strip():
                    chunks.append({"page_number": page.get("page_number"), "content": chunk.strip()})
        return chunks
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)


def _sample_source(chunks: list[dict]) -> str:
    """Lấy đều các đoạn từ đầu tới cuối tài liệu cho tới khi đủ MAX_SOURCE_CHARS."""
    total = sum(len(chunk["content"]) for chunk in chunks)
    if total <= MAX_SOURCE_CHARS:
        picked = chunks
    else:
        step = total / MAX_SOURCE_CHARS
        keep_every = max(1, round(step))
        picked = chunks[::keep_every]
    parts = []
    used = 0
    for chunk in picked:
        piece = f"[Trang {chunk.get('page_number') or '?'}]\n{chunk['content']}"
        if used + len(piece) > MAX_SOURCE_CHARS:
            break
        parts.append(piece)
        used += len(piece)
    return "\n\n".join(parts)


def _build_prompt(deck_name: str, count: int, source: str) -> str:
    return f"""
Tài liệu: {deck_name}

Hãy tạo đúng {count} flashcard bằng tiếng Việt từ nội dung tài liệu bên dưới.

YÊU CẦU:
- front: câu hỏi, thuật ngữ hoặc khái niệm cần nhớ, ngắn gọn, rõ ràng.
- back: 1-2 ý chính, mỗi ý một dòng bắt đầu bằng "- ", mỗi ý không quá 18 từ.
- Trải đều nội dung từ đầu tới cuối tài liệu, ưu tiên định nghĩa, nguyên lý, đặc điểm, công thức, quy trình.
- Không tạo thẻ trùng nhau, không dùng kiến thức ngoài tài liệu.

NỘI DUNG TÀI LIỆU:
{source}
"""


def _generate_cards(deck_name: str, count: int, source: str) -> list[dict]:
    prompt = _build_prompt(deck_name, count, source)

    # Groq (miễn phí) tạo trước; không đạt kiểm tra thì Claude Haiku tạo lại
    raw_cards = []
    try:
        raw_cards = parse_cards_json(generate_text(
            prompt + '\nChỉ trả về JSON hợp lệ dạng {"cards": [{"front": "...", "back": "..."}]}, không kèm Markdown.'
        ))
    except Exception as groq_error:
        print("Groq không tạo được bộ flashcard:", groq_error)
    if not cards_look_ok(raw_cards, count, "vi") and is_claude_configured():
        raw_cards = (generate_structured(
            tier="light", system=SYSTEM_PROMPT, prompt=prompt, input_schema=CARD_SCHEMA, max_tokens=8000
        ) or {}).get("cards") or raw_cards
    result = {"cards": raw_cards}

    cards = []
    seen = set()
    for card in (result or {}).get("cards", []) if isinstance(result, dict) else []:
        if not isinstance(card, dict):
            continue
        front = str(card.get("front") or "").strip()
        back = str(card.get("back") or "").strip()
        key = front.casefold()
        if not front or not back or key in seen:
            continue
        seen.add(key)
        cards.append({"front": front, "back": back})
        if len(cards) >= count:
            break
    return cards


@router.post("/api/flashcard-decks")
def create_flashcard_deck(
    file: UploadFile = File(...),
    name: str = Form(default=""),
    number_of_cards: int = Form(default=20),
):
    original_name = (file.filename or "tai-lieu").replace("\\", "/").split("/")[-1]
    set_usage_document(None, original_name)
    extension = os.path.splitext(original_name)[1].lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận file PDF, DOC, DOCX, PPT và PPTX.")

    if number_of_cards not in CARD_CHOICES:
        raise HTTPException(status_code=400, detail="Số thẻ chỉ được chọn 10, 20 hoặc 30.")

    content = file.file.read(MAX_FILE_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="File không được để trống.")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Dung lượng file không được vượt quá 50 MB.")

    deck_name = (name or "").strip()[:120] or os.path.splitext(original_name)[0][:120]

    try:
        chunks = _read_chunks(content, extension, original_name)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"Không đọc được tài liệu: {error}")

    if not chunks:
        raise HTTPException(
            status_code=400,
            detail="Không đọc được nội dung chữ trong tài liệu (có thể là bản scan hoặc ảnh chụp).",
        )

    try:
        cards = _generate_cards(deck_name, number_of_cards, _sample_source(chunks))
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"AI chưa soạn được thẻ: {error}")

    if not cards:
        raise HTTPException(status_code=502, detail="AI không trả về thẻ hợp lệ. Bạn thử lại nhé.")

    deck_id = None
    try:
        deck_response = (
            supabase.table("flashcard_decks")
            .insert({"user_id": current_user_id(), "name": deck_name, "file_name": original_name})
            .execute()
        )
        deck = (deck_response.data or [None])[0]
        if not deck:
            raise ValueError("Không tạo được bộ thẻ.")
        deck_id = deck["id"]

        supabase.table("flashcards").insert(
            [
                {
                    "user_id": current_user_id(),
                    "deck_id": deck_id,
                    "topic_id": None,
                    "source_chunk_id": None,
                    "front": card["front"],
                    "back": card["back"],
                    "source": "ai",
                    "status": "active",
                }
                for card in cards
            ]
        ).execute()
    except Exception as error:
        # Lưu thẻ hỏng thì xoá bộ thẻ rỗng vừa tạo
        if deck_id:
            try:
                supabase.table("flashcard_decks").delete().eq("id", deck_id).execute()
            except Exception:
                pass
        detail = SETUP_HINT if _is_schema_error(error) else f"Không lưu được bộ thẻ: {error}"
        raise HTTPException(status_code=500, detail=detail)

    return {
        "message": f"Đã tạo {len(cards)} thẻ từ {original_name}.",
        "created_cards": len(cards),
        "data": {**deck, "card_count": len(cards)},
    }


@router.get("/api/flashcard-decks")
def list_flashcard_decks():
    try:
        decks = (
            supabase.table("flashcard_decks")
            .select("*")
            .eq("user_id", current_user_id())
            .order("created_at", desc=True)
            .execute()
        ).data or []
    except Exception as error:
        if _is_schema_error(error):
            # Chưa chạy SQL: trang Flashcards vẫn dùng được với môn học trong kế hoạch
            return {"message": SETUP_HINT, "setup_required": True, "data": []}
        raise HTTPException(status_code=500, detail=f"Không thể lấy danh sách bộ thẻ: {error}")

    counts: dict[str, int] = {}
    if decks:
        cards = (
            supabase.table("flashcards")
            .select("deck_id")
            .eq("user_id", current_user_id())
            .eq("status", "active")
            .in_("deck_id", [deck["id"] for deck in decks])
            .execute()
        ).data or []
        for card in cards:
            counts[str(card["deck_id"])] = counts.get(str(card["deck_id"]), 0) + 1

    return {
        "message": "Lấy danh sách bộ thẻ thành công!",
        "data": [{**deck, "card_count": counts.get(str(deck["id"]), 0)} for deck in decks],
    }


@router.delete("/api/flashcard-decks/{deck_id}")
def delete_flashcard_deck(deck_id: UUID):
    try:
        found = (
            supabase.table("flashcard_decks")
            .select("id")
            .eq("id", str(deck_id))
            .eq("user_id", current_user_id())
            .execute()
        ).data
        if not found:
            raise HTTPException(status_code=404, detail="Không tìm thấy bộ thẻ.")

        card_ids = [
            card["id"]
            for card in (
                supabase.table("flashcards").select("id").eq("deck_id", str(deck_id)).eq("user_id", current_user_id()).execute()
            ).data
            or []
        ]
        if card_ids:
            supabase.table("flashcard_reviews").delete().in_("flashcard_id", card_ids).execute()
            supabase.table("flashcards").delete().in_("id", card_ids).execute()
        supabase.table("flashcard_decks").delete().eq("id", str(deck_id)).eq("user_id", current_user_id()).execute()
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Không xoá được bộ thẻ: {error}")

    return {"message": "Đã xoá bộ thẻ."}
