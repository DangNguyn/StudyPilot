import StudyMaterialsClient from "./study-materials-client";

/*
 * Trang đọc tài liệu đọc ?subject=&session= trên URL nên không thể dựng sẵn tức thì.
 * Tắt bước kiểm tra "instant navigation" của Next.js cho trang này để hết cảnh báo.
 * (Phải đặt ở file server như thế này, không đặt được trong file "use client".)
 */
export const instant = false;

export default function StudyMaterialsPage() {
  return <StudyMaterialsClient />;
}
