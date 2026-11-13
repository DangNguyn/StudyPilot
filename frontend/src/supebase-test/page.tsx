
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../app/lib/supabase";

export default function SupabaseTestPage() {
  const [status, setStatus] = useState("Đang kiểm tra...");
  const [sessionStatus, setSessionStatus] = useState("");

  useEffect(() => {
    async function checkSupabase() {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          setStatus("Không thể khởi tạo phiên Supabase.");
          setSessionStatus(error.message);
          return;
        }

        setStatus("Supabase Client đã khởi tạo thành công.");

        setSessionStatus(
          data.session
            ? "Đã có phiên đăng nhập."
            : "Chưa có phiên đăng nhập (đây là trạng thái bình thường)."
        );
      } catch (error) {
        setStatus("Có lỗi khi kiểm tra Supabase.");

        setSessionStatus(
          error instanceof Error ? error.message : "Lỗi không xác định."
        );
      }
    }

    checkSupabase();
  }, []);

  return (
    <main className="min-h-screen bg-[#F3E9DF] p-8 flex items-center justify-center">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-[#1C3829]">
          StudyPilot - Supabase Test
        </h1>

        <p className="mt-4 font-semibold text-green-700">
          {status}
        </p>

        <p className="mt-2 text-gray-700">
          {sessionStatus}
        </p>
      </div>
    </main>
  );
}
