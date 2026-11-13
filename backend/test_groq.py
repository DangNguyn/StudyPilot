from groq_client import generate_text

try:
    print("Dang ket noi Groq...")

    response = generate_text(
        "Hay gioi thieu ngan gon ve ung dung StudyPilot bang tieng Viet."
    )

    print("\nKET QUA TU GROQ:")
    print(response)

    print("\nKet noi Groq thanh cong!")

except Exception as error:
    print("\nKet noi Groq that bai:")
    print(error)