
from supabase_client import supabase

try:
    # Thử truy vấn bảng profiles
    response = (
        supabase
        .table("profiles")
        .select("id")
        .limit(1)
        .execute()
    )

    print("Ket noi Supabase thanh cong!")
    print("Truy van bang profiles thanh cong!")
    print(f"So dong du lieu tra ve: {len(response.data)}")

except Exception as error:
    print("Ket noi hoac truy van Supabase that bai!")
    print("Chi tiet loi:", error)
