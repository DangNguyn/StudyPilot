"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";

type ExamPlan = {
  id: string;
  title: string;
  exam_date: string;
  daily_available_minutes: number;
  study_days_per_week?: number;
};

type Topic = {
  id: string;
  name: string;
  description: string | null;
  difficulty_level: number;
  understanding_level: number;
  estimated_minutes: number;
  priority: number;
  status: string;
};

type StudySession = {
  id: string;
  topic_id: string;
  scheduled_start: string;
  duration_minutes: number;
  status: string;
  source: string;
  notes: string | null;
};

type ApiResponse<T> = {
  data?: T | T[];
  detail?: unknown;
  message?: string;
};

const API_URL = "http://127.0.0.1:8000";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
];

const WEEKDAY_NAMES = [
  "Thứ 2",
  "Thứ 3",
  "Thứ 4",
  "Thứ 5",
  "Thứ 6",
  "Thứ 7",
  "Chủ nhật",
];

type StudyWeek = {
  weekNumber: number;
  dates: string[];
};

type ScheduleDay = {
  dateKey: string;
  label: string;
  sessions: StudySession[];
};

type ScheduleWeek = {
  weekNumber: number;
  days: ScheduleDay[];
};

type FeedbackType = "info" | "success" | "error";

function getErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          typeof item === "object" &&
          item !== null &&
          "msg" in item
        ) {
          return String(item.msg);
        }

        return JSON.stringify(item);
      })
      .join("; ");
  }

  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }

  return fallback;
}

async function readApiResponse<T>(
  response: Response,
  fallback: string
): Promise<ApiResponse<T>> {
  let result: ApiResponse<T>;

  try {
    result = await response.json();
  } catch {
    throw new Error(
      response.ok
        ? "Backend trả về dữ liệu không hợp lệ."
        : fallback
    );
  }

  if (!response.ok) {
    throw new Error(
      getErrorMessage(result.detail, fallback)
    );
  }

  return result;
}

function getDataList<T>(result: ApiResponse<T>): T[] {
  if (Array.isArray(result.data)) {
    return result.data;
  }

  if (result.data && typeof result.data === "object") {
    return [result.data as T];
  }

  return [];
}

function getDataRecord<T>(
  result: ApiResponse<T>,
  fallback: string
): T {
  const records = getDataList(result);

  if (records.length > 0) {
    return records[0];
  }

  throw new Error(fallback);
}

export default function StudyPlansPage() {
  const router = useRouter();

  const [today, setToday] = useState("");

  const [examPlans, setExamPlans] = useState<ExamPlan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [planError, setPlanError] = useState("");

  const [planTopics, setPlanTopics] = useState<Topic[]>([]);
  const [allTopics, setAllTopics] = useState<Topic[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    null
  );
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [topicError, setTopicError] = useState("");

  const [studySessions, setStudySessions] = useState<StudySession[]>(
    []
  );
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const [subjectName, setSubjectName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [dailyHours, setDailyHours] = useState("2");
  const [studyDays, setStudyDays] = useState("6");
  const [selectedStudyDates, setSelectedStudyDates] = useState<string[]>(
    []
  );
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<number[]>([1]);
  const [isScheduleTableExpanded, setIsScheduleTableExpanded] =
    useState(true);
  const [isScheduleConfirmed, setIsScheduleConfirmed] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const [message, setMessage] = useState("");
  const [feedbackType, setFeedbackType] =
    useState<FeedbackType>("info");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStep, setSubmissionStep] = useState("");

  function setFeedback(
    nextMessage: string,
    type: FeedbackType = "info"
  ) {
    setMessage(nextMessage);
    setFeedbackType(type);
  }

  function getVietnamToday(): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date());
  }

  function formatLocalDateKey(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  // Lấy ngày hiện tại theo múi giờ Việt Nam, đồng nhất với Backend.
  useEffect(() => {
    setToday(getVietnamToday());
  }, []);

  // Tải danh sách kế hoạch ôn thi.
  const loadExamPlans = useCallback(async () => {
    setIsLoadingPlans(true);
    setPlanError("");

    try {
      const response = await fetch(`${API_URL}/api/exam-plans`);
      const result = await readApiResponse<ExamPlan>(
        response,
        "Không thể tải danh sách kế hoạch."
      );

      const plans = getDataList(result);

      setExamPlans(plans);

      return plans;
    } catch (error) {
      setPlanError(
        error instanceof Error
          ? error.message
          : "Đã xảy ra lỗi khi tải kế hoạch."
      );

      return [];
    } finally {
      setIsLoadingPlans(false);
    }
  }, []);

  // Tải chủ đề thuộc tất cả kế hoạch.
  const loadAllTopics = useCallback(async () => {
    if (examPlans.length === 0) {
      setAllTopics([]);
      return;
    }

    try {
      const topicResponses = await Promise.all(
        examPlans.map(async (plan) => {
          const response = await fetch(
            `${API_URL}/api/topics?exam_plan_id=${encodeURIComponent(
              plan.id
            )}`
          );

          const result = await readApiResponse<Topic>(
            response,
            `Không thể tải chủ đề của kế hoạch ${plan.title}.`
          );

          return getDataList(result);
        })
      );

      setAllTopics(topicResponses.flat());
    } catch (error) {
      console.error("Lỗi tải danh sách chủ đề:", error);
    }
  }, [examPlans]);

  // Tải lịch học.
  const loadStudySessions = useCallback(async () => {
    setIsLoadingSessions(true);
    setSessionError("");

    try {
      const response = await fetch(
        `${API_URL}/api/study-sessions`
      );

      const result = await readApiResponse<StudySession>(
        response,
        "Không thể tải lịch học."
      );

      setStudySessions(getDataList(result));
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? error.message
          : "Đã xảy ra lỗi khi tải lịch học."
      );
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  // Tải dữ liệu ban đầu khi mở trang.
  useEffect(() => {
    loadExamPlans();
    loadStudySessions();
  }, [loadExamPlans, loadStudySessions]);

  // Tự động tải chủ đề khi danh sách kế hoạch thay đổi.
  useEffect(() => {
    loadAllTopics();
  }, [loadAllTopics]);

  // Xem chủ đề của một kế hoạch.
  const handleSelectPlan = async (planId: string) => {
    setSelectedPlanId(planId);
    setPlanTopics([]);
    setTopicError("");
    setIsLoadingTopics(true);

    try {
      const response = await fetch(
        `${API_URL}/api/topics?exam_plan_id=${encodeURIComponent(
          planId
        )}`
      );

      const result = await readApiResponse<Topic>(
        response,
        "Không thể tải danh sách chủ đề."
      );

      setPlanTopics(getDataList(result));
    } catch (error) {
      setTopicError(
        error instanceof Error
          ? error.message
          : "Đã xảy ra lỗi khi tải chủ đề."
      );
    } finally {
      setIsLoadingTopics(false);
    }
  };

  // Kiểm tra tài liệu trước khi tải lên.
  function validateFile(file: File): string | null {
    const extension = file.name
      .toLowerCase()
      .slice(file.name.lastIndexOf("."));

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return "Định dạng tài liệu không được hỗ trợ. Vui lòng chọn PDF, DOC, DOCX, PPT hoặc PPTX.";
    }

    if (file.size > MAX_FILE_SIZE) {
      return "Tài liệu vượt quá giới hạn 50 MB.";
    }

    if (file.size === 0) {
      return "Tài liệu đang trống. Vui lòng chọn file khác.";
    }

    return null;
  }

  function getStudyWeeks(): StudyWeek[] {
    if (!today || !examDate || examDate <= today) {
      return [];
    }

    const weeks: StudyWeek[] = [];
    const endDate = new Date(`${examDate}T00:00:00`);
    const currentDate = new Date(`${today}T00:00:00`);
    let weekNumber = 1;

    while (currentDate < endDate) {
      const dates: string[] = [];

      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        if (currentDate >= endDate) {
          break;
        }

        dates.push(formatLocalDateKey(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
      }

      if (dates.length > 0) {
        weeks.push({ weekNumber, dates });
        weekNumber += 1;
      }
    }

    return weeks;
  }

  function getWeekdayName(dateValue: string): string {
    const date = new Date(`${dateValue}T00:00:00`);
    return WEEKDAY_NAMES[(date.getDay() + 6) % 7];
  }

  function formatDate(dateValue: string): string {
    return new Date(`${dateValue}T00:00:00`).toLocaleDateString(
      "vi-VN"
    );
  }

  function updateStudyDate(weekDates: string[], dateValue: string) {
    const weekSelectedDates = selectedStudyDates.filter((date) =>
      weekDates.includes(date)
    );

    const otherSelectedDates = selectedStudyDates.filter(
      (date) => !weekDates.includes(date)
    );

    if (weekSelectedDates.includes(dateValue)) {
      setSelectedStudyDates(
        selectedStudyDates.filter((date) => date !== dateValue)
      );
      setFeedback("");
      return;
    }

    if (
      weekSelectedDates.length >=
      Math.min(Number(studyDays), weekDates.length)
    ) {
      setFeedback(
        `Tuần này chỉ được chọn tối đa ${Math.min(
          Number(studyDays),
          weekDates.length
        )} ngày học.`
        ,
        "error"
      );
      return;
    }

    setFeedback("");
    setSelectedStudyDates([
      ...otherSelectedDates,
      ...weekSelectedDates,
      dateValue,
    ]);
  }

  function validateSelectedStudyDates(): string | null {
    const weeks = getStudyWeeks();
    const expectedDates = weeks.reduce(
      (total, week) =>
        total + Math.min(Number(studyDays), week.dates.length),
      0
    );

    if (selectedStudyDates.length !== expectedDates) {
      return `Vui lòng chọn đủ ngày học cho từng tuần (${expectedDates} ngày).`;
    }

    for (const week of weeks) {
      const datesInWeek = selectedStudyDates.filter((date) =>
        week.dates.includes(date)
      );

      if (
        datesInWeek.length !==
        Math.min(Number(studyDays), week.dates.length)
      ) {
        return `Tuần ${week.weekNumber} chưa được chọn đủ ngày học.`;
      }
    }

    return null;
  }

  // Tạo kế hoạch ôn thi.
  async function handleSubmit(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!subjectName.trim()) {
      setFeedback("Vui lòng nhập tên môn học.", "error");
      return;
    }

    if (!examDate) {
      setFeedback("Vui lòng chọn ngày thi.", "error");
      return;
    }

    const currentToday = getVietnamToday();

    if (examDate <= currentToday) {
      setToday(currentToday);
      setFeedback("Ngày thi phải sau ngày hôm nay.", "error");
      return;
    }

    const staleSelectedDate = selectedStudyDates.find(
      (date) => date < currentToday || date >= examDate
    );

    if (staleSelectedDate) {
      setToday(currentToday);
      setSelectedStudyDates([]);
      setIsScheduleConfirmed(false);
      setIsScheduleTableExpanded(true);
      setIsScheduleDialogOpen(true);
      setFeedback(
        "Ngày học đã chọn bị cũ hoặc nằm ngoài khoảng thời gian. "
          + "Vui lòng chọn lại ngày học từ hôm nay đến trước ngày thi.",
        "error"
      );
      return;
    }

    const scheduleError = validateSelectedStudyDates();

    if (scheduleError) {
      setFeedback(scheduleError, "error");
      setIsScheduleDialogOpen(true);
      return;
    }

    if (!selectedFile) {
      setFeedback(
        "Vui lòng tải tài liệu ôn tập lên trước khi tạo kế hoạch.",
        "error"
      );
      return;
    }

    const fileError = validateFile(selectedFile);

    if (fileError) {
      setFeedback(fileError, "error");
      return;
    }

    setIsSubmitting(true);
    setFeedback("");
    setSubmissionStep("Đang tạo môn học và kế hoạch...");

    let currentStep = "Tạo môn học";

    try {
      // 1. Tạo môn học.
      const subjectResponse = await fetch(
        `${API_URL}/api/subjects`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: subjectName.trim(),
            description: null,
            color: "#8BAF9C",
          }),
        }
      );

      const subjectResult =
        await readApiResponse<Record<string, unknown>>(
          subjectResponse,
          "Không thể tạo môn học."
        );

      const subject = getDataRecord(
        subjectResult,
        "Không nhận được dữ liệu môn học từ Backend."
      );

      const subjectId = subject.id;

      if (typeof subjectId !== "string" || !subjectId) {
        throw new Error(
          "Backend không trả về ID môn học hợp lệ."
        );
      }

      // 2. Tạo kế hoạch ôn thi.
      currentStep = "Tạo kế hoạch ôn thi";

      const planResponse = await fetch(
        `${API_URL}/api/exam-plans`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subject_id: subjectId,
            title: `Ôn thi ${subjectName.trim()}`,
            exam_date: examDate,
            daily_available_minutes: Number(dailyHours) * 60,
            study_days_per_week: Number(studyDays),
          }),
        }
      );

      const planResult =
        await readApiResponse<ExamPlan>(
          planResponse,
          "Không thể tạo kế hoạch ôn thi."
        );

      const createdPlan = getDataRecord(
        planResult,
        "Không nhận được dữ liệu kế hoạch từ Backend."
      );

      if (!createdPlan.id) {
        throw new Error(
          "Backend không trả về ID kế hoạch hợp lệ."
        );
      }

      const planId = createdPlan.id;

      // 3. Chuẩn bị tài liệu.
      currentStep = "Chuẩn bị tài liệu";
      setSubmissionStep("Đang chuẩn bị tài liệu...");

      const formData = new FormData();
      formData.append("exam_plan_id", planId);
      formData.append("material_type", "textbook");
      formData.append("file", selectedFile);

      // 4. Tải tài liệu lên.
      currentStep = "Tải tài liệu lên hệ thống";
      setSubmissionStep("Đang tải tài liệu lên hệ thống...");

      const uploadResponse = await fetch(
        `${API_URL}/api/study-materials/upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      const uploadResult =
        await readApiResponse<Record<string, unknown>>(
          uploadResponse,
          "Không thể tải tài liệu lên."
        );

      const uploadedMaterial = getDataRecord(
        uploadResult,
        "Không nhận được dữ liệu tài liệu từ Backend."
      );

      const materialId = uploadedMaterial.id;

      if (
        typeof materialId !== "string" ||
        !materialId
      ) {
        throw new Error(
          "Backend không trả về ID tài liệu hợp lệ."
        );
      }

      // 5. Xử lý nội dung tài liệu.
      currentStep = "Xử lý nội dung tài liệu";
      setSubmissionStep("Đang đọc và chia nhỏ nội dung tài liệu...");

      const processResponse = await fetch(
        `${API_URL}/api/study-materials/${materialId}/process`,
        {
          method: "POST",
        }
      );

      await readApiResponse(
        processResponse,
        "Không thể xử lý tài liệu."
      );

      // 6. Phân tích tài liệu bằng AI.
      currentStep = "Phân tích tài liệu bằng AI";
      setSubmissionStep("AI đang phân tích và chia chương/mục...");

      const analyzeResponse = await fetch(
        `${API_URL}/api/study-materials/${materialId}/analyze`,
        {
          method: "POST",
        }
      );

      await readApiResponse(
        analyzeResponse,
        "Không thể phân tích tài liệu bằng AI."
      );

      
      // 7. Tạo lịch học tự động.
      currentStep = "Tạo lịch học tự động";
      setSubmissionStep("Đang tạo lịch học theo ngày đã chọn...");

      const scheduleResponse = await fetch(
        `${API_URL}/api/exam-plans/${planId}/generate-schedule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selected_study_dates: selectedStudyDates,
          }),
        }
      );

      await readApiResponse(
        scheduleResponse,
        "Không thể tạo lịch học tự động."
      );

      // 8. Lấy danh sách buổi học đã được lưu vào database.
      currentStep = "Lấy danh sách buổi học";
      setSubmissionStep("Đang lưu các buổi học vào kế hoạch...");

      const sessionsResponse = await fetch(
        `${API_URL}/api/study-sessions?exam_plan_id=${encodeURIComponent(planId)}`
      );

      const sessionsResult =
        await readApiResponse<Record<string, unknown>>(
          sessionsResponse,
          "Không thể lấy danh sách buổi học vừa tạo."
        );

      const sessionsData = sessionsResult.data;

      if (
        !Array.isArray(sessionsData) ||
        sessionsData.length === 0
      ) {
        throw new Error(
          "Lịch học đã được tạo nhưng không tìm thấy buổi học trong hệ thống."
        );
      }

      // 9. Tạo tuần tự để tránh gửi nhiều yêu cầu AI cùng lúc.
      currentStep = "Tạo các bài kiểm tra";
      setSubmissionStep("Đang tạo các bài kiểm tra liên kết...");

      const quizFailures: string[] = [];

      for (let index = 0; index < sessionsData.length; index += 1) {
        const sessionRecord = sessionsData[index] as Record<string, unknown>;
        const sessionId = sessionRecord.id;

        if (typeof sessionId !== "string" || !sessionId) {
          quizFailures.push(`Buổi học thứ ${index + 1} không có ID hợp lệ.`);
          continue;
        }

        setSubmissionStep(
          `Đang tạo bài kiểm tra ${index + 1}/${sessionsData.length}...`
        );

        let quizCreated = false;
        let lastQuizError = "";

        for (let attempt = 1; attempt <= 2 && !quizCreated; attempt += 1) {
          try {
            const quizResponse = await fetch(
              `${API_URL}/api/quizzes/generate`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  material_id: materialId,
                  study_session_id: sessionId,
                  title: `Bài kiểm tra buổi học ${index + 1}`,
                  description:
                    "Bài kiểm tra được tạo tự động từ nội dung bài học tương ứng.",
                  number_of_questions: 10,
                  time_limit_minutes: 15,
                }),
              }
            );

            await readApiResponse(
              quizResponse,
              `Không thể tạo bài kiểm tra cho buổi học thứ ${index + 1}.`
            );
            quizCreated = true;
          } catch (error) {
            lastQuizError =
              error instanceof Error
                ? error.message
                : `Không thể tạo bài kiểm tra cho buổi học thứ ${index + 1}.`;
          }
        }

        if (!quizCreated) {
          quizFailures.push(lastQuizError);
        }
      }

      if (quizFailures.length > 0) {
        throw new Error(
          `Chưa tạo được ${quizFailures.length}/${sessionsData.length} bài kiểm tra. ` +
            quizFailures[0]
        );
      }

      // 10. Cập nhật danh sách kế hoạch.
      currentStep = "Cập nhật dữ liệu";
      setSubmissionStep("Đang cập nhật giao diện...");

      await loadExamPlans();

      // 11. Tải chủ đề của kế hoạch vừa tạo.
      await handleSelectPlan(planId);

      // 12. Tải lại lịch học.
      await loadStudySessions();

      // 13. Thông báo hoàn tất toàn bộ quy trình.
      setFeedback(
        `Đã tạo xong kế hoạch ôn thi! AI đã xử lý tài liệu và tạo ${sessionsData.length} buổi học.`,
        "success"
      );

      // Làm trống biểu mẫu.
      setSubjectName("");
      setExamDate("");
      setDailyHours("2");
      setStudyDays("6");
      setSelectedStudyDates([]);
      setIsScheduleDialogOpen(false);
      setSelectedFile(null);
      setFileInputKey((current) => current + 1);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Đã xảy ra lỗi không xác định.";

      setFeedback(
        `Không thể hoàn thành bước "${currentStep}". ${errorMessage}`,
        "error"
      );

      // Tải lại dữ liệu để tránh danh sách bị cũ
      // nếu kế hoạch đã được tạo trước khi xảy ra lỗi.
      await Promise.all([
        loadExamPlans(),
        loadStudySessions(),
      ]);
    } finally {
      setIsSubmitting(false);
      setSubmissionStep("");
    }
  }

  // Chuyển trạng thái buổi học thành tiếng Việt.
  function getSessionStatus(status: string) {
    switch (status) {
      case "scheduled":
        return "Đã lên lịch";
      case "in_progress":
        return "Đang học";
      case "completed":
        return "Đã hoàn thành";
      case "missed":
        return "Đã bỏ lỡ";
      default:
        return status;
    }
  }

  // Màu sắc trạng thái buổi học.
  function getSessionStatusStyle(status: string) {
    switch (status) {
      case "scheduled":
        return "bg-blue-100 text-blue-700";
      case "in_progress":
        return "bg-amber-100 text-amber-700";
      case "completed":
        return "bg-green-100 text-green-700";
      case "missed":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  }

  // Tìm tên chủ đề theo topic_id.
  function getTopicName(topicId: string) {
    const topic = allTopics.find(
      (item) => item.id === topicId
    );

    return topic?.name || "Chủ đề chưa xác định";
  }

  // Sắp xếp buổi học theo thời gian.
  const sortedSessions = [...studySessions].sort(
    (a, b) =>
      new Date(a.scheduled_start).getTime() -
      new Date(b.scheduled_start).getTime()
  );

  function getVietnamDateKey(value: string) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(value));
  }

  const firstSessionDate = sortedSessions.length
    ? getVietnamDateKey(sortedSessions[0].scheduled_start)
    : "";

  const scheduleWeeks = sortedSessions.reduce<
    Record<number, ScheduleWeek>
  >((weeks, session) => {
    const dateKey = getVietnamDateKey(session.scheduled_start);
    const daysFromStart = Math.max(
      0,
      Math.floor(
        (new Date(`${dateKey}T00:00:00`).getTime() -
          new Date(`${firstSessionDate}T00:00:00`).getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );
    const weekNumber = Math.floor(daysFromStart / 7) + 1;
    const week = weeks[weekNumber] || {
      weekNumber,
      days: [],
    };
    const day = week.days.find(
      (item) => item.dateKey === dateKey
    );

    if (day) {
      day.sessions.push(session);
    } else {
      week.days.push({
        dateKey,
        label: new Date(`${dateKey}T00:00:00`).toLocaleDateString(
          "vi-VN",
          {
            weekday: "long",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          }
        ),
        sessions: [session],
      });
    }

    weeks[weekNumber] = week;
    return weeks;
  }, {});

  const groupedScheduleWeeks = Object.values(scheduleWeeks).sort(
    (a, b) => a.weekNumber - b.weekNumber
  );

  const workflowSteps = [
    {
      number: "01",
      title: "Mục tiêu",
      detail: subjectName.trim() || "Nhập môn học và ngày thi",
      complete: Boolean(subjectName.trim() && examDate),
    },
    {
      number: "02",
      title: "Lịch học",
      detail: isScheduleConfirmed
        ? `${selectedStudyDates.length} ngày đã chọn`
        : "Chọn ngày học trong tuần",
      complete: isScheduleConfirmed,
    },
    {
      number: "03",
      title: "Tài liệu",
      detail: selectedFile?.name || "Tải tài liệu ôn tập",
      complete: Boolean(selectedFile),
    },
    {
      number: "04",
      title: "Tạo kế hoạch",
      detail: "AI chia chương và tạo bài kiểm tra",
      complete: false,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Page heading */}
      <section>
        <p className="text-sm font-medium text-[#829080]">
          KHÔNG GIAN HỌC TẬP / KẾ HOẠCH
        </p>

        <h1 className="mt-2 text-3xl font-bold text-[#355642]">
          Kế hoạch ôn thi
        </h1>

        <p className="mt-2 text-sm text-[#89958A]">
          Xây dựng lộ trình học tập cá nhân hóa cùng trợ lý AI
          StudyPilot.
        </p>
      </section>

      {/* Intro banner */}
      <section className="flex flex-col justify-between gap-5 rounded-2xl bg-[#E8EEE4] p-6 sm:flex-row sm:items-center sm:p-8">
        <div className="max-w-xl">
          <span className="text-3xl">🌱</span>

          <h2 className="mt-3 text-xl font-bold text-[#355642]">
            Chuẩn bị cho kỳ thi tiếp theo của bạn
          </h2>

          <p className="mt-2 text-sm leading-6 text-[#718074]">
            Cho StudyPilot biết mục tiêu, thời gian và nội dung
            cần ôn tập. AI sẽ giúp bạn xây dựng kế hoạch học
            phù hợp với quỹ thời gian.
          </p>
        </div>

        <div className="hidden h-28 w-28 shrink-0 items-center justify-center rounded-full bg-[#D7E3D2] text-5xl sm:flex">
          📚
        </div>
      </section>

      <section
        aria-label="Các bước tạo kế hoạch"
        className="grid gap-2 rounded-2xl border border-[#E8EDE5] bg-white p-3 shadow-sm sm:grid-cols-4"
      >
        {workflowSteps.map((step, index) => (
          <div
            key={step.number}
            className={`relative rounded-xl px-3 py-3 ${
              step.complete
                ? "bg-[#F0F6EE]"
                : "bg-[#FAFBF8]"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.complete
                    ? "bg-[#54765D] text-white"
                    : "bg-[#E8EEE4] text-[#54765D]"
                }`}
              >
                {step.complete ? "✓" : step.number}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#355642]">
                  {step.title}
                </p>
                <p className="mt-1 truncate text-xs text-[#89958A]">
                  {step.detail}
                </p>
              </div>
            </div>
            {index < workflowSteps.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute -right-2 top-7 z-10 hidden text-[#B8C8B6] sm:block"
              >
                →
              </span>
            )}
          </div>
        ))}
      </section>

      {/* Create plan form */}
      <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6 shadow-sm sm:p-8">
        <div className="mb-7">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E9EFE6] text-xl">
              ✨
            </span>

            <div>
              <h2 className="text-lg font-bold text-[#355642]">
                Tạo kế hoạch mới
              </h2>

              <p className="mt-1 text-sm text-[#89958A]">
                Cung cấp thông tin để bắt đầu lập kế hoạch.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Subject */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#536657]">
              Tên môn học <span className="text-red-500">*</span>
            </label>

            <input
              type="text"
              required
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="Ví dụ: Cấu trúc dữ liệu và giải thuật"
              className="w-full rounded-xl border border-[#E2E5DC] bg-white px-4 py-3 text-sm text-[#355642] outline-none transition placeholder:text-[#B0B8AE] focus:border-[#78947B] focus:ring-2 focus:ring-[#E8EEE4]"
            />
          </div>

          {/* Exam date and daily hours */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#536657]">
                Ngày thi <span className="text-red-500">*</span>
              </label>

              <input
                type="date"
                required
                min={today || undefined}
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                className="w-full rounded-xl border border-[#E2E5DC] bg-white px-4 py-3 text-sm text-[#536657] outline-none focus:border-[#78947B] focus:ring-2 focus:ring-[#E8EEE4]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-[#536657]">
                Thời gian học mỗi ngày
              </label>

              <select
                value={dailyHours}
                onChange={(e) => setDailyHours(e.target.value)}
                className="w-full rounded-xl border border-[#E2E5DC] bg-white px-4 py-3 text-sm text-[#536657] outline-none focus:border-[#78947B]"
              >
                <option value="1">1 giờ / ngày</option>
                <option value="2">2 giờ / ngày</option>
                <option value="3">3 giờ / ngày</option>
                <option value="4">4 giờ / ngày</option>
                <option value="5">5 giờ / ngày</option>
                <option value="6">6 giờ / ngày</option>
              </select>
            </div>
          </div>

          {/* Study days */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#536657]">
              Số ngày có thể học mỗi tuần
            </label>

            <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
              {["1", "2", "3", "4", "5", "6", "7"].map(
                (day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      setStudyDays(day);
                      setSelectedStudyDates([]);
                      setExpandedWeeks([1]);
                      setIsScheduleTableExpanded(true);
                      setIsScheduleConfirmed(false);
                      setFeedback("");
                      setIsScheduleDialogOpen(true);
                    }}
                    className={`rounded-xl border py-3 text-sm font-semibold transition ${
                      studyDays === day
                        ? "border-[#54765D] bg-[#E6EDE4] text-[#355642]"
                        : "border-[#E2E5DC] bg-white text-[#829080] hover:border-[#A9BBA7]"
                    }`}
                  >
                    {day} ngày
                  </button>
                )
              )}
            </div>

          </div>

          {isScheduleDialogOpen && (
            <div className="rounded-2xl border border-[#C9D7C6] bg-[#F7F8F3] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-[#355642]">
                    Chọn ngày học theo từng tuần
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (isScheduleConfirmed) {
                      setIsScheduleTableExpanded((current) => !current);
                    } else {
                      setIsScheduleDialogOpen(false);
                    }
                  }}
                  className="rounded-lg px-2 py-1 text-lg text-[#829080] hover:bg-white"
                  aria-label={
                    isScheduleConfirmed
                      ? isScheduleTableExpanded
                        ? "Thu gọn bảng chọn ngày học"
                        : "Mở bảng chọn ngày học"
                      : "Đóng bảng chọn ngày học"
                  }
                >
                  {isScheduleConfirmed
                    ? isScheduleTableExpanded
                      ? "⌃"
                      : "⌄"
                    : "×"}
                </button>
              </div>

              <div
                className={
                  isScheduleTableExpanded ? "block" : "hidden"
                }
              >
              {!examDate ? (
                <p className="mt-4 rounded-xl bg-white p-4 text-sm text-[#89958A]">
                  Vui lòng chọn ngày thi trước.
                </p>
              ) : getStudyWeeks().length === 0 ? (
                <p className="mt-4 rounded-xl bg-white p-4 text-sm text-red-600">
                  Ngày thi phải sau hôm nay để tạo lịch học.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  {getStudyWeeks().map((week) => {
                    const selectedDates = selectedStudyDates
                      .filter((date) => week.dates.includes(date))
                      .sort();
                    const requiredDates = Math.min(
                      Number(studyDays),
                      week.dates.length
                    );

                    return (
                      <div
                        key={week.weekNumber}
                        className="overflow-hidden rounded-xl border border-[#DCE3D8] bg-white"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedWeeks((current) =>
                              current.includes(week.weekNumber)
                                ? current.filter(
                                    (weekNumber) =>
                                      weekNumber !== week.weekNumber
                                  )
                                : [...current, week.weekNumber]
                            )
                          }
                          className="flex w-full items-center justify-between border-b border-[#EAEAE2] bg-[#E8EEE4] px-4 py-3 text-left text-sm font-bold text-[#355642]"
                          aria-expanded={expandedWeeks.includes(
                            week.weekNumber
                          )}
                        >
                          <span>
                            Tuần {week.weekNumber} · Đã chọn{" "}
                            {selectedDates.length}/{requiredDates} ngày
                          </span>
                          <span
                            className="text-lg leading-none"
                            aria-hidden="true"
                          >
                            {expandedWeeks.includes(week.weekNumber)
                              ? "⌃"
                              : "⌄"}
                          </span>
                        </button>

                        {expandedWeeks.includes(week.weekNumber) && (
                          <div className="divide-y divide-[#F0F1EC]">
                            {Array.from(
                              { length: requiredDates },
                              (_, slotIndex) => {
                                const selectedDate =
                                  selectedDates[slotIndex] || "";

                                return (
                                  <div
                                    key={`${week.weekNumber}-${slotIndex}`}
                                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                                  >
                                    <span className="text-sm font-semibold text-[#536657]">
                                      Ngày học {slotIndex + 1}
                                    </span>

                                    <div className="flex flex-wrap gap-2">
                                      {week.dates.map((date) => {
                                        const isSelected =
                                          selectedDates.includes(date);
                                        const isUsedByAnotherSlot =
                                          isSelected &&
                                          date !== selectedDate;

                                        return (
                                          <button
                                            key={date}
                                            type="button"
                                            disabled={isUsedByAnotherSlot}
                                            onClick={() =>
                                              updateStudyDate(
                                                week.dates,
                                                date
                                              )
                                            }
                                            className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                                              isSelected
                                                ? "border-[#54765D] bg-[#54765D] text-white"
                                                : "border-[#E2E5DC] bg-white text-[#54765D] hover:border-[#A9BBA7]"
                                            } disabled:cursor-not-allowed disabled:opacity-40`}
                                          >
                                            {getWeekdayName(date)}{" "}
                                            {formatDate(date)}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              }
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-[#89958A]">
                  Ngày thi không được đưa vào lịch học.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const error = validateSelectedStudyDates();
                    setFeedback(
                      error || "Đã lưu lựa chọn ngày học.",
                      error ? "error" : "success"
                    );
                    if (!error) {
                      setExpandedWeeks([]);
                      setIsScheduleConfirmed(true);
                    }
                  }}
                  className="rounded-xl bg-[#54765D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#3F6249]"
                >
                  Xác nhận ngày học
                </button>
              </div>
              </div>
            </div>
          )}

          {/* Study materials */}
          <div>
            <label className="mb-2 block text-sm font-semibold text-[#536657]">
              Tài liệu ôn tập{" "}
              <span className="text-red-500">*</span>
            </label>

            <p className="mb-3 text-sm leading-6 text-[#89958A]">
              Tải tài liệu môn học lên. StudyPilot AI sẽ phân
              tích nội dung, nhận diện các chương và chủ đề để
              xây dựng lộ trình ôn tập.
            </p>

            <label
              htmlFor="study-material"
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#C9D7C6] bg-[#F7F8F3] px-5 py-8 text-center transition hover:border-[#78947B] hover:bg-[#F0F4ED]"
            >
              <span className="text-4xl">📄</span>

              <span className="mt-3 text-sm font-semibold text-[#355642]">
                Chọn tài liệu từ thiết bị
              </span>

              <span className="mt-2 text-xs text-[#89958A]">
                Hỗ trợ PDF, DOC, DOCX, PPT và PPTX · Tối đa 50 MB
              </span>

              <input
                key={fileInputKey}
                id="study-material"
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx"
                required
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;

                  if (!file) {
                    setSelectedFile(null);
                    return;
                  }

                  const validationError = validateFile(file);

                  if (validationError) {
                    setSelectedFile(null);
                    setFeedback(validationError, "error");
                    e.target.value = "";
                    return;
                  }

                  setFeedback("");
                  setSelectedFile(file);
                }}
              />
            </label>

            {selectedFile && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#DCE3D8] bg-white p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-2xl">📘</span>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#355642]">
                      {selectedFile.name}
                    </p>

                    <p className="mt-1 text-xs text-[#89958A]">
                      {(selectedFile.size / (1024 * 1024)).toFixed(
                        2
                      )}{" "}
                      MB
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setFileInputKey((current) => current + 1);
                  }}
                  className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  Xóa
                </button>
              </div>
            )}
          </div>

          {/* Submit */}
          <div className="border-t border-[#EAEAE2] pt-6">
            {message && (
              <p
                role={feedbackType === "error" ? "alert" : "status"}
                className={`mb-4 rounded-xl border p-4 text-sm leading-6 ${
                  feedbackType === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : feedbackType === "success"
                      ? "border-[#C9DCC7] bg-[#E8F3E6] text-[#355642]"
                      : "border-[#DCE3D8] bg-[#F7F8F3] text-[#536657]"
                }`}
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#54765D] px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-[#3F6249] disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
            >
              {isSubmitting
                ? submissionStep || "Đang tạo kế hoạch..."
                : "✨ Tạo kế hoạch với AI"}
            </button>

            <p className="mt-3 text-xs text-[#9AA397]">
              {isSubmitting
                ? "Bạn có thể chờ ở màn hình này; không cần bấm lại."
                : "Thông tin được lưu vào hệ thống trong quá trình tạo kế hoạch."}
            </p>
          </div>
        </form>
      </section>

      {/* Plan list */}
      <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6 shadow-sm sm:p-8">
        <div>
          <h2 className="text-lg font-bold text-[#355642]">
            Kế hoạch của tôi
          </h2>

          <p className="mt-1 text-sm text-[#89958A]">
            Quản lý và theo dõi các kế hoạch ôn thi của bạn.
          </p>
        </div>

        {isLoadingPlans ? (
          <p className="mt-6 text-sm text-[#89958A]">
            Đang tải danh sách kế hoạch...
          </p>
        ) : planError ? (
          <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-600">
            {planError}
          </p>
        ) : examPlans.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#DCE3D8] bg-[#F7F8F3] px-5 py-10 text-center">
            <span className="text-4xl">🗓️</span>

            <h3 className="mt-3 font-semibold text-[#536657]">
              Chưa có kế hoạch ôn thi
            </h3>

            <p className="mt-2 text-sm text-[#89958A]">
              Những kế hoạch bạn tạo sẽ xuất hiện tại đây.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {examPlans.map((plan) => (
              <div
                key={plan.id}
                className="rounded-xl border border-[#E2E5DC] bg-white p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-[#355642]">
                      {plan.title}
                    </h3>

                    <p className="mt-2 text-sm text-[#829080]">
                      📅 Ngày thi:{" "}
                      {new Date(
                        plan.exam_date
                      ).toLocaleDateString("vi-VN")}
                    </p>

                    <p className="mt-1 text-sm text-[#829080]">
                      ⏰ Thời gian học:{" "}
                      {plan.daily_available_minutes / 60} giờ/ngày
                    </p>
                  </div>

                  <span className="rounded-lg bg-[#E8EEE4] px-3 py-1 text-xs font-semibold text-[#54765D]">
                    Đang học
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectPlan(plan.id)}
                    className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                      selectedPlanId === plan.id
                        ? "bg-[#54765D] text-white"
                        : "bg-[#F0F4ED] text-[#54765D] hover:bg-[#E2EBDD]"
                    }`}
                  >
                    Xem chủ đề
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      router.push(`/study-plans/${plan.id}`)
                    }
                    className="rounded-lg bg-[#E8EEE4] px-3 py-2.5 text-sm font-semibold text-[#54765D] transition hover:bg-[#DCE7D8]"
                  >
                    Xem lộ trình →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Topics of selected plan */}
        {selectedPlanId && (
          <div className="mt-8 border-t border-[#EAEAE2] pt-6">
            <h3 className="text-lg font-bold text-[#355642]">
              Các chủ đề ôn tập
            </h3>

            {isLoadingTopics ? (
              <p className="mt-4 text-sm text-[#89958A]">
                Đang tải danh sách chủ đề...
              </p>
            ) : topicError ? (
              <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-600">
                {topicError}
              </p>
            ) : planTopics.length === 0 ? (
              <p className="mt-4 text-sm text-[#89958A]">
                Kế hoạch này chưa có chủ đề ôn tập.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {planTopics.map((topic, index) => (
                  <div
                    key={topic.id}
                    className="rounded-xl border border-[#E2E5DC] bg-white p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E8EEE4] text-sm font-bold text-[#54765D]">
                        {index + 1}
                      </span>

                      <div className="min-w-0">
                        <h4 className="font-semibold text-[#355642]">
                          {getMainTopicTitle(topic.name)}
                        </h4>

                        <p className="mt-1 text-xs text-[#89958A]">
                          Độ khó: {topic.difficulty_level}/5
                          {" · "}
                          Thời gian: {topic.estimated_minutes} phút
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* My study schedule */}
      <section className="rounded-2xl border border-[#E8E8DF] bg-[#FCFBF7] p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-[#355642]">
              📅 Lịch ôn tập của tôi
            </h2>

            <p className="mt-1 text-sm text-[#89958A]">
              Theo dõi các buổi học đã được lên lịch từ AI hoặc
              tạo thủ công.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              loadAllTopics();
              loadStudySessions();
            }}
            disabled={isLoadingSessions}
            className="rounded-xl border border-[#DCE3D8] bg-white px-4 py-2.5 text-sm font-semibold text-[#54765D] transition hover:bg-[#E8EEE4] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingSessions
              ? "Đang tải..."
              : "↻ Làm mới lịch học"}
          </button>
        </div>

        {sessionError ? (
          <div className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-600">
            {sessionError}
          </div>
        ) : isLoadingSessions ? (
          <p className="mt-6 text-sm text-[#89958A]">
            Đang tải danh sách buổi học...
          </p>
        ) : sortedSessions.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#DCE3D8] bg-[#F7F8F3] px-5 py-10 text-center">
            <span className="text-4xl">📖</span>

            <h3 className="mt-3 font-semibold text-[#536657]">
              Chưa có buổi học nào
            </h3>

            <p className="mt-2 text-sm text-[#89958A]">
              Khi bạn tạo kế hoạch và lịch học, thông tin sẽ
              xuất hiện tại đây.
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-[#536657]">
                Tổng số buổi học
              </p>

              <span className="rounded-full bg-[#E8EEE4] px-3 py-1 text-sm font-bold text-[#54765D]">
                {sortedSessions.length} buổi
              </span>
            </div>

            {groupedScheduleWeeks.map((week) => (
              <div
                key={week.weekNumber}
                className="rounded-2xl border border-[#DCE7D8] bg-[#F8FBF7] p-5 sm:p-6"
              >
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                  <h3 className="text-lg font-bold text-[#355642]">
                    Tuần {week.weekNumber}
                  </h3>
                  <span className="w-fit rounded-full bg-[#E8EEE4] px-3 py-1 text-sm font-semibold text-[#54765D]">
                    {week.days.length} ngày học
                  </span>
                </div>

                <div className="mt-5 space-y-5">
                  {week.days.map((day, dayIndex) => (
                    <div key={day.dateKey}>
                      <h4 className="mb-3 font-bold capitalize text-[#355642]">
                        Ngày {dayIndex + 1} · {day.label}
                      </h4>

                      <div className="space-y-3 border-l-2 border-[#DCE7D8] pl-4">
                        {day.sessions.map((session) => (
                          <div
                            key={session.id}
                            className="rounded-xl border border-[#E2E5DC] bg-white p-4 sm:p-5"
                          >
                            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                              <div className="min-w-0">
                                <h3 className="font-semibold text-[#355642]">
                                  {getTopicName(session.topic_id)}
                                </h3>

                                <p className="mt-2 text-sm text-[#718074]">
                                  ⏱ Thời lượng:{" "}
                                  {session.duration_minutes} phút
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`rounded-full px-3 py-1 text-xs font-semibold ${getSessionStatusStyle(
                                    session.status
                                  )}`}
                                >
                                  {getSessionStatus(session.status)}
                                </span>

                                <span className="rounded-full bg-[#E8EEE4] px-3 py-1 text-xs font-semibold text-[#54765D]">
                                  {session.source === "ai"
                                    ? "✨ AI đề xuất"
                                    : "Tạo thủ công"}
                                </span>
                              </div>
                            </div>

                            {session.notes && (
                              <div className="mt-4 border-t border-[#EAEAE2] pt-3">
                                <p className="text-xs font-semibold text-[#718074]">
                                  Ghi chú
                                </p>

                                <p className="mt-1 text-sm leading-6 text-[#89958A]">
                                  {session.notes}
                                </p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}