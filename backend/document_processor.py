
import os
import re
import shutil
import subprocess
import tempfile

from pypdf import PdfReader
from docx import Document
from pptx import Presentation


def extract_word(file_path: str):
    """
    Trích xuất nội dung từ DOCX hoặc DOC.
    File DOC cũ được chuyển sang DOCX bằng LibreOffice.
    """

    extension = os.path.splitext(file_path)[1].lower()

    if extension == ".doc":
        libreoffice = (
            shutil.which("soffice")
            or shutil.which("libreoffice")
        )

        if not libreoffice:
            raise ValueError(
                "Không thể đọc file DOC cũ. "
                "Vui lòng cài LibreOffice để hỗ trợ chuyển đổi DOC sang DOCX."
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                subprocess.run(
                    [
                        libreoffice,
                        "--headless",
                        "--convert-to",
                        "docx",
                        "--outdir",
                        temp_dir,
                        file_path
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=120
                )
            except subprocess.CalledProcessError as error:
                raise ValueError(
                    "Không thể chuyển đổi file DOC sang DOCX: "
                    f"{error.stderr or str(error)}"
                )

            converted_path = os.path.join(
                temp_dir,
                os.path.splitext(os.path.basename(file_path))[0] + ".docx"
            )

            if not os.path.exists(converted_path):
                raise ValueError(
                    "Không thể chuyển đổi file DOC sang DOCX."
                )

            return _extract_docx_content(converted_path)

    return _extract_docx_content(file_path)


def _extract_docx_content(file_path: str):
    """Trích xuất nội dung đoạn văn và bảng trong DOCX."""

    document = Document(file_path)

    paragraphs = [
        paragraph.text.strip()
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    ]

    for table in document.tables:
        for row in table.rows:
            row_text = " | ".join(
                cell.text.strip()
                for cell in row.cells
            )

            if row_text.strip():
                paragraphs.append(row_text)

    content = "\n".join(paragraphs)

    if content.strip():
        return [{
            "page_number": None,
            "content": content
        }]

    return []


def extract_powerpoint(file_path: str):
    """
    Trích xuất văn bản từ PPTX hoặc PPT.
    PPT cũ sẽ được chuyển sang PPTX bằng LibreOffice.
    Mỗi slide được xem là một trang.
    """

    extension = os.path.splitext(file_path)[1].lower()

    if extension == ".ppt":
        libreoffice = (
            shutil.which("soffice")
            or shutil.which("libreoffice")
        )

        if not libreoffice:
            raise ValueError(
                "Không thể đọc file PPT cũ. "
                "Vui lòng cài LibreOffice để hỗ trợ chuyển đổi PPT sang PPTX."
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                subprocess.run(
                    [
                        libreoffice,
                        "--headless",
                        "--convert-to",
                        "pptx",
                        "--outdir",
                        temp_dir,
                        file_path
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=120
                )
            except subprocess.CalledProcessError as error:
                raise ValueError(
                    "Không thể chuyển đổi file PPT sang PPTX: "
                    f"{error.stderr or str(error)}"
                )

            converted_path = os.path.join(
                temp_dir,
                os.path.splitext(os.path.basename(file_path))[0] + ".pptx"
            )

            if not os.path.exists(converted_path):
                raise ValueError(
                    "Không thể chuyển đổi file PPT sang PPTX."
                )

            return _extract_pptx_content(converted_path)

    return _extract_pptx_content(file_path)


def _extract_pptx_content(file_path: str):
    """Trích xuất nội dung từng slide trong file PPTX."""

    presentation = Presentation(file_path)
    pages = []

    for slide_number, slide in enumerate(
        presentation.slides,
        start=1
    ):
        slide_text = []

        for shape in slide.shapes:
            if shape.has_text_frame:
                content = shape.text.strip()

                if content:
                    slide_text.append(content)

            if shape.has_table:
                for row in shape.table.rows:
                    row_text = " | ".join(
                        cell.text.strip()
                        for cell in row.cells
                    )

                    if row_text.strip():
                        slide_text.append(row_text)

        content = "\n".join(slide_text)

        if content.strip():
            pages.append({
                "page_number": slide_number,
                "content": content
            })

    return pages


def extract_text(file_path: str):
    """
    Trích xuất văn bản từ PDF, DOC, DOCX, PPT và PPTX.
    Trả về danh sách nội dung kèm số trang hoặc số slide.
    """

    extension = os.path.splitext(file_path)[1].lower()
    pages = []

    if extension == ".pdf":
        reader = PdfReader(file_path)

        for page_number, page in enumerate(
            reader.pages,
            start=1
        ):
            content = page.extract_text() or ""

            if content.strip():
                pages.append({
                    "page_number": page_number,
                    "content": content.strip()
                })

    elif extension in [".doc", ".docx"]:
        pages = extract_word(file_path)

    elif extension in [".pptx", ".ppt"]:
        pages = extract_powerpoint(file_path)

    else:
        raise ValueError(
            "Định dạng tài liệu không được hỗ trợ. "
            "Các định dạng hiện hỗ trợ: PDF, DOC, DOCX, PPT, PPTX."
        )

    return pages


def split_into_chunks(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 150
):
    """
    Chia văn bản thành các đoạn nhỏ có phần nội dung chồng lặp.
    """

    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("Tham số chia đoạn không hợp lệ.")

    text = re.sub(r"\s+", " ", text).strip()

    if not text:
        return []

    chunks = []
    start = 0

    while start < len(text):
        end = min(start + chunk_size, len(text))

        if end < len(text):
            boundary = text.rfind(" ", start, end)

            if boundary > start:
                end = boundary

        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end >= len(text):
            break

        start = end - overlap

    return chunks
