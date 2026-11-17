from claude_client import generate_structured, CLAUDE_MODEL

result = generate_structured(
    system="Bạn là trợ lý.",
    prompt="Chào bạn, hãy trả lời ngắn gọn.",
    tool_name="reply",
    tool_description="Trả lời người dùng.",
    input_schema={
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
    },
    max_tokens=200,
)

print("Model:", CLAUDE_MODEL)
print("Claude trả lời:", result["text"])