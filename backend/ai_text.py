"""
Gọi AI dạng văn bản cho các việc lặp lại hằng ngày (quiz, bài kiểm tra lại, nhận xét sau khi nộp):
ưu tiên Claude Haiku (rẻ, đúng ngôn ngữ, ít lỗi), lỗi hoặc chưa cấu hình thì dùng Groq miễn phí.
"""

from claude_client import generate_claude_text, is_claude_configured
from groq_client import generate_text


def generate_light_text(prompt: str) -> str:
    if is_claude_configured():
        try:
            return generate_claude_text(prompt, tier="light")
        except Exception as error:
            print("Claude Haiku lỗi, chuyển sang Groq:", error)
    return generate_text(prompt)
