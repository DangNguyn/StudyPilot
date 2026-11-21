/**
 * StudyPilot – gửi thư nhắc học qua Gmail của bạn (Google Apps Script).
 * Dán toàn bộ file này vào script.google.com, đổi SECRET, rồi Triển khai → Ứng dụng web.
 * SECRET phải giống APPS_SCRIPT_SECRET trong backend/.env.
 */
const SECRET = "DOI_THANH_CHUOI_BI_MAT_CUA_BAN";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return reply({ ok: false, error: "unauthorized" });
    MailApp.sendEmail({
      to: data.to,
      subject: data.subject,
      body: data.text || "",
      htmlBody: data.html || "",
      name: "StudyPilot",
    });
    return reply({ ok: true, remaining: MailApp.getRemainingDailyQuota() });
  } catch (error) {
    return reply({ ok: false, error: String(error) });
  }
}

// Chạy hàm này 1 lần trong trình soạn thảo để cấp quyền gửi thư và gửi thử cho chính bạn
function guiThu() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), "StudyPilot – thư thử", "Apps Script đã gửi được thư!");
}

function reply(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
