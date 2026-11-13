
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getContentKeyPoints,
  getLearningContentBullets,
  getPreferredContentTitle,
} from "@/lib/content-titles";

const API_URL = "http://127.0.0.1:8000";

type StudySession = {
  id: string;
  topic_id: string;
  scheduled_start: string;
  duration_minutes: number;
  status: string;
  source: string;
  notes: string | null;
  actual_study_seconds: number;
};

type ContentSection = {
  heading: string;
  content: string;
  key_points?: string[];
  table?: {
    headers: string[];
    rows: string[][];
  } | null;
  subsections?: ContentSection[];
};

type Topic = {
  id: string;
  name: string;
  description: string | null;
  hierarchy: string | null;
  source_material_id: string | null;
  content_sections?: ContentSection[];
};

type MaterialChunk = {
  id: string;
  chunk_index: number;
  page_number: number | null;
  content: string;
};

type LessonOutlineItem = {
  section: ContentSection;
  number: string;
  level: number;
};

const MINIMUM_STUDY_SECONDS = 5 * 60;

function getLessonOutline(
  sections: ContentSection[],
  parentNumber = "",
  level = 0
): LessonOutlineItem[] {
  return sections.flatMap((section, index) => {
    const number = parentNumber
      ? `${parentNumber}.${index + 1}`
      : String(index + 1);

    return [
      { section, number, level },
      ...getLessonOutline(
        section.subsections || [],
        number,
        level + 1
      ),
    ];
  });
}

function ContentSectionView({
  section,
  level = 0,
  anchorId,
}: {
  section: ContentSection;
  level?: number;
  anchorId?: string;
}) {
  const table = section.table;
  const contentBullets = getLearningContentBullets(
    section.heading,
    section.content
  );
  const keyPoints = getContentKeyPoints(
    section.heading,
    section.key_points
  );

  return (
    <div
      id={anchorId}
      className={
        level === 0
          ? "space-y-3"
          : "ml-4 mt-4 space-y-3 border-l-2 border-[#E8EEE4] pl-4"
      }
    >
      <h3 className="text-base font-bold leading-7 text-[#355642]">
        {section.heading}
      </h3>

      {contentBullets.length > 0 && (
        <div className="rounded-xl bg-[#F7F8F3] p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#829184]">
            Nội dung
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-[#536657]">
            {contentBullets.map((bullet, index) => (
              <li key={`${index}-${bullet}`}>{bullet}</li>
            ))}
          </ul>
        </div>
      )}

      {table?.headers?.length &&
        table.rows?.length && (
          <div className="overflow-x-auto rounded-xl border border-[#E8EEE4]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#F0FAF2] text-[#171717]">
                <tr>
                  {table.headers.map((header) => (
                    <th
                      key={header}
                      className="px-4 py-3 font-semibold"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8EEE4]">
                {table.rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`} className="bg-white/60">
                    {table.headers.map((header, cellIndex) => (
                      <td
                        key={`${header}-${cellIndex}`}
                        className="px-4 py-3 align-top leading-6 text-[#555555]"
                      >
                        {row[cellIndex] || ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {contentBullets.length === 0 && keyPoints.length > 0 && (
        <div className="rounded-xl border border-[#E8EEE4] p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#54765D]">
            Ý chính cần ghi nhớ
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-7 text-[#536657]">
            {keyPoints.map((point, index) => (
              <li key={`${index}-${point}`}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {section.subsections && section.subsections.length > 0 && (
        <div className="space-y-4">
          {section.subsections.map((subsection, index) => (
            <ContentSectionView
              key={`${level}-${index}-${subsection.heading}`}
              section={subsection}
              level={level + 1}
              anchorId={
                anchorId
                  ? `${anchorId}.${index + 1}`
                  : `lesson-section-${index + 1}`
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StudySessionPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const sessionId = params.sessionId;

  const [session, setSession] = useState<StudySession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState<Topic | null>(null);
  const [chunks, setChunks] = useState<MaterialChunk[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [studySeconds, setStudySeconds] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);

  // Tải thông tin buổi học và nội dung tài liệu
  useEffect(() => {
    async function loadSession() {
      try {
        setIsLoading(true);
        setError("");

        const response = await fetch(
          `${API_URL}/api/study-sessions/${sessionId}`
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.detail || "Không thể tải thông tin buổi học."
          );
        }

        const data = result.data || result;

        setSession(data.session);
        setTopic(data.topic);
        setChunks(data.chunks || []);
        setStudySeconds(data.session.actual_study_seconds || 0);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Đã xảy ra lỗi khi tải buổi học."
        );
      } finally {
        setIsLoading(false);
      }
    }

    if (sessionId) {
      loadSession();
    }
  }, [sessionId]);

  // Đồng hồ học tập và đồng bộ thời gian với Backend
  useEffect(() => {
    if (session?.status !== "in_progress") {
      return;
    }

    let isPaused = true;
    let isDisposed = false;

    // Gửi thao tác ghi nhận thời gian đến Backend
    async function sendActivity(
      action: "heartbeat" | "pause" | "resume",
      keepalive = false
    ) {
      try {
        const response = await fetch(
          `${API_URL}/api/study-sessions/${sessionId}/activity?action=${action}`,
          {
            method: "POST",
            keepalive,
          }
        );

        if (!response.ok) {
          return null;
        }

        const result = await response.json();
        const actualSeconds = Number(result.actual_study_seconds);

        // Không để dữ liệu Backend làm đồng hồ hiển thị chạy lùi
        if (!isDisposed && Number.isFinite(actualSeconds)) {
          setStudySeconds((current) =>
            Math.max(current, actualSeconds)
          );
        }

        return result;
      } catch (error) {
        console.error("Không thể đồng bộ thời gian học:", error);
        return null;
      }
    }

    // Tiếp tục tính thời gian khi trang hiển thị
    async function resumeStudy() {
      if (
        isDisposed ||
        document.visibilityState !== "visible" ||
        !isPaused
      ) {
        return;
      }

      isPaused = false;

      const result = await sendActivity("resume");

      if (!result) {
        isPaused = true;
        return;
      }

      if (document.visibilityState !== "visible") {
        pauseStudy();
      }
    }

    // Tạm dừng và lưu thời gian đã học
    function pauseStudy() {
      if (isPaused || isDisposed) {
        return;
      }

      isPaused = true;

      void sendActivity("pause", true);
    }

    // Xử lý khi chuyển tab hoặc quay lại tab
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        pauseStudy();
      } else {
        void resumeStudy();
      }
    }

    // Xử lý khi rời trang
    function handlePageHide() {
      pauseStudy();
    }

    // Đồng hồ hiển thị: chỉ chạy khi trang đang hiển thị
    const timer = setInterval(() => {
      if (
        !isPaused &&
        document.visibilityState === "visible"
      ) {
        setStudySeconds((current) => current + 1);
      }
    }, 1000);

    // Heartbeat mỗi 30 giây để lưu thời gian học
    const activityTimer = setInterval(() => {
      if (
        !isPaused &&
        document.visibilityState === "visible"
      ) {
        void sendActivity("heartbeat");
      }
    }, 30000);

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener("pagehide", handlePageHide);

    // Nếu mở lại trang đang học, bắt đầu một phiên hoạt động mới
    if (document.visibilityState === "visible") {
      void resumeStudy();
    }

    return () => {
      isDisposed = true;

      clearInterval(timer);
      clearInterval(activityTimer);

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener("pagehide", handlePageHide);

      // Lưu thời gian khi người dùng chuyển sang trang khác
      if (!isPaused) {
        isPaused = true;

        void fetch(
          `${API_URL}/api/study-sessions/${sessionId}/activity?action=pause`,
          {
            method: "POST",
            keepalive: true,
          }
        ).catch((error) => {
          console.error(
            "Không thể lưu thời gian khi rời trang:",
            error
          );
        });
      }
    };
  }, [session?.status, sessionId]);

  function formatStudyTime(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    return [
      String(hours).padStart(2, "0"),
      String(minutes).padStart(2, "0"),
      String(remainingSeconds).padStart(2, "0"),
    ].join(":");
  }

  const contentSections = topic?.content_sections || [];
  const lessonOutline = getLessonOutline(contentSections);
  const studyProgress = session?.duration_minutes
    ? Math.min(
        100,
        Math.round(
          (studySeconds / (session.duration_minutes * 60)) * 100
        )
      )
    : 0;

  async function handleStartSession() {
    try {
      setIsStarting(true);
      setActionError("");

      const response = await fetch(
        `${API_URL}/api/study-sessions/${sessionId}/start`,
        {
          method: "POST",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Không thể bắt đầu buổi học."
        );
      }

      setSession((current) =>
        current
          ? {
              ...current,
              status: "in_progress",
            }
          : current
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Đã xảy ra lỗi khi bắt đầu buổi học."
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function handleCompleteSession() {
    try {
      setIsCompleting(true);
      setActionError("");

      const response = await fetch(
        `${API_URL}/api/study-sessions/${sessionId}/complete`,
        {
          method: "POST",
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Không thể hoàn thành buổi học."
        );
      }

      setSession((current) =>
        current
          ? {
              ...current,
              status: "completed",
            }
          : current
      );

      if (result.actual_study_seconds !== undefined) {
        setStudySeconds(result.actual_study_seconds);
      }
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Đã xảy ra lỗi khi hoàn thành buổi học."
      );
    } finally {
      setIsCompleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <button
        onClick={() => router.back()}
        className="text-sm font-medium text-[#829080] hover:text-[#355642]"
      >
        ← Quay lại lộ trình
      </button>

      {isLoading ? (
        <div className="rounded-2xl bg-[#FCFBF7] p-10 text-center text-[#89958A]">
          Đang tải thông tin buổi học...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-100 bg-white p-8">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      ) : session ? (
        <>
          <section className="overflow-hidden rounded-3xl border border-[#DDE8DF] bg-gradient-to-br from-[#F5FAF4] via-white to-[#EEF6F0] p-6 shadow-sm sm:p-8">
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6B8872]">
                  KHÔNG GIAN HỌC TẬP
                </p>

                <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#294A35]">
                  {getPreferredContentTitle(
                    topic?.name,
                    contentSections[0]?.heading
                  )}
                </h1>

                <p className="mt-3 max-w-2xl text-sm leading-7 text-[#6D7F71]">
                  Học theo trọng tâm, ghi nhớ ý chính và hoàn thành nội dung
                  được phân bổ cho ngày hôm nay.
                </p>
              </div>

              <span className="inline-flex w-fit items-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#54765D] shadow-sm">
                {session.status === "completed"
                  ? "✓ Đã hoàn thành"
                  : session.status === "in_progress"
                    ? "● Đang học"
                    : "○ Sẵn sàng học"}
              </span>
            </div>

            <div className="mt-7 max-w-xl">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-[#718075]">
                <span>Tiến độ buổi học</span>
                <span>{studyProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#DDE9DE]">
                <div
                  className="h-full rounded-full bg-[#6B9072] transition-all"
                  style={{ width: `${studyProgress}%` }}
                />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-5">
              <p className="text-sm text-[#89958A]">Ngày học</p>
              <p className="mt-2 font-bold text-[#355642]">
                {new Date(session.scheduled_start).toLocaleDateString(
                  "vi-VN"
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-5">
              <p className="text-sm text-[#89958A]">
                Thời lượng yêu cầu
              </p>
              <p className="mt-2 font-bold text-[#355642]">
                {session.duration_minutes} phút
              </p>
            </div>

            <div className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-5">
              <p className="text-sm text-[#89958A]">Trạng thái</p>
              <p className="mt-2 font-bold text-[#355642]">
                {session.status === "scheduled"
                  ? "Chưa bắt đầu"
                  : session.status === "in_progress"
                    ? "Đang học"
                    : session.status === "completed"
                      ? "Đã hoàn thành"
                      : session.status}
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6">
            {actionError && (
              <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
                {actionError}
              </p>
            )}

            {session.status === "scheduled" && (
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="font-bold text-[#355642]">
                    Bạn đã sẵn sàng học chưa?
                  </h2>

                  <p className="mt-1 text-sm text-[#89958A]">
                    Nhấn bắt đầu để StudyPilot ghi nhận thời gian học thực tế.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleStartSession}
                  disabled={isStarting}
                  className="rounded-xl bg-[#54765D] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#3F6249] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isStarting
                    ? "Đang bắt đầu..."
                    : "Bắt đầu học →"}
                </button>
              </div>
            )}

            {session.status === "in_progress" && (
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
                <div>
                  <p className="font-bold text-[#355642]">
                    Buổi học đang diễn ra
                  </p>

                  <p className="mt-1 text-sm text-[#89958A]">
                    StudyPilot đang ghi nhận thời gian học thực tế của bạn.
                  </p>

                  <button
                    type="button"
                    onClick={handleCompleteSession}
                    disabled={
                      isCompleting ||
                      studySeconds < MINIMUM_STUDY_SECONDS
                    }
                    className="mt-4 rounded-xl bg-[#54765D] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3F6249] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isCompleting
                      ? "Đang hoàn thành..."
                      : studySeconds < MINIMUM_STUDY_SECONDS
                        ? `Cần học thêm ${formatStudyTime(
                            MINIMUM_STUDY_SECONDS - studySeconds
                          )}`
                        : "Hoàn thành buổi học"}
                  </button>
                </div>

                <div className="rounded-xl bg-[#E8EEE4] px-6 py-4 text-center">
                  <p className="text-xs font-medium text-[#54765D]">
                    THỜI GIAN ĐÃ HỌC
                  </p>

                  <p className="mt-2 font-mono text-3xl font-bold tracking-wider text-[#355642]">
                    {formatStudyTime(studySeconds)}
                  </p>

                  <p className="mt-2 text-xs text-[#829080]">
                    Mục tiêu tối thiểu: 5 phút
                  </p>
                </div>
              </div>
            )}

            {session.status === "completed" && (
              <div className="space-y-4">
                <div>
                  <p className="font-semibold text-green-700">
                    Bạn đã hoàn thành buổi học này.
                  </p>

                  <p className="mt-1 text-sm text-[#89958A]">
                    Bài kiểm tra kiến thức đã được StudyPilot tạo tự động
                    cho buổi học này. Bạn có thể vào mục Kiểm tra kiến thức
                    để thực hiện bài kiểm tra.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => router.push("/quizzes")}
                  className="rounded-xl bg-[#54765D] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#3F6249]"
                >
                  Đến Kiểm tra kiến thức →
                </button>
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start">
            {contentSections.length > 0 && (
              <aside className="rounded-2xl border border-[#E1E9E1] bg-[#F8FBF7] p-5 lg:sticky lg:top-6">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#829184]">
                  MỤC LỤC BÀI HỌC
                </p>
                <nav className="mt-4 space-y-1">
                  {lessonOutline.map(({ section, number, level }) => (
                    <a
                      key={`${number}-${section.heading}`}
                      href={`#lesson-content-${number}`}
                      className="block rounded-lg py-2 pr-2 text-sm leading-5 text-[#5F7464] transition hover:bg-white hover:text-[#355642]"
                      style={{ paddingLeft: `${12 + level * 12}px` }}
                    >
                      <span className="mr-2 text-xs font-bold text-[#91A596]">
                        {number}
                      </span>
                      {section.heading}
                    </a>
                  ))}
                </nav>
              </aside>
            )}

          <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6 shadow-sm sm:p-8">
            <div className="mb-6">
              <p className="text-sm font-medium text-[#829080]">
                BÀI HỌC HÔM NAY
              </p>

              <h2 className="mt-2 text-xl font-bold text-[#355642]">
                {getPreferredContentTitle(
                  topic?.name,
                  contentSections[0]?.heading
                )}
              </h2>

              {topic?.hierarchy && (
                <p className="mt-2 text-sm text-[#89958A]">
                  {topic.hierarchy}
                </p>
              )}

              {topic?.description && (
                <p className="mt-3 text-sm leading-7 text-[#536657]">
                  {topic.description}
                </p>
              )}
            </div>

            {!topic?.content_sections?.length && chunks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#DCE3D8] bg-[#F7F8F3] p-8 text-center">
                <p className="font-semibold text-[#536657]">
                  Chưa có nội dung tài liệu cho buổi học này
                </p>

                <p className="mt-2 text-sm text-[#89958A]">
                  Bạn cần kiểm tra lại việc AI phân bổ nội dung tài liệu cho chủ đề.
                </p>
              </div>
            ) : topic?.content_sections &&
              topic.content_sections.length > 0 ? (
              <div className="space-y-6">
                {topic.content_sections.map((section, index) => (
                  <article
                    id={`lesson-section-${index + 1}`}
                    key={`${index}-${section.heading}`}
                    className="scroll-mt-6 rounded-2xl border border-[#E2E5DC] bg-white p-5 shadow-[0_8px_24px_rgba(54,85,61,0.04)] sm:p-6"
                  >
                    <ContentSectionView
                      section={section}
                      anchorId={`lesson-content-${index + 1}`}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                {chunks.map((chunk, index) => (
                  <article
                    key={chunk.id}
                    className="rounded-xl border border-[#E2E5DC] bg-white p-5"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-[#355642]">
                        Phần nội dung {index + 1}
                      </h3>

                      <span className="rounded-full bg-[#E8EEE4] px-3 py-1 text-xs font-medium text-[#54765D]">
                        {chunk.page_number
                          ? `Trang ${chunk.page_number}`
                          : "Tài liệu gốc"}
                      </span>
                    </div>

                    <p className="whitespace-pre-wrap text-sm leading-8 text-[#536657]">
                      {chunk.content}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
