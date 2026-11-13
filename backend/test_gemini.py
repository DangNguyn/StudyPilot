from gemini_client import generate_text

try:
    print("Đang kết nối Gemini...")

    response = generate_text(
        "Hãy giới thiệu ngắn gọn về ứng dụng hỗ trợ học tập StudyPilot bằng tiếng Việt."
    )

    print("\nKẾT QUẢ TỪ GEMINI:")
    print(response)

    print("\nKết nối Gemini thành công!")

except Exception as error:
    print("\nKết nối Gemini thất bại:")
    print(error)