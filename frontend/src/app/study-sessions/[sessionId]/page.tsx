"use client";

/*
 * Trang buổi học cũ không dùng nữa (20/11/2026): chuyển sang trang Tài liệu học tập
 * (tóm tắt có câu hỏi lồng) của đúng buổi, giữ được các liên kết cũ.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { LoadingMascot } from "@/components/loading-play";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export default function StudySessionRedirect() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetch(`${API_URL}/api/study-sessions/${sessionId}`).then((r) => (r.ok ? r.json() : null));
        const planId = detail?.topic?.exam_plan_id;
        const plans = await fetch(`${API_URL}/api/exam-plans`).then((r) => (r.ok ? r.json() : null));
        const plan = (plans?.data || []).find((item: { id: string }) => item.id === planId);
        if (!plan?.subject_id) throw new Error("missing subject");
        const mode = detail?.session?.status === "completed" ? "revisit" : "learn";
        if (!cancelled) {
          router.replace(
            `/materials?subject=${encodeURIComponent(plan.subject_id)}&session=${encodeURIComponent(sessionId)}&mode=${mode}`
          );
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, router]);

  return (
    <div className="sp-card mx-auto max-w-xl p-8 text-center">
      {failed ? (
        <>
          <p className="text-sm text-[var(--sp-text-2)]">Không mở được buổi học này.</p>
          <Link href="/study-materials" className="sp-btn sp-btn-primary mt-4 px-5 py-2.5 text-sm">
            Về Tài liệu học tập
          </Link>
        </>
      ) : (
        <LoadingMascot bare className="text-left" text="Đang mở bài học…" />
      )}
    </div>
  );
}
