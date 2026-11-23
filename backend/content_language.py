"""
Ngôn ngữ nội dung của kế hoạch (exam_plans.content_language: "vi" | "en").
Mọi prompt AI tạo tóm tắt, câu hỏi, bài ôn, giải thích đều chèn language_rule(lang)
để nội dung ra đúng ngôn ngữ người dùng chọn, bất kể tài liệu gốc viết bằng gì.
"""

LANGUAGES = ("vi", "en")


def normalize_language(value) -> str:
    return value if value in LANGUAGES else "vi"


def language_rule(lang: str) -> str:
    if normalize_language(lang) == "en":
        return (
            "NGÔN NGỮ BẮT BUỘC: Viết TOÀN BỘ nội dung trả về (câu hỏi, lựa chọn, đáp án, "
            "giải thích, tóm tắt, nhận xét) bằng TIẾNG ANH, kể cả khi tài liệu gốc là tiếng Việt. "
            "Write everything in clear English."
        )
    return (
        "NGÔN NGỮ BẮT BUỘC: Viết TOÀN BỘ nội dung trả về (câu hỏi, lựa chọn, đáp án, "
        "giải thích, tóm tắt, nhận xét) bằng TIẾNG VIỆT, kể cả khi tài liệu gốc là tiếng Anh. "
        "Thuật ngữ chuyên ngành dịch sang tiếng Việt và giữ thuật ngữ tiếng Anh gốc trong ngoặc "
        "ở lần đầu xuất hiện, ví dụ: phần mềm con người (Humanware)."
    )


def fill_blank_rule(lang: str) -> str:
    """Quy tắc cho câu điền khuyết để người học điền đúng là được chấm đúng."""
    example = (
        '["công việc văn phòng", "văn phòng", "office work"]'
        if normalize_language(lang) == "vi"
        else '["office work", "office"]'
    )
    return (
        "CÂU ĐIỀN KHUYẾT: chỗ trống chỉ là MỘT cụm ngắn 1-4 từ có trong tài liệu, chỉ có một cách hiểu đúng; "
        "câu hỏi viết bằng đúng ngôn ngữ bắt buộc ở trên. "
        "correct_answer là DANH SÁCH 2-4 đáp án được chấp nhận: cụm đầy đủ trước, rồi cách nói ngắn, "
        f"rồi thuật ngữ gốc của tài liệu (nếu khác ngôn ngữ). Ví dụ: {example}."
    )


def plan_language(supabase, exam_plan_id) -> str:
    """Đọc ngôn ngữ của kế hoạch; lỗi hoặc chưa có thì mặc định tiếng Việt."""
    if not exam_plan_id:
        return "vi"
    try:
        rows = (
            supabase.table("exam_plans")
            .select("content_language")
            .eq("id", str(exam_plan_id))
            .limit(1)
            .execute()
        ).data or []
        return normalize_language(rows[0].get("content_language") if rows else None)
    except Exception:
        return "vi"
