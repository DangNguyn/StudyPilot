import json
import os
import threading

from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# Có thể đổi model trong file .env, ví dụ:
# CLAUDE_MODEL=claude-opus-5-5 (chất lượng cao hơn, chi phí cao hơn)
# CLAUDE_MODEL=claude-haiku-5-5 (nhanh và rẻ hơn)
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-5-5")

_client = None
_client_lock = threading.Lock()


class ClaudeOutputTruncated(RuntimeError):
    """Claude dừng vì chạm giới hạn max_tokens, kết quả bị cắt ngang."""


def is_claude_configured() -> bool:
    return bool(ANTHROPIC_API_KEY)


def _get_client():
    global _client

    if _client is not None:
        return _client

    with _client_lock:
        if _client is None:
            if not ANTHROPIC_API_KEY:
                raise RuntimeError(
                    "Thiếu ANTHROPIC_API_KEY trong file .env"
                )

            try:
                import anthropic
            except ImportError as error:
                raise RuntimeError(
                    "Chưa cài thư viện anthropic. "
                    "Hãy chạy: pip install anthropic"
                ) from error

            _client = anthropic.Anthropic(
                api_key=ANTHROPIC_API_KEY,
                # SDK tự thử lại khi gặp lỗi mạng, 429 hoặc 5xx.
                max_retries=4,
                timeout=600.0,
            )

    return _client


# Các từ khoá JSON Schema mà Structured Outputs của Claude không hỗ trợ.
_UNSUPPORTED_SCHEMA_KEYS = {
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "maxItems",
    "pattern",
}


def _prepare_schema(schema):
    """
    Chuẩn hoá JSON Schema cho Structured Outputs:
    - Mọi object phải có additionalProperties: false.
    - Bỏ các từ khoá không được hỗ trợ (minimum, maximum...).
    """

    if isinstance(schema, list):
        return [_prepare_schema(item) for item in schema]

    if not isinstance(schema, dict):
        return schema

    prepared = {}

    for key, value in schema.items():
        if key in _UNSUPPORTED_SCHEMA_KEYS:
            continue

        if key == "properties" and isinstance(value, dict):
            prepared[key] = {
                name: _prepare_schema(child)
                for name, child in value.items()
            }
        else:
            prepared[key] = _prepare_schema(value)

    if prepared.get("type") == "object":
        prepared["additionalProperties"] = False

    return prepared


def _parse_json_text(text: str) -> dict:
    cleaned = text.strip()

    # Phòng trường hợp model bọc JSON trong ```json ... ```
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]

    result = json.loads(cleaned)

    if not isinstance(result, dict):
        raise ValueError("Claude trả về dữ liệu không phải object JSON.")

    return result


def generate_structured(
    *,
    system: str,
    prompt: str,
    input_schema: dict,
    max_tokens: int = 8000,
    tool_name: str = "",
    tool_description: str = "",
) -> dict:
    """
    Gọi Claude với Structured Outputs (output_config.format = json_schema)
    để Claude luôn trả về JSON đúng schema. Kết quả là dict đã parse sẵn.

    tool_name / tool_description được giữ lại để tương thích với code cũ,
    không còn bắt buộc.
    """

    client = _get_client()

    response = client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": prompt}],
        output_config={
            "format": {
                "type": "json_schema",
                "schema": _prepare_schema(input_schema),
            }
        },
    )

    if response.stop_reason == "max_tokens":
        raise ClaudeOutputTruncated(
            "Claude trả về kết quả quá dài và bị cắt ngang."
        )

    if response.stop_reason == "refusal":
        raise ValueError("Claude từ chối xử lý yêu cầu này.")

    text = "".join(
        getattr(block, "text", "")
        for block in response.content
        if getattr(block, "type", None) == "text"
    )

    if not text.strip():
        raise ValueError("Claude không trả về dữ liệu.")

    return _parse_json_text(text)