#!/usr/bin/env python3
"""Fetch YouTube channel RSS feeds and merge them into data/feed.json.
No API key required. Add youtubeChannelId values in data/painters.json.
"""
from __future__ import annotations
import json, re, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAINTERS = ROOT / "data" / "painters.json"
FEED = ROOT / "data" / "feed.json"
MAX_PER_PAINTER = 12

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}

def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "DVL-Painter-Feed/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()

def clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()

def main():
    painters = json.loads(PAINTERS.read_text(encoding="utf-8"))
    existing = json.loads(FEED.read_text(encoding="utf-8")) if FEED.exists() else []
    manual = [x for x in existing if not str(x.get("id", "")).startswith("yt:")]
    youtube_items = []

    for p in painters:
        cid = clean(p.get("youtubeChannelId", ""))
        if not cid:
            continue
        url = f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
        try:
            root = ET.fromstring(fetch(url))
        except Exception as exc:
            print(f"WARN {p['name']}: {exc}")
            continue
        for entry in root.findall("atom:entry", NS)[:MAX_PER_PAINTER]:
            video_id = entry.findtext("yt:videoId", default="", namespaces=NS)
            title = clean(entry.findtext("atom:title", default="", namespaces=NS))
            published = entry.findtext("atom:published", default="", namespaces=NS)
            link = entry.find("atom:link", NS)
            href = link.attrib.get("href") if link is not None else f"https://www.youtube.com/watch?v={video_id}"
            media_group = entry.find("media:group", NS)
            desc = ""
            thumb = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
            if media_group is not None:
                desc = clean(media_group.findtext("media:description", default="", namespaces=NS))
                mt = media_group.find("media:thumbnail", NS)
                if mt is not None and mt.attrib.get("url"):
                    thumb = mt.attrib["url"]
            youtube_items.append({
                "id": f"yt:{video_id}",
                "painterId": p["id"],
                "source": "YouTube",
                "title": title,
                "description": desc[:320],
                "url": href,
                "thumbnail": thumb,
                "publishedAt": published,
                "tags": p.get("specialties", [])[:3],
            })

    merged = manual + youtube_items
    def ts(item):
        try:
            return datetime.fromisoformat(item.get("publishedAt", "").replace("Z", "+00:00"))
        except Exception:
            return datetime(1970,1,1,tzinfo=timezone.utc)
    merged.sort(key=ts, reverse=True)
    FEED.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Updated {FEED}: {len(youtube_items)} YouTube + {len(manual)} manual items")

if __name__ == "__main__":
    main()
