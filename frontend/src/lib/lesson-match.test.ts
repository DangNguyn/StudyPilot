// Chạy: node src/lib/lesson-match.test.ts
import assert from "node:assert/strict";
import { matchLesson, type LessonSection } from "./lesson-match.ts";

// Rút gọn từ bài "Life cycle of technology" thật
const sections: LessonSection[] = [
  {
    heading: "1.1.2. Characteristics of technology - iv. Life cycle of technology",
    content:
      "Doanh nghiệp sử dụng công nghệ phải hiểu vòng đời công nghệ (technology life cycle) của nó.\nHiểu vòng đời công nghệ giúp doanh nghiệp tiến hành sản xuất, kinh doanh, hoặc dự báo và lựa chọn các công nghệ thay thế cho tương lai.",
    key_points: ["Doanh nghiệp phải hiểu vòng đời công nghệ để sản xuất, kinh doanh, dự báo và chọn công nghệ thay thế."],
    subsections: [
      {
        heading: "Vòng đời theo tiến bộ công nghệ (according to technological advancements)",
        content:
          "Giai đoạn sơ khai (embryonic stage) có đặc trưng là sự phát triển chậm.\nGiai đoạn bão hòa (saturation stage) cho thấy công nghệ đã đạt đến điểm cần được thay thế.",
        table: { headers: ["Giai đoạn", "Đặc điểm"], rows: [["Embryonic stage (sơ khai)", "Phát triển chậm"], ["Saturation stage (bão hòa)", "Công nghệ đạt đến điểm cần được thay thế"]] },
      },
      {
        heading: "Vòng đời theo vòng đời sản phẩm (according to the product life cycle)",
        content: "Giai đoạn A thể hiện quá trình hình thành sản phẩm.\nGiai đoạn F thể hiện giai đoạn sản phẩm đã đạt đến bão hòa và cần được thay thế.",
      },
    ],
  },
  {
    heading: "1.2.1 Definitions (Management of Technology - MOT)",
    content:
      "Management of Technology (MOT) là khái niệm khó định nghĩa vì đây là lĩnh vực liên quan đến nhiều ngành.\nCác ngành liên quan gồm: sociology, economics, psychology, mathematics, political science, statistics, management, systems theory và anthropology.\nNăm 1987, một cuộc khảo sát 1.500 CEO của các công ty lớn tại Hoa Kỳ cho thấy MOT không đầy đủ là nguyên nhân chính.",
  },
];

const q1 = matchLesson(sections, "Trong vòng đời công nghệ, giai đoạn được mô tả là sự phát triển chậm được gọi là gì? Giai đoạn Embryonic");
assert.equal(q1?.label, "1.1");
assert.ok(q1?.hits.has("c:0"), "tô câu embryonic phát triển chậm");
assert.ok(q1?.hits.has("r:0"), "tô dòng bảng embryonic");
assert.ok(!q1?.hits.has("r:1"));

const q7 = matchLesson(sections, "Trong các ngành học được đề cập trong MOT, lĩnh vực nào không nằm trong danh sách? Astronomy");
assert.equal(q7?.label, "2");
assert.ok(q7?.hits.has("c:1"), "tô dòng danh sách ngành");

const stageA = matchLesson(sections, "Giai đoạn A trong vòng đời sản phẩm thể hiện điều gì? Quá trình hình thành sản phẩm");
assert.equal(stageA?.label, "1.2");

assert.equal(matchLesson([], "x"), null);
console.log("lesson-match: ok");
