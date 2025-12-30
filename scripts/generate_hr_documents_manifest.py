import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOC_DIR = os.path.join(ROOT, "hr-documents")
OUT_FILE = os.path.join(DOC_DIR, "documents.json")

ALLOWED_EXT = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt"}
EXCLUDE = {"index.html", "documents.json"}


def human_kb(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes} B"
    kb = num_bytes / 1024
    if kb < 1024:
        return f"{kb:.1f} KB"
    mb = kb / 1024
    return f"{mb:.1f} MB"


def title_from_filename(filename: str) -> str:
    base = os.path.splitext(os.path.basename(filename))[0]
    # Replace underscores/dashes with spaces and normalize whitespace
    base = base.replace("_", " ").replace("-", " ")
    base = " ".join(base.split())
    return base


def main():
    docs = []
    for root, dirs, files in os.walk(DOC_DIR):
        # Skip hidden folders
        dirs[:] = [d for d in dirs if not d.startswith('.')]

        for name in files:
            if name.startswith('.'):
                continue
            if root == DOC_DIR and name in EXCLUDE:
                continue

            path = os.path.join(root, name)
            if not os.path.isfile(path):
                continue

            ext = os.path.splitext(name)[1].lower()
            if ext not in ALLOWED_EXT:
                continue

            rel_path = os.path.relpath(path, DOC_DIR).replace(os.sep, "/")
            size = os.path.getsize(path)
            docs.append(
                {
                    "title": title_from_filename(name),
                    "file": rel_path,
                    "ext": ext.lstrip("."),
                    "size": size,
                    "sizeHuman": human_kb(size),
                }
            )

    docs.sort(key=lambda d: d["title"].lower())

    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "documents": docs,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
