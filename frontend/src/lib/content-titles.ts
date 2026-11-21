import { tx } from "@/lib/i18n";
/*
 * Bỏ mọi số đề mục của tài liệu ("1.1.1.", "2.", "I.", "a)", "Chương 2:", "Unit 4 -")
 * ở đầu tiêu đề và ở đầu từng phần sau dấu phân cách (" - ", " – ", ":", ">", "|"),
 * vì ứng dụng đã tự đánh số. Ví dụ: "TECHNOLOGY - 1.1.1. The basic concept"
 * → "TECHNOLOGY - The basic concept".
 */
const OUTLINE_KEYWORD_NUMBER =
  /^\s*(?:chương|chapter|mục|phần|part|section|bài|lesson|unit|module)\s*(\d+(?:\.\d+)*|[ivxlc]+)\.?(?![\p{L}\p{N}_])\s*[:\-–—.]?\s*/iu;
const OUTLINE_PLAIN_NUMBER =
  /^\s*(?:\d+(?:\.\d+)+\.?|\d+[.)]|[ivxlc]+[.)]|[a-zđ][.)])\s*[:\-–—]?\s*/iu;

function stripLeadingOutlineNumber(segment: string): string {
  let text = segment.trim();
  for (let round = 0; round < 3; round += 1) {
    const keyword = text.match(OUTLINE_KEYWORD_NUMBER);
    let next = text;
    if (keyword) {
      if (/^\d/.test(keyword[1]) || /^[IVXLC]+$/.test(keyword[1])) {
        next = text.slice(keyword[0].length);
      }
    } else {
      next = text.replace(OUTLINE_PLAIN_NUMBER, "");
    }
    next = next.trim();
    if (!next || next === text) break;
    text = next;
  }
  return text;
}

export function stripOutlineNumbers(value?: string | null): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const pieces = text.split(/(\s+[-–—>|:]\s+|\s*>\s*|:\s+)/u);
  const kept: string[] = [];
  for (let index = 0; index < pieces.length; index += 2) {
    const raw = pieces[index].trim();
    // Phần chỉ là nhãn đánh số ("Chương 2", "Unit 4", "Part II") thì bỏ hẳn
    const isBareLabel =
      OUTLINE_KEYWORD_NUMBER.test(raw) &&
      raw.replace(OUTLINE_KEYWORD_NUMBER, "").trim() === "";
    const cleaned = isBareLabel ? "" : stripLeadingOutlineNumber(raw);
    if (!cleaned) continue;
    if (kept.length > 0) kept.push(pieces[index - 1] || " - ");
    kept.push(cleaned);
  }
  return (kept.join("") || text)
    .replace(/^\s*[-–—>|:]\s*/u, "")
    .replace(/\s*[-–—>|:]\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getMainTopicTitle(
  value?: string | null
): string {
  if (!value?.trim()) {
    return tx("Chủ đề học tập");
  }

  let title = value
    .trim()
    .replace(
      /^\s*(?:(?:\d{1,2}[/-]){2}\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\s*[-–—:.,]?\s*/u,
      ""
    )
    .replace(
      /^\s*(?:chapter|chương)\s*\d+\s*[:.-]?\s*/i,
      ""
    )
    .replace(
      /^\s*\d+(?:\.\d+)+\.?\s*/,
      ""
    );

  const contentMarker = title.search(
    /\b(?:content|nội dung)\b\s*/i
  );

  if (contentMarker > 0) {
    title = title.slice(0, contentMarker);
  }

  return stripOutlineNumbers(title)
    .replace(/[.;:,|]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim() || tx("Chủ đề học tập");
}

export function getPreferredContentTitle(
  primary?: string | null,
  fallback?: string | null
): string {
  const cleanedPrimary = getMainTopicTitle(primary);
  const isGeneric = /^(?:nội dung(?: học tập| bài học)?|chủ đề học tập|tài liệu)$/i
    .test(cleanedPrimary);

  if (isGeneric && fallback?.trim()) {
    const cleanedFallback = getMainTopicTitle(fallback);

    if (!/^(?:nội dung|chủ đề học tập|tài liệu)$/i.test(cleanedFallback)) {
      return cleanedFallback;
    }
  }

  return cleanedPrimary;
}

export function getContentKeyPoints(
  heading?: string | null,
  points?: string[]
): string[] {
  const normalizedHeading = getMainTopicTitle(heading)
    .toLocaleLowerCase()
    .trim();
  const headingPrefix = normalizedHeading
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");

  return (points || [])
    .map((point) => point.trim())
    .filter(Boolean)
    .filter((point) => {
      const normalizedPoint = getMainTopicTitle(point)
        .toLocaleLowerCase()
        .trim();
      const pointPrefix = normalizedPoint
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .join(" ");

      if (normalizedPoint === normalizedHeading) {
        return false;
      }

      if (
        headingPrefix &&
        pointPrefix === headingPrefix &&
        normalizedPoint.length <= normalizedHeading.length + 80
      ) {
        return false;
      }

      return !/^(?:chapter|chương|unit|học kỳ)\b/i.test(
        normalizedPoint
      );
    })
    .slice(0, 5);
}

export function getLearningContentBullets(
  heading?: string | null,
  content?: string | null
): string[] {
  const normalizedHeading = getMainTopicTitle(heading)
    .toLocaleLowerCase()
    .trim();

  return (content || "")
    .split(/\r?\n/)
    .map((item) =>
      item
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "")
        .trim()
    )
    .filter(Boolean)
    .filter((item) => {
      const normalizedItem = getMainTopicTitle(item)
        .toLocaleLowerCase()
        .trim();

      if (normalizedItem === normalizedHeading) {
        return false;
      }

      if (
        /^(?:chapter|chương|unit|lesson|module|part|bài)\b/i.test(
          item
        )
      ) {
        return false;
      }

      if (/^(?:tip|note|lưu ý|chú thích|nội dung)\s*:/i.test(item)) {
        return false;
      }

      return !/^\d+(?:\.\d+)+\.?\s+\S/.test(item);
    });
}
