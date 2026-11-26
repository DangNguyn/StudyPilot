"""
Ghi lại mỗi lần gọi AI (và mỗi tài liệu được đọc) vào bảng ai_usage trên Supabase:
ai gọi, chức năng nào, model nào, bao nhiêu token, ước tính bao nhiêu tiền, bao nhiêu trang.

Xem tổng hợp theo người dùng trong Supabase: view admin_usage_by_user, admin_usage_by_feature,
admin_usage_by_document (tạo bằng SQL trong supabase_grants.sql).

Giá ở đây là ƯỚC TÍNH theo bảng giá công bố (USD / 1 triệu token).
Số tiền chính xác để thanh toán xem ở trang Cost của Claude Console / Groq Console.
"""

import os
import threading

from auth import _current_user, current_path, current_user_email, request_state

# Giá USD / 1 triệu token: (đầu vào, đầu ra). Có thể ghi đè bằng biến môi trường
# PRICE_<TÊN MODEL VIẾT HOA, thay - . / bằng _>=dau_vao,dau_ra  (ví dụ PRICE_CLAUDE_SONNET_5_5=2,10)
DEFAULT_PRICES = {
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    # Haiku 5.5: prompt tới 100.000 token; dài hơn thì x5 (xem _price_for)
    "claude-haiku-5-5": (0.10, 0.50),
    "openai/gpt-oss-20b": (0.075, 0.30),
    "openai/gpt-oss-120b": (0.15, 0.60),
}

_FEATURE_RULES = (
    ("preview-outline", "xem_truoc_muc_luc"),
    ("/process", "phan_tich_tai_lieu"),
    ("/analyze", "phan_tich_tai_lieu"),
    ("generate-schedule", "lap_lich_hoc"),
    ("flashcard-decks", "flashcard_tu_tai_lieu"),
    ("flashcards", "flashcard"),
    ("mindmap", "so_do_tu_duy"),
    ("/assessment", "danh_gia_bai_lam"),
    ("/submit", "danh_gia_bai_lam"),
    ("retake", "quiz_lam_lai"),
    ("practice-questions", "cau_hoi_luyen_tap"),
    ("quizzes", "quiz"),
    ("review-plans", "on_tap"),
    ("notifications", "thong_bao"),
)


def _feature_from_path(path: str) -> str:
    lowered = path.lower()
    for needle, feature in _FEATURE_RULES:
        if needle in lowered:
            return feature
    return "khac"


def _price_for(model: str, input_tokens: int) -> tuple[float, float]:
    env_key = "PRICE_" + "".join(ch if ch.isalnum() else "_" for ch in model).upper()
    override = os.getenv(env_key)
    if override:
        try:
            first, second = override.split(",")
            return float(first), float(second)
        except ValueError:
            pass
    price_in, price_out = DEFAULT_PRICES.get(model, (0.0, 0.0))
    if model.startswith("claude-haiku-5") and input_tokens > 100_000:
        price_in, price_out = price_in * 5, price_out * 5
    return price_in, price_out


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int,
                      cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> float:
    price_in, price_out = _price_for(model, input_tokens + cache_read_tokens + cache_write_tokens)
    cost = (
        input_tokens * price_in
        + cache_write_tokens * price_in * 1.25
        + cache_read_tokens * price_in * 0.05
        + output_tokens * price_out
    ) / 1_000_000
    return round(cost, 6)


def set_usage_document(material_id: str | None, file_name: str | None) -> None:
    """Đánh dấu tài liệu đang xử lý trong lần gọi API này (để gắn chi phí AI vào đúng tài liệu)."""
    request_state()["document"] = (str(material_id) if material_id else None, file_name)


_warned_missing_table = False


def _insert(record: dict) -> None:
    global _warned_missing_table
    try:
        from supabase_client import supabase

        supabase.table("ai_usage").insert(record).execute()
    except Exception as error:
        message = str(error)
        if "ai_usage" in message and not _warned_missing_table:
            _warned_missing_table = True
            print("Chưa có bảng ai_usage trên Supabase: hãy chạy SQL mới trong supabase_grants.sql.")
        elif "ai_usage" not in message:
            print("Không ghi được chi phí AI:", message[:200])


def _base_record() -> dict:
    user = _current_user.get() or {}
    path = current_path()
    material_id, file_name = request_state().get("document") or (None, None)
    return {
        "user_id": user.get("id"),
        "user_email": current_user_email() or None,
        "feature": _feature_from_path(path),
        "request_path": path[:200] or None,
        "material_id": material_id,
        "file_name": (file_name or "")[:300] or None,
    }


def _send(record: dict) -> None:
    if not record.get("user_id"):
        return  # gọi ngoài một lần đăng nhập (script, kiểm thử): bỏ qua
    # Ghi ở luồng riêng để không làm chậm phản hồi cho người dùng
    threading.Thread(target=_insert, args=(record,), daemon=True).start()


def record_ai_call(provider: str, model: str, input_tokens: int, output_tokens: int,
                   cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> None:
    try:
        record = _base_record()
        record.update({
            "provider": provider,
            "model": model,
            "input_tokens": int(input_tokens or 0) + int(cache_read_tokens or 0) + int(cache_write_tokens or 0),
            "output_tokens": int(output_tokens or 0),
            "cost_usd": estimate_cost_usd(
                model, int(input_tokens or 0), int(output_tokens or 0),
                int(cache_read_tokens or 0), int(cache_write_tokens or 0),
            ),
        })
        _send(record)
    except Exception as error:
        print("Không ghi được chi phí AI:", str(error)[:200])


def record_document(file_name: str, pages: int, material_id: str | None = None) -> None:
    """Ghi lại một tài liệu được đọc: tên file + số trang (để thống kê ai tải bao nhiêu trang)."""
    try:
        record = _base_record()
        record.update({
            "provider": "document",
            "model": None,
            "file_name": (file_name or record.get("file_name") or "")[:300] or None,
            "material_id": material_id or record.get("material_id"),
            "pages": int(pages or 0),
            "input_tokens": 0,
            "output_tokens": 0,
            "cost_usd": 0,
        })
        _send(record)
    except Exception as error:
        print("Không ghi được thông tin tài liệu:", str(error)[:200])
