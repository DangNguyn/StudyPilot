
import os
from dotenv import load_dotenv
from supabase import create_client, Client

# Đọc thông tin từ file .env
load_dotenv()

# Lấy thông tin kết nối
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

# Kiểm tra cấu hình
if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise ValueError("Thiếu thông tin kết nối Supabase trong file .env")

# Khởi tạo Supabase Client
supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
)
