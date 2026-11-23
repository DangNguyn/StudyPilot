// Tìm mục tóm tắt khớp nhất với một câu hỏi (popup "Mở bài học" ở trang kết quả).
// So chữ, không gọi AI: dữ liệu chưa ghi mục tóm tắt nào ứng với trang nào.

export type LessonSection = {
  heading?: string;
  content?: string;
  key_points?: string[];
  table?: { headers?: string[]; rows?: string[][] } | null;
  subsections?: LessonSection[];
};

export type LessonMatch = {
  section: LessonSection;
  /* mục cha khi khớp vào mục con */
  parent: LessonSection | null;
  /* số thứ tự hiển thị: 1, 2… hoặc 1.2 */
  label: string;
  /* các dòng nên tô (khoá: "c:<i>" dòng nội dung, "k:<i>" ghi nhớ, "r:<i>" dòng bảng) */
  hits: Set<string>;
};

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2);

// Từ đơn và cặp từ liền nhau: tiếng Việt một âm tiết ít nghĩa, cặp từ ("phat trien", "vong doi") mới đặc trưng
function terms(text: string) {
  const list = words(text);
  const out = new Set<string>();
  list.forEach((word, index) => {
    if (word.length >= 4) out.add(word);
    if (index > 0) out.add(`${list[index - 1]} ${word}`);
  });
  return out;
}

const score = (query: Set<string>, text: string) => {
  let total = 0;
  for (const term of terms(text)) if (query.has(term)) total += term.includes(" ") ? 2 : 1;
  return total;
};

const ownText = (section: LessonSection) =>
  [section.heading, section.content, ...(section.key_points || []), ...(section.table?.rows || []).map((row) => row.join(" "))]
    .filter(Boolean)
    .join("\n");

export function matchLesson(sections: LessonSection[], queryText: string): LessonMatch | null {
  const query = terms(queryText);
  let best: (LessonMatch & { score: number }) | null = null;
  sections.forEach((section, index) => {
    const units: [LessonSection, LessonSection | null, string][] = [[section, null, String(index + 1)]];
    (section.subsections || []).forEach((sub, subIndex) => units.push([sub, section, `${index + 1}.${subIndex + 1}`]));
    for (const [unit, parent, label] of units) {
      const value = score(query, ownText(unit));
      if (!best || value > best.score) best = { section: unit, parent, label, hits: new Set(), score: value };
    }
  });
  if (!best) return null;
  const found: LessonMatch & { score: number } = best;
  const lines: [string, string][] = [
    ...(found.section.content || "").split("\n").map((line, index) => [`c:${index}`, line] as [string, string]),
    ...(found.section.key_points || []).map((line, index) => [`k:${index}`, line] as [string, string]),
    ...(found.section.table?.rows || []).map((row, index) => [`r:${index}`, row.join(" ")] as [string, string]),
  ];
  // Chỉ tô dòng khớp rõ: ít nhất một cặp từ và gần bằng dòng khớp nhất cùng loại (bảng ngắn hơn câu)
  const scored = lines.map(([key, line]) => [key, score(query, line)] as const);
  for (const kind of ["c", "k", "r"]) {
    const group = scored.filter(([key]) => key[0] === kind);
    const top = Math.max(0, ...group.map(([, value]) => value));
    for (const [key, value] of group) if (value >= 3 && value >= top * 0.7) found.hits.add(key);
  }
  return { section: found.section, parent: found.parent, label: found.label, hits: found.hits };
}
