"""
Đánh giá bài làm bằng Claude theo mức điểm (hiển thị ở trang kết quả, mục "Đánh giá điểm yếu").

- Dưới 50%  : ôn cấp tốc, chỉ rõ phần sai nhiều (trang, chương, tài liệu), thời gian học dày.
- 50% - 79% : ôn thư thả, vẫn chỉ ra phần cần củng cố, thời gian học vừa phải.
- Từ 80%    : chỉ khen và khuyến khích giữ nhịp, không liệt kê điểm yếu.

Vị trí trong tài liệu (trang, chương, tên file) lấy từ dữ liệu thật của câu hỏi,
Claude chỉ chọn câu nào thuộc nhóm điểm yếu nào nên không thể bịa số trang.
"""

from __future__ import annotations
from content_language import language_rule

import json
import re

from claude_client import generate_structured, is_claude_configured

ASSESSMENT_MODEL_TAG = "Claude"
# Đánh giá thật (không phải câu mẫu "Fallback"): Claude, hoặc Groq khi Claude lỗi
AI_ASSESSMENT_TAGS = ("Claude", "Groq")

ASSESSMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string"},
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weak_areas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic_name": {"type": "string"},
                    "description": {"type": "string"},
                    "recommendation": {"type": "string"},
                    "question_numbers": {"type": "array", "items": {"type": "integer"}},
                },
                "required": ["topic_name", "description", "recommendation", "question_numbers"],
            },
        },
        "study_plan": {
            "type": "object",
            "properties": {
                "minutes_per_day": {"type": "integer"},
                "days": {"type": "integer"},
                "advice": {"type": "string"},
            },
            "required": ["minutes_per_day", "days", "advice"],
        },
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "mistakes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question_number": {"type": "integer"},
                    "text": {"type": "string"},
                },
                "required": ["question_number", "text"],
            },
        },
    },
    "required": ["verdict", "summary", "strengths", "weak_areas", "study_plan", "recommendations", "mistakes"],
}

ASSESSMENT_SYSTEM = """Bạn là giảng viên nhận xét bài kiểm tra cho sinh viên, giọng thân thiện,
xưng "bạn" (tiếng Anh: "you"), viết ngắn gọn, cụ thể, theo NGÔN NGỮ BẮT BUỘC ở đầu yêu cầu.

QUY TẮC THEO MỨC ĐIỂM:
1. Dưới 50% (ôn cấp tốc): nói thẳng là bài chưa vững, cần tập trung ngay. Chỉ ra
   các phần sai nhiều nhất. Đề xuất ôn 45-60 phút/ngày trong 1-2 ngày tới, đọc lại
   phần sai trước rồi mới học bài mới, sau đó làm Tự kiểm tra nhanh và bài kiểm tra lại.
2. Từ 50% đến 79% (ôn thư thả): ghi nhận phần đã làm tốt, chỉ ra phần cần củng cố.
   Đề xuất ôn 20-30 phút/ngày trong 2-3 ngày, chọn một ngày trống trong tuần.
3. Từ 80% trở lên: CHỈ KHEN và khuyến khích giữ nhịp. weak_areas để RỖNG. Đề xuất
   ôn nhẹ 10-15 phút/ngày trong 1 ngày để giữ kiến thức (không bắt buộc).

YÊU CẦU:
- verdict: 1 câu đánh giá chung đúng với mức điểm.
- summary: 2-3 câu nhận xét bài làm dựa trên các câu đúng/sai thực tế.
- strengths: 1-3 ý bạn đã làm tốt (rút từ các câu đúng).
- weak_areas (chỉ khi dưới 80%): gom các câu SAI theo cùng một nội dung kiến thức, tối đa
  4 nhóm, nhóm sai nhiều nhất đứng đầu. topic_name là tên phần kiến thức (không đánh số);
  description 1 câu nói bạn đang hiểu sai/nhầm điều gì; recommendation 1 câu nên ôn gì;
  question_numbers là số thứ tự các câu sai thuộc nhóm đó (lấy đúng số trong dữ liệu).
- study_plan: minutes_per_day và days theo đúng khung của mức điểm; advice 1-2 câu
  về cách sắp xếp thời gian học.
- recommendations: 2-4 lời khuyên ngắn, hành động được ngay.
- mistakes: với MỖI câu SAI (ở mọi mức điểm), 1-2 câu ngắn giải thích "bạn nhầm ở đâu":
  vì sao đáp án bạn chọn chưa đúng / bạn đang hiểu nhầm điều gì. Không lặp lại lời giải
  của đáp án đúng. Câu bỏ trống thì nhắc ý chính cần nhớ.
- Không bịa số trang, chương hay tên tài liệu; ứng dụng tự gắn vị trí từ dữ liệu."""


from score_rules import review_tier  # noqa: E402  (ngưỡng chung: <50 / 50-79 / >=80)


TIER_LIMITS = {
    "intensive": {"minutes": (45, 60), "days": (1, 2)},
    "relaxed": {"minutes": (20, 30), "days": (2, 3)},
    "none": {"minutes": (10, 15), "days": (1, 1)},
}


def _answer_text(value, options) -> str:
    keys = value if isinstance(value, list) else ([value] if value not in (None, "") else [])
    if not keys:
        return "(bỏ trống)"
    parts = []
    for key in keys:
        option = next(
            (item for item in options or [] if str(item.get("key")).upper() == str(key).strip().upper()),
            None,
        )
        parts.append(f"{option['key']}. {option['text']}" if option else str(key))
    return "; ".join(parts)


def _clamp(value, low, high):
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = low
    return max(low, min(high, value))


def build_attempt_assessment(result: dict, language: str = "vi") -> dict:
    """result: dữ liệu của GET /api/quiz-attempts/{id}/result."""
    total = int(result.get("total_questions") or 0)
    correct = int(result.get("correct_count") or 0)
    score = round(correct / total * 100) if total else round(float(result.get("score") or 0))
    tier = review_tier(score)
    context = result.get("review_context") or {}
    questions = result.get("results") or []

    lines = []
    for number, item in enumerate(questions, start=1):
        source = item.get("source_location") or {}
        snippet = " ".join(str(source.get("content") or "").split())[:350]
        lines.append(
            f"Câu {number} [{'ĐÚNG' if item.get('is_correct') else 'SAI'}]"
            f"{' (trang ' + str(source.get('page_number')) + ')' if source.get('page_number') else ''}\n"
            f"Hỏi: {item.get('question_text')}\n"
            f"Bạn trả lời: {_answer_text(item.get('selected_answer'), item.get('options'))}\n"
            f"Đáp án đúng: {_answer_text(item.get('correct_answer'), item.get('options'))}\n"
            f"Đoạn tài liệu liên quan: {snippet}"
        )

    extras = result.get("assessment_extras") or {}
    prompt = (
        f"{language_rule(language)}\n\n"
        f"Bài học: {context.get('topic_name') or result.get('title')}\n"
        f"Loại bài: {_kind_label(extras.get('kind'))}\n"
        f"Điểm: {score}% (đúng {correct}/{total} câu) → mức "
        f"{'dưới 50%' if tier == 'intensive' else '50-79%' if tier == 'relaxed' else 'từ 80%'}\n"
        f"{_kind_instruction(extras, score)}\n\n"
        + "\n\n".join(lines)
    )

    data, model_tag = _generate_assessment(prompt)

    # Gắn vị trí thật (trang, chương, tài liệu) cho từng nhóm điểm yếu
    weak_areas = []
    if tier != "none":
        for area in data.get("weak_areas") or []:
            numbers = sorted({
                number for number in area.get("question_numbers") or []
                if isinstance(number, int) and 1 <= number <= len(questions)
                and not questions[number - 1].get("is_correct")
            })
            if not numbers:
                continue
            sources = [questions[number - 1].get("source_location") or {} for number in numbers]
            pages = sorted({source.get("page_number") for source in sources if source.get("page_number")})
            files = sorted({source.get("file_name") for source in sources if source.get("file_name")})
            weak_areas.append({
                "topic_name": str(area.get("topic_name") or "").strip()[:150],
                "description": str(area.get("description") or "").strip()[:400],
                "recommendation": str(area.get("recommendation") or "").strip()[:400],
                "question_numbers": numbers,
                "wrong_count": len(numbers),
                "pages": pages,
                "source_page": pages[0] if pages else None,
                "chapter": context.get("chapter"),
                "hierarchy": context.get("chapter"),
                "material_name": files[0] if files else None,
            })
        weak_areas.sort(key=lambda item: -item["wrong_count"])

    limits = TIER_LIMITS[tier]
    plan = data.get("study_plan") or {}
    study_plan = {
        "kind": "study_plan",
        "tier": tier,
        "minutes_per_day": _clamp(plan.get("minutes_per_day"), *limits["minutes"]),
        "days": _clamp(plan.get("days"), *limits["days"]),
        "advice": str(plan.get("advice") or "").strip()[:400],
    }

    mistakes = []
    seen_numbers = set()
    for item in data.get("mistakes") or []:
        number = item.get("question_number")
        text = str(item.get("text") or "").strip()
        if (
            isinstance(number, int)
            and 1 <= number <= len(questions)
            and not questions[number - 1].get("is_correct")
            and text
            and number not in seen_numbers
        ):
            seen_numbers.add(number)
            mistakes.append({
                "question_number": number,
                "question_id": str(questions[number - 1].get("question_id") or ""),
                "text": text[:400],
            })

    recommendations = [
        str(item).strip() for item in data.get("recommendations") or [] if str(item).strip()
    ][:4] or _default_recommendations(tier, extras)

    return {
        "mastery_level": "mastered" if tier == "none" else "needs_review" if tier == "relaxed" else "not_mastered",
        "summary": f"{str(data.get('verdict') or '').strip()} {str(data.get('summary') or '').strip()}".strip(),
        "verdict": str(data.get("verdict") or "").strip(),
        "strengths": [str(item).strip() for item in data.get("strengths") or [] if str(item).strip()][:3],
        "weak_areas": weak_areas,
        "recommendations": recommendations
        + [study_plan] + ([{"kind": "mistakes", "items": mistakes}] if mistakes else []),
        "ai_model": model_tag,
    }


def _kind_label(kind) -> str:
    return {
        "retake": "bài kiểm tra ôn tập (làm lại sau khi ôn)",
        "final": "bài tổng hợp 20 câu (10 câu bài ôn + 10 câu bài gốc)",
    }.get(kind, "bài kiểm tra cuối buổi học")


def _kind_instruction(extras: dict, score: int) -> str:
    kind = extras.get("kind")
    lines = []
    previous = extras.get("previous_scores") or []
    if kind in ("retake", "final") and previous:
        joined = ", ".join(f"{label} {value}%" for label, value in previous)
        lines.append(
            f"Điểm các lần trước: {joined}. Hãy so sánh: tiến bộ hay chưa, phần nào vẫn sai."
        )
    if kind == "final" and score < 80:
        lines.append(
            "Bài tổng hợp chưa đạt: phần này được gắn cờ CẦN CHÚ Ý. Nói rõ phần cần chú ý "
            "và cách ôn lại trước ngày thi (không bắt làm lại bài này)."
        )
    next_session = extras.get("next_session")
    if score >= 80 and next_session:
        lines.append(
            f"Buổi học kế tiếp: \"{next_session.get('topic_name')}\" ngày {next_session.get('date')}. "
            "Trong recommendations, gợi ý học tiếp buổi này (nêu đúng tên và ngày)."
        )
    if score >= 80:
        lines.append("recommendations phải có 1-3 gợi ý, không được để rỗng.")
    return "\n".join(lines)


def _default_recommendations(tier: str, extras: dict) -> list[str]:
    next_session = extras.get("next_session")
    if tier == "none":
        items = ["Giữ nhịp học như hiện tại."]
        if next_session:
            items.insert(0, f"Học tiếp buổi \"{next_session.get('topic_name')}\" ngày {next_session.get('date')}.")
        return items
    if tier == "relaxed":
        return ["Ôn lại các câu sai trong phần kết quả.", "Làm bài kiểm tra lại sau khi ôn xong."]
    return [
        "Đọc lại kỹ các phần đã trả lời sai.",
        "Vào ôn và trả lời câu hỏi nhanh trước khi làm bài kiểm tra lại.",
    ]


def _parse_json_object(text: str) -> dict:
    match = re.search(r"\{.*\}", text or "", re.S)
    if not match:
        raise ValueError("AI không trả về JSON.")
    return json.loads(match.group(0))


def _generate_assessment(prompt: str):
    """Claude Haiku trước; lỗi hoặc chưa cấu hình thì rơi về Groq (giống các việc "light")."""
    claude_error = None
    if is_claude_configured():
        try:
            data = generate_structured(
                tier="light",
                system=ASSESSMENT_SYSTEM,
                prompt=prompt,
                input_schema=ASSESSMENT_SCHEMA,
                max_tokens=4500,
            )
            return data, "Claude"
        except Exception as error:
            claude_error = error
            print("Claude lỗi khi đánh giá bài làm, chuyển sang Groq:", str(error)[:200])

    try:
        from groq_client import generate_text

        schema_hint = json.dumps(ASSESSMENT_SCHEMA["properties"], ensure_ascii=False)
        text = generate_text(
            f"{ASSESSMENT_SYSTEM}\n\nCHỈ TRẢ VỀ MỘT OBJECT JSON HỢP LỆ (không markdown) có đủ các khoá: "
            f"{', '.join(ASSESSMENT_SCHEMA['required'])}. Cấu trúc: {schema_hint}\n\n{prompt}"
        )
        return _parse_json_object(text), "Groq"
    except Exception as groq_error:
        detail = f"Claude: {claude_error}; Groq: {groq_error}" if claude_error else str(groq_error)
        raise RuntimeError(f"AI chưa đánh giá được bài làm ({detail}).")
