import os

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not GROQ_API_KEY:
    raise ValueError("Thiếu GROQ_API_KEY trong file .env")

client = Groq(api_key=GROQ_API_KEY)

MODEL_NAME = "openai/gpt-oss-20b"


def generate_text(prompt: str) -> str:
    try:
        response = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {
                    "role": "system",
                    "content": "Bạn là trợ lý AI của StudyPilot, chuyên hỗ trợ sinh viên học tập."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            max_completion_tokens=8192
        )

        usage = getattr(response, "usage", None)
        if usage is not None:
            from ai_usage import record_ai_call

            record_ai_call(
                "groq",
                MODEL_NAME,
                getattr(usage, "prompt_tokens", 0) or 0,
                getattr(usage, "completion_tokens", 0) or 0,
            )

        result = response.choices[0].message.content

        if not result:
            raise ValueError("Groq không trả về nội dung.")

        return result

    except Exception as error:
        raise RuntimeError(f"Lỗi khi gọi Groq API: {str(error)}")
