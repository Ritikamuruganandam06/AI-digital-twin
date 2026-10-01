
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

_FRONTMATTER_DELIMITER = "---"
_REQUIRED_FRONTMATTER_FIELDS = ("title", "related_service", "updated")


class DocumentParseError(Exception):
    """Raised when a knowledge/*.md file's frontmatter is missing or malformed."""


@dataclass(frozen=True)
class LoadedDocument:
    document_id: str
    source_path: str
    document_type: str
    related_service: str
    title: str
    updated: str
    body: str


def _parse_frontmatter(raw: str, path: Path) -> tuple[dict[str, str], str]:
    lines = raw.splitlines()
    if not lines or lines[0].strip() != _FRONTMATTER_DELIMITER:
        raise DocumentParseError(f"{path}: missing opening '---' frontmatter delimiter")
    try:
        closing_index = next(
            i for i, line in enumerate(lines[1:], start=1) if line.strip() == _FRONTMATTER_DELIMITER
        )
    except StopIteration as exc:
        raise DocumentParseError(f"{path}: missing closing '---' frontmatter delimiter") from exc

    fields: dict[str, str] = {}
    for line in lines[1:closing_index]:
        if not line.strip():
            continue
        if ":" not in line:
            raise DocumentParseError(f"{path}: malformed frontmatter line: {line!r}")
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip().strip('"')

    body = "\n".join(lines[closing_index + 1 :]).strip()
    return fields, body


def load_document(path: Path, knowledge_root: Path) -> LoadedDocument:
    """Parses one document. Raises DocumentParseError with the offending path if frontmatter is missing/malformed/incomplete."""
    raw = path.read_text(encoding="utf-8")
    fields, body = _parse_frontmatter(raw, path)

    missing = [f for f in _REQUIRED_FRONTMATTER_FIELDS if f not in fields]
    if missing:
        raise DocumentParseError(f"{path}: missing required frontmatter field(s): {missing}")

    relative = path.relative_to(knowledge_root)
    document_type = relative.parts[0]
    document_id = str(relative.with_suffix("")).replace("\\", "/")

    return LoadedDocument(
        document_id=document_id,
        source_path=str(relative).replace("\\", "/"),
        document_type=document_type,
        related_service=fields["related_service"],
        title=fields["title"],
        updated=fields["updated"],
        body=body,
    )


def load_all_documents(knowledge_root: Path) -> list[LoadedDocument]:
    """
    Walks `knowledge_root` for every `*.md` file at least one folder deep
    and parses each one. `knowledge/README.md` itself (directly in
    `knowledge_root`, documenting the folder rather than being a
    knowledge document) is deliberately skipped.
    """
    documents: list[LoadedDocument] = []
    for path in sorted(knowledge_root.rglob("*.md")):
        if path.parent == knowledge_root:
            continue
        documents.append(load_document(path, knowledge_root))
    return documents
