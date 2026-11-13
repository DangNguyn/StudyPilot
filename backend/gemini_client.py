import os

from dotenv import load_dotenv
from google import genai
from google.genai import types

# Đọc biến môi trường
load_dotenv()

# Lấy Gemini API Key
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY:
    raise ValueError("Thiếu GEMINI_API_KEY trong file .env")

# Khởi tạo Gemini Client
client = genai.Client(
    api_key=GEMINI_API_KEY
)

# Model Gemini sử dụng
MODEL_NAME = "gemini-3.8-flash"


def generate_text(prompt: str) -> str:
    """
    Gửi yêu cầu đến Gemini và nhận nội dung phản hồi.
    """
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=2048
            )
        )

        if not response.text:
            raise ValueError("Gemini không trả về nội dung.")

        return response.text

    except Exception as error:
        raise RuntimeError(
            f"Lỗi khi gọi Gemini API: {str(error)}"
        )