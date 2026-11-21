"use client";

import { currentLocale, tx } from "@/lib/i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { getMainTopicTitle } from "@/lib/content-titles";
import StudyDayPicker from "@/components/study-day-picker";
import PlanOverviewCards from "@/components/plan-overview-cards";
import MaterialDropzone from "@/components/material-dropzone";
import {
  CreatePlanHero,
  FocusChapterChips,
  PlanModeCards,
  PlanPreviewDialog,
  type OutlineChapter,
  type OutlineState,
  type PlanMode,
} from "@/components/plan-create-panels";
import { IconCheck, Sparkle } from "@/components/icons";
import { LoadingPlay } from "@/components/loading-play";

/* "2026-11-23" → "T2 23/11" */
function shortStudyDay(key: string) {
  const weekday = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(`${key}T00:00:00Z`).getUTCDay()];
  return `${weekday} ${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/* Tiêu đề một bước trong biểu mẫu: số thứ tự (✓ khi xong) + tên + phần phụ bên phải */
function StepHead({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5">
      <span
        className={`flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border-2 border-[var(--sp-purple-deep)] text-[13.5px] font-extrabold transition ${
          done ? "bg-emerald-500 text-white" : "bg-[var(--sp-lav)] text-[var(--sp-purple)]"
        }`}
      >
        {done ? <IconCheck size={15} /> : number}
      </span>
      <p className="text-[16.5px] font-bold text-[var(--sp-ink)]">{title}</p>
      {children}
    </div>
  );
}

/* Màn chờ khi tạo kế hoạch: 4 bước, suy ra từ dòng trạng thái đang chạy */
const PLAN_STAGES = [tx("Tải tài liệu lên"), tx("AI đọc & chia chương"), tx("Xếp lịch học"), tx("Tạo bài kiểm tra")];
function planStage(step: string) {
  const text = step.toLowerCase();
  if (/môn học|chuẩn bị|tải tài liệu/.test(text)) return 0;
  if (/đọc và chia|phân tích/.test(text)) return 1;
  if (/lịch học|lưu các buổi/.test(text)) return 2;
  return 3;
}

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
  hierarchy?: string | null;
  exam_plan_id?: string;
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
  tx("Thứ 2"),
  tx("Thứ 3"),
  tx("Thứ 4"),
  tx("Thứ 5"),
  tx("Thứ 6"),
  tx("Thứ 7"),
  tx("Chủ nhật"),
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
        ? tx("Backend trả về dữ liệu không hợp lệ.")
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
  const [isScheduleTableExpanded, setIsScheduleTableExpanded] =
    useState(true);
  const [isScheduleConfirmed, setIsScheduleConfirmed] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  // Cách chia kế hoạch + AI nhận diện chương ngay khi chọn tài liệu
  const [planMode, setPlanMode] = useState<PlanMode>("chapter");
  const [outline, setOutline] = useState<OutlineState>({ status: "idle" });
  const [focusChapters, setFocusChapters] = useState<Set<number>>(new Set());
  const outlineRequestRef = useRef(0);

  const [message, setMessage] = useState("");
  const [feedbackType, setFeedbackType] =
    useState<FeedbackType>("info");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionStep, setSubmissionStep] = useState("");
  // Đang chơi game ở màn chờ thì tạo xong không tự chuyển trang, chờ người dùng bấm "Xem kế hoạch"
  const playingWhileWaiting = useRef(false);
  const [createdHref, setCreatedHref] = useState<string | null>(null);
  // Kế hoạch dự kiến: chỉ bật lên khi đã điền đủ, xem xong mới tạo
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const closePreview = useCallback(() => setIsPreviewOpen(false), []);

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
        tx("Không thể tải danh sách kế hoạch.")
      );

      const plans = getDataList(result);

      setExamPlans(plans);

      return plans;
    } catch (error) {
      setPlanError(
        error instanceof Error
          ? error.message
          : tx("Đã xảy ra lỗi khi tải kế hoạch.")
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
            tx("Không thể tải chủ đề của kế hoạch {0}.", [plan.title])
          );

          // Gắn mã kế hoạch để biết chủ đề thuộc môn nào
          return getDataList(result).map((topic) => ({
            ...topic,
            exam_plan_id: plan.id,
          }));
        })
      );

      setAllTopics(topicResponses.flat());
    } catch (error) {
      console.error(tx("Lỗi tải danh sách chủ đề:"), error);
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
        tx("Không thể tải lịch học.")
      );

      setStudySessions(getDataList(result));
    } catch (error) {
      setSessionError(
        error instanceof Error
          ? error.message
          : tx("Đã xảy ra lỗi khi tải lịch học.")
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
        tx("Không thể tải danh sách chủ đề.")
      );

      setPlanTopics(getDataList(result));
    } catch (error) {
      setTopicError(
        error instanceof Error
          ? error.message
          : tx("Đã xảy ra lỗi khi tải chủ đề.")
      );
    } finally {
      setIsLoadingTopics(false);
    }
  };

  // Kiểm tra tài liệu trước khi tải lên.
  const loadOutline = useCallback(async (file: File | null) => {
    const requestId = ++outlineRequestRef.current;

    if (!file) {
      setOutline({ status: "idle" });
      setFocusChapters(new Set());
      return;
    }

    setOutline({ status: "loading" });

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${API_URL}/api/study-materials/preview-outline`, {
        method: "POST",
        body: formData,
      });
      const result = await readApiResponse<OutlineChapter>(
        response,
        tx("Chưa nhận diện được chương của tài liệu.")
      );
      if (requestId !== outlineRequestRef.current) return;

      const chapters = getDataList(result);
      setOutline({ status: "done", chapters });
      setFocusChapters(
        new Set(
          chapters
            .map((chapter, index) => (chapter.suggested_focus ? index : -1))
            .filter((index) => index >= 0)
        )
      );
    } catch (error) {
      if (requestId !== outlineRequestRef.current) return;
      setOutline({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : tx("Chưa nhận diện được chương của tài liệu."),
      });
      setFocusChapters(new Set());
    }
  }, []);

  function toggleFocusChapter(index: number) {
    setFocusChapters((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function validateFile(file: File): string | null {
    const extension = file.name
      .toLowerCase()
      .slice(file.name.lastIndexOf("."));

    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return tx("Định dạng tài liệu không được hỗ trợ. Vui lòng chọn PDF, DOC, DOCX, PPT hoặc PPTX.");
    }

    if (file.size > MAX_FILE_SIZE) {
      return tx("Tài liệu vượt quá giới hạn 50 MB.");
    }

    if (file.size === 0) {
      return tx("Tài liệu đang trống. Vui lòng chọn file khác.");
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
      currentLocale()
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
      setIsScheduleConfirmed(false);
      setFeedback("");
      return;
    }

    if (
      weekSelectedDates.length >=
      Math.min(Number(studyDays), weekDates.length)
    ) {
      setFeedback(
        tx("Tuần này chỉ được chọn tối đa {0} ngày học.", [Math.min(
          Number(studyDays),
          weekDates.length
        )])
        ,
        "error"
      );
      return;
    }

    setFeedback("");
    setIsScheduleConfirmed(false);
    setSelectedStudyDates([
      ...otherSelectedDates,
      ...weekSelectedDates,
      dateValue,
    ]);
  }

  // Chọn / bỏ chọn một thứ (cột) cho tất cả các tuần.
  function toggleWeekdayForAllWeeks(columnIndex: number) {
    const weeks = getStudyWeeks();
    const columnDates = weeks
      .map((week) => week.dates[columnIndex])
      .filter((date): date is string => Boolean(date));

    if (columnDates.length === 0) {
      return;
    }

    const isAllSelected = columnDates.every((date) =>
      selectedStudyDates.includes(date)
    );

    setIsScheduleConfirmed(false);

    if (isAllSelected) {
      setSelectedStudyDates(
        selectedStudyDates.filter((date) => !columnDates.includes(date))
      );
      setFeedback("");
      return;
    }

    const nextDates = [...selectedStudyDates];
    let skippedWeeks = 0;

    for (const week of weeks) {
      const date = week.dates[columnIndex];

      if (!date || nextDates.includes(date)) {
        continue;
      }

      const selectedInWeek = nextDates.filter((item) =>
        week.dates.includes(item)
      ).length;

      if (selectedInWeek >= Math.min(Number(studyDays), week.dates.length)) {
        skippedWeeks += 1;
        continue;
      }

      nextDates.push(date);
    }

    setSelectedStudyDates(nextDates);
    setFeedback(
      skippedWeeks > 0
        ? tx("Có {0} tuần đã đủ {1} ngày nên chưa thêm được thứ này. Bỏ bớt một ngày ở tuần đó nếu muốn đổi.", [skippedWeeks, studyDays])
        : "",
      skippedWeeks > 0 ? "error" : "info"
    );
  }

  function validateSelectedStudyDates(): string | null {
    const weeks = getStudyWeeks();
    const expectedDates = weeks.reduce(
      (total, week) =>
        total + Math.min(Number(studyDays), week.dates.length),
      0
    );

    if (selectedStudyDates.length !== expectedDates) {
      return tx("Vui lòng chọn đủ ngày học cho từng tuần ({0} ngày).", [expectedDates]);
    }

    for (const week of weeks) {
      const datesInWeek = selectedStudyDates.filter((date) =>
        week.dates.includes(date)
      );

      if (
        datesInWeek.length !==
        Math.min(Number(studyDays), week.dates.length)
      ) {
        return tx("Tuần {0} chưa được chọn đủ ngày học.", [week.weekNumber]);
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
      setFeedback(tx("Vui lòng nhập tên môn học."), "error");
      return;
    }

    if (!examDate) {
      setFeedback(tx("Vui lòng chọn ngày thi."), "error");
      return;
    }

    const currentToday = getVietnamToday();

    if (examDate <= currentToday) {
      setToday(currentToday);
      setFeedback(tx("Ngày thi phải sau ngày hôm nay."), "error");
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
        tx("Ngày học đã chọn bị cũ hoặc nằm ngoài khoảng thời gian. ")
          + tx("Vui lòng chọn lại ngày học từ hôm nay đến trước ngày thi."),
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
        tx("Vui lòng tải tài liệu ôn tập lên trước khi tạo kế hoạch."),
        "error"
      );
      return;
    }

    const fileError = validateFile(selectedFile);

    if (fileError) {
      setFeedback(fileError, "error");
      return;
    }

    const outlineChapters =
      outline.status === "done" ? outline.chapters : [];
    const useFocusMode =
      planMode === "focus"
      && focusChapters.size > 0
      && focusChapters.size < outlineChapters.length;

    if (planMode === "focus") {
      if (outline.status === "loading") {
        setFeedback(tx("AI đang nhận diện chương, vui lòng chờ vài giây rồi bấm lại."), "info");
        return;
      }

      if (outline.status !== "done") {
        setFeedback(
          tx("Chưa nhận diện được chương nên chưa chia theo trọng tâm được. ")
            + tx("Hãy bấm \"Thử lại\" hoặc chọn \"Theo chương\"."),
          "error"
        );
        return;
      }

      if (focusChapters.size === 0) {
        setFeedback(tx("Hãy chọn ít nhất 1 chương trọng tâm."), "error");
        return;
      }
    }

    const focusSelection = useFocusMode
      ? outlineChapters.filter((_, index) => focusChapters.has(index))
      : [];

    setIsSubmitting(true);
    setFeedback("");
    setSubmissionStep(tx("Đang tạo môn học và kế hoạch..."));

    let currentStep = tx("Tạo môn học");

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
          tx("Không thể tạo môn học.")
        );

      const subject = getDataRecord(
        subjectResult,
        tx("Không nhận được dữ liệu môn học từ Backend.")
      );

      const subjectId = subject.id;

      if (typeof subjectId !== "string" || !subjectId) {
        throw new Error(
          tx("Backend không trả về ID môn học hợp lệ.")
        );
      }

      // 2. Tạo kế hoạch ôn thi.
      currentStep = tx("Tạo kế hoạch ôn thi");

      const planResponse = await fetch(
        `${API_URL}/api/exam-plans`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subject_id: subjectId,
            title: tx("Ôn thi {0}", [subjectName.trim()]),
            exam_date: examDate,
            daily_available_minutes: Number(dailyHours) * 60,
            study_days_per_week: Number(studyDays),
          }),
        }
      );

      const planResult =
        await readApiResponse<ExamPlan>(
          planResponse,
          tx("Không thể tạo kế hoạch ôn thi.")
        );

      const createdPlan = getDataRecord(
        planResult,
        tx("Không nhận được dữ liệu kế hoạch từ Backend.")
      );

      if (!createdPlan.id) {
        throw new Error(
          tx("Backend không trả về ID kế hoạch hợp lệ.")
        );
      }

      const planId = createdPlan.id;

      // 3. Chuẩn bị tài liệu.
      currentStep = tx("Chuẩn bị tài liệu");
      setSubmissionStep(tx("Đang chuẩn bị tài liệu..."));

      const formData = new FormData();
      formData.append("exam_plan_id", planId);
      formData.append("material_type", "textbook");
      formData.append("file", selectedFile);

      // 4. Tải tài liệu lên.
      currentStep = tx("Tải tài liệu lên hệ thống");
      setSubmissionStep(tx("Đang tải tài liệu lên hệ thống..."));

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
          tx("Không thể tải tài liệu lên.")
        );

      const uploadedMaterial = getDataRecord(
        uploadResult,
        tx("Không nhận được dữ liệu tài liệu từ Backend.")
      );

      const materialId = uploadedMaterial.id;

      if (
        typeof materialId !== "string" ||
        !materialId
      ) {
        throw new Error(
          tx("Backend không trả về ID tài liệu hợp lệ.")
        );
      }

      // 5. Xử lý nội dung tài liệu.
      currentStep = tx("Xử lý nội dung tài liệu");
      setSubmissionStep(tx("Đang đọc và chia nhỏ nội dung tài liệu..."));

      const processResponse = await fetch(
        `${API_URL}/api/study-materials/${materialId}/process`,
        {
          method: "POST",
        }
      );

      await readApiResponse(
        processResponse,
        tx("Không thể xử lý tài liệu.")
      );

      // 6. Phân tích tài liệu bằng AI.
      currentStep = tx("Phân tích tài liệu bằng AI");
      setSubmissionStep(tx("AI đang phân tích và chia chương/mục..."));

      const analyzeResponse = await fetch(
        `${API_URL}/api/study-materials/${materialId}/analyze`,
        {
          method: "POST",
        }
      );

      await readApiResponse(
        analyzeResponse,
        tx("Không thể phân tích tài liệu bằng AI.")
      );


      // 7. Tạo lịch học tự động.
      currentStep = tx("Tạo lịch học tự động");
      setSubmissionStep(tx("Đang tạo lịch học theo ngày đã chọn..."));

      const scheduleResponse = await fetch(
        `${API_URL}/api/exam-plans/${planId}/generate-schedule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selected_study_dates: selectedStudyDates,
            plan_mode: useFocusMode ? "focus" : "chapter",
            focus_ranges: focusSelection.map((chapter) => [
              chapter.start_chunk,
              chapter.end_chunk,
            ]),
            focus_chapters: focusSelection.map((chapter) => chapter.name),
          }),
        }
      );

      await readApiResponse(
        scheduleResponse,
        tx("Không thể tạo lịch học tự động.")
      );

      // 8. Lấy danh sách buổi học đã được lưu vào database.
      currentStep = tx("Lấy danh sách buổi học");
      setSubmissionStep(tx("Đang lưu các buổi học vào kế hoạch..."));

      const sessionsResponse = await fetch(
        `${API_URL}/api/study-sessions?exam_plan_id=${encodeURIComponent(planId)}`
      );

      const sessionsResult =
        await readApiResponse<Record<string, unknown>>(
          sessionsResponse,
          tx("Không thể lấy danh sách buổi học vừa tạo.")
        );

      const sessionsData = sessionsResult.data;

      if (
        !Array.isArray(sessionsData) ||
        sessionsData.length === 0
      ) {
        throw new Error(
          tx("Lịch học đã được tạo nhưng không tìm thấy buổi học trong hệ thống.")
        );
      }

      // 9. Tạo tuần tự để tránh gửi nhiều yêu cầu AI cùng lúc.
      currentStep = tx("Tạo các bài kiểm tra");
      setSubmissionStep(tx("Đang tạo các bài kiểm tra liên kết..."));

      const quizFailures: string[] = [];

      for (let index = 0; index < sessionsData.length; index += 1) {
        const sessionRecord = sessionsData[index] as Record<string, unknown>;
        const sessionId = sessionRecord.id;

        if (typeof sessionId !== "string" || !sessionId) {
          quizFailures.push(tx("Buổi học thứ {0} không có ID hợp lệ.", [index + 1]));
          continue;
        }

        setSubmissionStep(
          tx("Đang tạo bài kiểm tra {0}/{1}...", [index + 1, sessionsData.length])
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
                  title: tx("Bài kiểm tra buổi học {0}", [index + 1]),
                  description:
                    tx("Bài kiểm tra được tạo tự động từ nội dung bài học tương ứng."),
                  number_of_questions: 10,
                  time_limit_minutes: 15,
                }),
              }
            );

            await readApiResponse(
              quizResponse,
              tx("Không thể tạo bài kiểm tra cho buổi học thứ {0}.", [index + 1])
            );
            quizCreated = true;
          } catch (error) {
            lastQuizError =
              error instanceof Error
                ? error.message
                : tx("Không thể tạo bài kiểm tra cho buổi học thứ {0}.", [index + 1]);
          }
        }

        if (!quizCreated) {
          quizFailures.push(lastQuizError);
        }
      }

      if (quizFailures.length > 0) {
        throw new Error(
          tx("Chưa tạo được {0}/{1} bài kiểm tra. ", [quizFailures.length, sessionsData.length]) +
            quizFailures[0]
        );
      }

      // 10. Cập nhật danh sách kế hoạch.
      currentStep = tx("Cập nhật dữ liệu");
      setSubmissionStep(tx("Đang cập nhật giao diện..."));

      await loadExamPlans();

      // 11. Tải chủ đề của kế hoạch vừa tạo.
      await handleSelectPlan(planId);

      // 12. Tải lại lịch học.
      await loadStudySessions();

      // 13. Thông báo hoàn tất toàn bộ quy trình.
      setFeedback(
        tx("Đã tạo xong kế hoạch ôn thi! AI đã xử lý tài liệu và tạo {0} buổi học.", [sessionsData.length]),
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
      setPlanMode("chapter");
      void loadOutline(null);

      // Chuyển tới trang kế hoạch chi tiết với lịch từng ngày
      if (playingWhileWaiting.current) setCreatedHref(`/study-plans/${planId}`);
      else router.push(`/study-plans/${planId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : tx("Đã xảy ra lỗi không xác định.");

      setFeedback(
        tx("Không thể hoàn thành bước \"{0}\". {1}", [currentStep, errorMessage]),
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
        return tx("Đã lên lịch");
      case "in_progress":
        return tx("Đang học");
      case "completed":
        return tx("Đã hoàn thành");
      case "missed":
        return tx("Đã bỏ lỡ");
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

    return topic?.name || tx("Chủ đề chưa xác định");
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
          currentLocale(),
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

  // Số liệu cho thẻ "Kế hoạch dự kiến"
  const daysToExam = useMemo(() => {
    if (!today || !examDate || examDate <= today) return null;
    const diff = Date.parse(`${examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
    return Math.round(diff / 86_400_000);
  }, [today, examDate]);

  const estimatedStudyDays = useMemo(() => {
    if (selectedStudyDates.length > 0) return selectedStudyDates.length;
    if (!daysToExam) return 0;
    const perWeek = Number(studyDays) || 0;
    const fullWeeks = Math.floor(daysToExam / 7);
    return fullWeeks * perWeek + Math.min(perWeek, daysToExam % 7);
  }, [selectedStudyDates, daysToExam, studyDays]);

  // Chế độ trọng tâm giữ ~4% số ngày cuối để ôn tổng hợp (khớp với backend)
  const reviewDayCount =
    planMode === "focus" && estimatedStudyDays >= 5
      ? Math.max(1, Math.round(estimatedStudyDays * 0.04))
      : 0;

  const outlineStatus =
    outline.status === "done" ? (
      <span className="flex items-center gap-1 font-semibold text-emerald-700">
        <IconCheck size={15} />

        {tx("AI nhận diện")} {outline.chapters.length}  {tx("chương")}
      </span>
    ) : outline.status === "loading" ? (
      <span className="flex items-center gap-1.5 font-semibold text-[var(--sp-peri-dark)]">
        <Sparkle size={13} className="sp-twinkle text-[var(--sp-pink)]" />

        {tx("AI đang nhận diện chương…")}
      </span>
    ) : outline.status === "error" ? (
      <span className="font-semibold text-[var(--sp-amber-dark)]">

        {tx("Chưa nhận diện trước được chương — AI sẽ chia khi tạo kế hoạch")}
      </span>
    ) : undefined;

  const workflowSteps = [
    {
      number: "01",
      title: tx("Mục tiêu"),
      detail: subjectName.trim() || tx("Nhập môn học và ngày thi"),
      complete: Boolean(subjectName.trim() && examDate),
    },
    {
      number: "02",
      title: tx("Lịch học"),
      detail: isScheduleConfirmed
        ? tx("{0} ngày đã chọn", [selectedStudyDates.length])
        : tx("Chọn ngày học trong tuần"),
      complete: isScheduleConfirmed,
    },
    {
      number: "03",
      title: tx("Tài liệu"),
      detail: selectedFile?.name || tx("Tải tài liệu ôn tập"),
      complete: Boolean(selectedFile),
    },
    {
      number: "04",
      title: tx("Tạo kế hoạch"),
      detail: tx("AI chia chương và tạo bài kiểm tra"),
      complete: false,
    },
  ];

  // Theo trọng tâm: phải chọn ít nhất 1 chương khi AI đã nhận diện được chương
  const modeReady = planMode !== "focus" || outline.status !== "done" || focusChapters.size > 0;
  const allReady = workflowSteps.slice(0, 3).every((step) => step.complete) && modeReady;

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      {(isSubmitting || createdHref) && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-[rgba(36,18,58,0.45)] px-4 py-10 backdrop-blur-[2px]">
          <LoadingPlay
            kicker={tx("AI đang dựng kế hoạch ôn thi cho bạn")}
            title={submissionStep || tx("Đang tạo kế hoạch…")}
            doneTitle={tx("Kế hoạch đã sẵn sàng")}
            stages={PLAN_STAGES}
            stage={planStage(submissionStep)}
            expectedSeconds={90}
            done={Boolean(createdHref)}
            continueLabel={tx("Xem kế hoạch")}
            onPlayingChange={(playing) => {
              playingWhileWaiting.current = playing;
              if (!playing && createdHref) router.push(createdHref);
            }}
            onContinue={() => createdHref && router.push(createdHref)}
          />
        </div>
      )}
      {/* Đầu trang: Pilot hướng dẫn từng bước */}
      <CreatePlanHero
        steps={workflowSteps.map((step) => ({ title: step.title, complete: step.complete }))}
        ready={allReady}
      />

      {/* ===== Biểu mẫu: 4 bước gói trong 2 cột ===== */}
      <form
        id="create-plan"
        ref={formRef}
        onSubmit={handleSubmit}
        className="rounded-[26px] border-2 border-[var(--sp-purple-deep)] bg-white shadow-[6px_6px_0_var(--sp-lav-line)]"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* --- Cột trái: mục tiêu + lịch học --- */}
          <div className="space-y-6 p-5 sm:p-7">
            <div>
              <StepHead number={1} title={tx("Mục tiêu")} done={workflowSteps[0].complete}>
                {daysToExam !== null && daysToExam > 0 && (
                  <span className="rounded-full bg-[var(--sp-pink-bg)] px-2.5 py-0.5 text-xs font-bold text-[var(--sp-pink-dark)]">
                    {tx("còn {0} ngày", [daysToExam])}</span>
                )}
              </StepHead>
              <label htmlFor="subject-name" className="mb-1.5 block text-[13px] font-bold text-[var(--sp-text-2)]">

                {tx("Tên môn học")} <span className="text-[var(--sp-pink)]">*</span>
              </label>
              <input
                id="subject-name"
                type="text"
                required
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder={tx("Ví dụ: Kinh tế vi mô")}
                className="h-[46px] w-full rounded-xl border-2 border-[var(--sp-line)] bg-white px-4 text-sm text-[var(--sp-ink)] outline-none transition placeholder:text-[var(--sp-soft)] focus:border-[var(--sp-peri)]"
              />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="exam-date" className="mb-1.5 block text-[13px] font-bold text-[var(--sp-text-2)]">

                    {tx("Ngày thi")} <span className="text-[var(--sp-pink)]">*</span>
                  </label>
                  <input
                    id="exam-date"
                    type="date"
                    required
                    min={today || undefined}
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="h-[46px] w-full rounded-xl border-2 border-[var(--sp-line)] bg-white px-3 text-sm text-[var(--sp-ink)] outline-none focus:border-[var(--sp-peri)]"
                  />
                </div>
                <div>
                  <label htmlFor="daily-hours" className="mb-1.5 block text-[13px] font-bold text-[var(--sp-text-2)]">

                    {tx("Học mỗi ngày")}
                  </label>
                  <select
                    id="daily-hours"
                    value={dailyHours}
                    onChange={(e) => setDailyHours(e.target.value)}
                    className="h-[46px] w-full rounded-xl border-2 border-[var(--sp-line)] bg-white px-3 text-sm text-[var(--sp-ink)] outline-none focus:border-[var(--sp-peri)]"
                  >
                    {["1", "2", "3", "4", "5", "6"].map((hours) => (
                      <option key={hours} value={hours}>
                        {tx("{0} giờ / ngày", [hours])}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <StepHead number={2} title={tx("Lịch học")} done={workflowSteps[1].complete}>
                <span className="text-[12.5px] font-semibold text-[var(--sp-muted)]">{tx("Bấm số ngày để chọn ngày cụ thể")}</span>
              </StepHead>
              <div className="grid grid-cols-7 gap-1.5">
                {["1", "2", "3", "4", "5", "6", "7"].map((day) => (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={studyDays === day && isScheduleConfirmed}
                    onClick={() => {
                      if (!examDate) {
                        setFeedback(tx("Chọn ngày thi trước rồi mới chọn ngày học nhé."), "error");
                        return;
                      }
                      setStudyDays(day);
                      setSelectedStudyDates([]);
                      setIsScheduleTableExpanded(true);
                      setIsScheduleConfirmed(false);
                      setFeedback("");
                      setIsScheduleDialogOpen(true);
                    }}
                    className={`h-[42px] rounded-xl border-2 text-[13px] font-bold transition ${
                      studyDays === day && (isScheduleConfirmed || isScheduleDialogOpen)
                        ? "border-[var(--sp-purple)] bg-[var(--sp-purple)] text-white shadow-[2px_2px_0_var(--sp-pink)]"
                        : "border-[var(--sp-line)] bg-white text-[var(--sp-muted)] hover:border-[var(--sp-lav-line)]"
                    }`}
                  >
                    {tx("{0} ngày", [day])}</button>
                ))}
              </div>
              {isScheduleConfirmed && (
                <p className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border-2 border-[var(--sp-lav-line)] bg-[var(--sp-lav)] px-3 py-2 text-[13px] font-bold text-[var(--sp-text-2)]">
                  <span className="truncate">
                    {tx("✓ {0} ngày học: {1}{2}", [selectedStudyDates.length, [...selectedStudyDates].sort().slice(0, 4).map(shortStudyDay).join(", "), selectedStudyDates.length > 4 ? "…" : ""])}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsScheduleTableExpanded(true);
                      setIsScheduleDialogOpen(true);
                    }}
                    className="text-[var(--sp-peri-dark)] underline underline-offset-2"
                  >

                    {tx("Sửa")}
                  </button>
                </p>
              )}
            </div>
          </div>

          {/* --- Cột phải: tài liệu + cách chia --- */}
          <div className="space-y-6 border-t-2 border-dashed border-[var(--sp-line)] p-5 sm:p-7 lg:border-l-2 lg:border-t-0">
            <div>
              <StepHead number={3} title={tx("Tài liệu")} done={workflowSteps[2].complete} />
              <MaterialDropzone
                compact
                file={selectedFile}
                inputKey={fileInputKey}
                validate={validateFile}
                status={outlineStatus}
                showTips={false}
                onChange={(file) => {
                  setSelectedFile(file);
                  if (!file) setFileInputKey((current) => current + 1);
                  void loadOutline(file);
                }}
                // Lỗi file đã hiện ngay dưới khu tải lên, chỉ xóa thông báo cũ ở cuối form
                onError={() => setFeedback("")}
              />
            </div>

            <div>
              <StepHead number={4} title={tx("Cách chia kế hoạch")} done={modeReady && workflowSteps[2].complete} />
              <PlanModeCards compact mode={planMode} onChange={setPlanMode} />
              {planMode === "focus" && (
                <div className="mt-3">
                  <FocusChapterChips
                    outline={outline}
                    focus={focusChapters}
                    onToggle={toggleFocusChapter}
                    onRetry={() => void loadOutline(selectedFile)}
                    hasFile={Boolean(selectedFile)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chân thẻ: việc còn thiếu + xem kế hoạch dự kiến */}
        <div className="rounded-b-[24px] border-t-2 border-dashed border-[var(--sp-line)] bg-[#fdfcff] px-5 py-4 sm:px-7">
          {message && (
            <p
              role={feedbackType === "error" ? "alert" : "status"}
              className={`mb-3 rounded-xl border p-3 text-sm leading-6 ${
                feedbackType === "error"
                  ? "border-[var(--sp-pink-line)] bg-[var(--sp-pink-bg)] text-[var(--sp-pink-dark)]"
                  : feedbackType === "success"
                    ? "border-[var(--sp-lav-line)] bg-[var(--sp-lav)] text-[var(--sp-ink)]"
                    : "border-[var(--sp-line)] bg-[var(--sp-surface-2)] text-[var(--sp-text-2)]"
              }`}
            >
              {message}
            </p>
          )}
          <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[minmax(0,1fr)_260px]">
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-bold">
              {[
                { label: tx("Môn học & ngày thi"), done: workflowSteps[0].complete },
                { label: tx("Ngày học"), done: workflowSteps[1].complete },
                { label: tx("Tài liệu"), done: workflowSteps[2].complete },
                { label: tx("Cách chia"), done: modeReady },
              ].map((item) => (
                <li key={item.label} className={`flex items-center gap-1.5 ${item.done ? "text-emerald-700" : "text-[var(--sp-soft)]"}`}>
                  {item.done ? <IconCheck size={14} /> : <span className="h-3 w-3 rounded-full border-2 border-current" />}
                  {item.label}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={!allReady || isSubmitting}
              onClick={() => setIsPreviewOpen(true)}
              className="sp-btn sp-btn-primary h-[46px] w-full justify-center text-[15px] disabled:cursor-not-allowed disabled:border-[#b8b2c8] disabled:bg-[#c9c4d6] disabled:shadow-none"
            >
              <Sparkle size={16} />

              {tx("Xem kế hoạch dự kiến")}
            </button>
          </div>
        </div>
      </form>

      {/* Chọn ngày học cụ thể: hộp nổi */}
      {isScheduleDialogOpen && (
        <div
          className="sp-dialog-veil fixed inset-0 z-50 flex items-center justify-center bg-[rgba(36,18,58,0.45)] p-4 backdrop-blur-[2px]"
          onClick={(event) => event.target === event.currentTarget && setIsScheduleDialogOpen(false)}
        >
          <div className="sp-dialog-pop max-h-[92vh] w-full max-w-[860px] overflow-y-auto rounded-[24px]">
            <StudyDayPicker
              weeks={getStudyWeeks()}
              selectedDates={selectedStudyDates}
              studyDaysPerWeek={Number(studyDays)}
              today={today}
              examDate={examDate}
              confirmed={isScheduleConfirmed}
              expanded
              onToggleDate={updateStudyDate}
              onToggleWeekday={toggleWeekdayForAllWeeks}
              onClear={() => {
                setSelectedStudyDates([]);
                setIsScheduleConfirmed(false);
                setFeedback("");
              }}
              onConfirm={() => {
                const error = validateSelectedStudyDates();
                setFeedback(error || "", error ? "error" : "info");
                if (!error) {
                  setIsScheduleConfirmed(true);
                  setIsScheduleDialogOpen(false);
                }
              }}
              onHeaderAction={() => setIsScheduleDialogOpen(false)}
            />
          </div>
        </div>
      )}

      <PlanPreviewDialog
        open={isPreviewOpen && !isSubmitting}
        onClose={closePreview}
        onConfirm={() => {
          setIsPreviewOpen(false);
          formRef.current?.requestSubmit();
        }}
        submitting={isSubmitting}
        subjectName={subjectName.trim()}
        mode={planMode}
        daysToExam={daysToExam}
        studyDates={selectedStudyDates}
        studyDayCount={estimatedStudyDays}
        reviewDayCount={reviewDayCount}
        dailyHours={Number(dailyHours)}
        outline={outline}
        focus={focusChapters}
      />

      {/* Môn học đang ôn → bấm "Xem chi tiết" để mở lộ trình */}
      <PlanOverviewCards
        plans={examPlans}
        topics={allTopics}
        sessions={studySessions}
        isLoading={isLoadingPlans || isLoadingSessions}
        error={planError || sessionError}
        onRefresh={() => {
          loadExamPlans();
          loadAllTopics();
          loadStudySessions();
        }}
      />
    </div>
  );
}