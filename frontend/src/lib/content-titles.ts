export function getMainTopicTitle(
  value?: string | null
): string {
  if (!value?.trim()) {
    return "Chủ đề học tập";
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

  return title
    .replace(/[.;:,|]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "Chủ đề học tập";
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
