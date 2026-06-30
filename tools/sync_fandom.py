"""Sincroniza somente o catálogo de páginas da Looksmaxxing Wiki.

O conteúdo integral não é copiado. Mantemos título, id e URL para atribuição e
curadoria posterior, respeitando a licença CC-BY-SA informada pela própria API.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen


API = "https://looksmaxxing.fandom.com/api.php"
USER_AGENT = "LOKXMaxingResearch/0.1 (local research catalog; source attribution)"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "knowledge" / "fandom_pages.json"


def api_request(params: dict[str, str]) -> dict:
    url = f"{API}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def main() -> None:
    site = api_request(
        {
            "action": "query",
            "meta": "siteinfo",
            "siprop": "general|rightsinfo",
            "format": "json",
        }
    )["query"]

    pages: list[dict] = []
    continuation: dict[str, str] = {}
    while True:
        payload = api_request(
            {
                "action": "query",
                "list": "allpages",
                "aplimit": "max",
                "format": "json",
                **continuation,
            }
        )
        for page in payload["query"]["allpages"]:
            title = page["title"]
            pages.append(
                {
                    "page_id": page["pageid"],
                    "title": title,
                    "url": f"https://looksmaxxing.fandom.com/wiki/{quote(title.replace(' ', '_'))}",
                }
            )
        if "continue" not in payload:
            break
        continuation = payload["continue"]

    document = {
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "api": API,
        "site_name": site["general"]["sitename"],
        "language": site["general"]["lang"],
        "license": site["rightsinfo"],
        "page_count": len(pages),
        "pages": pages,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(pages)} páginas catalogadas em {OUTPUT}")


if __name__ == "__main__":
    main()
