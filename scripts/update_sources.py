#!/usr/bin/env python3
"""DVL Painter Feed multi-source collector.

Sources:
- YouTube channel RSS (official, no API key)
- Website RSS/Atom when explicitly configured or discoverable from the painter's own site
- ArtStation public portfolio pages (public metadata only)

The script stores only public metadata + thumbnail URL + outbound link. It does not mirror paid content.
"""
from __future__ import annotations

import html as htmlmod
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAINTERS = ROOT / "data" / "painters.json"
FEED = ROOT / "data" / "feed.json"
MAX_PER_SOURCE = 12
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"
NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "yt": "http://www.youtube.com/xml/schemas/2015",
    "media": "http://search.yahoo.com/mrss/",
}

TAG_RULES = {
    "NMM": ["nmm", "non metallic", "non-metallic", "nonmetallic"],
    "Face": ["face", "faces", "facial", "portrait", "head"],
    "Skin": ["skin", "flesh", "skintone", "skin tone"],
    "OSL": ["osl", "object source light", "glow", "lighting effect"],
    "Space Marine": ["space marine", "spacemarine", "primaris", "astartes", "warhammer 40k"],
    "Ork": [" ork ", "orks", "orc", "orcs", "greenskin"],
    "Gold": ["gold", "golden", "brass"],
    "Steel": ["steel", "silver", "metal", "metallic"],
    "Armour": ["armor", "armour", "power armor", "power armour"],
    "Weathering": ["weathering", "battle damage", "chipping", "rust", "streaking"],
    "Airbrush": ["airbrush", "airbrushing"],
    "Glazing": ["glaze", "glazing"],
    "Layering": ["layering", "blending", "blend"],
    "Color Theory": ["color theory", "colour theory", "color wheel", "colour wheel"],
    "Tutorial": ["tutorial", "how to", "guide", "step by step", "painting process", "paint along", "masterclass"],
    "Review": ["review", "unboxing", "first look"],
    "Diorama": ["diorama", "vignette", "scenic base", "base building"],
    "Display": ["display", "competition", "golden demon", "box art", "boxart"],
}


def clean(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", htmlmod.unescape(text)).strip()


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def iso_date(value: str) -> str:
    value = clean(value)
    if not value:
        return ""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        pass
    try:
        dt = parsedate_to_datetime(value)
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return ""


def auto_tags(title: str, desc: str, specialties: list[str]) -> list[str]:
    text = f" {title} {desc} ".lower()
    found = []
    for tag, keys in TAG_RULES.items():
        if any(k in text for k in keys):
            found.append(tag)
    for tag in specialties:
        if tag not in found:
            found.append(tag)
    return found[:8]


def resolve_channel_id(youtube_url: str) -> str:
    if not youtube_url:
        return ""
    m = re.search(r"youtube\.com/channel/(UC[\w-]{20,})", youtube_url)
    if m:
        return m.group(1)
    try:
        page = fetch(youtube_url).decode("utf-8", errors="ignore")
    except Exception as exc:
        print(f"WARN resolve YouTube {youtube_url}: {exc}")
        return ""
    for pattern in [
        r'"channelId":"(UC[\w-]{20,})"', r'"externalId":"(UC[\w-]{20,})"',
        r'<meta itemprop="channelId" content="(UC[\w-]{20,})"', r'youtube\.com/channel/(UC[\w-]{20,})'
    ]:
        m = re.search(pattern, page)
        if m:
            return m.group(1)
    return ""


def youtube_items(p: dict) -> list[dict]:
    cid = clean(p.get("youtubeChannelId", "")) or resolve_channel_id(clean(p.get("youtube", "")))
    if not cid:
        return []
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
    try:
        root = ET.fromstring(fetch(url))
    except Exception as exc:
        print(f"WARN YouTube {p['name']}: {exc}")
        return []
    out = []
    for entry in root.findall("atom:entry", NS)[:MAX_PER_SOURCE]:
        video_id = entry.findtext("yt:videoId", default="", namespaces=NS)
        title = clean(entry.findtext("atom:title", default="", namespaces=NS))
        published = iso_date(entry.findtext("atom:published", default="", namespaces=NS))
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
        out.append({
            "id": f"yt:{video_id}", "painterId": p["id"], "source": "YouTube",
            "title": title, "description": desc[:360], "url": href, "thumbnail": thumb,
            "publishedAt": published, "tags": auto_tags(title, desc, p.get("specialties", [])),
        })
    return out


def discover_rss(home_url: str) -> list[str]:
    """Find same-site RSS/Atom links. Also try conservative conventional feed URLs."""
    if not home_url:
        return []
    candidates = []
    try:
        page = fetch(home_url).decode("utf-8", errors="ignore")
        for tag in re.findall(r"<link\b[^>]*>", page, flags=re.I):
            if not re.search(r'rel=["\'][^"\']*alternate', tag, flags=re.I):
                continue
            if not re.search(r'(application/(rss|atom)\+xml|text/xml)', tag, flags=re.I):
                continue
            m = re.search(r'href=["\']([^"\']+)', tag, flags=re.I)
            if m:
                candidates.append(urllib.parse.urljoin(home_url, htmlmod.unescape(m.group(1))))
    except Exception as exc:
        print(f"WARN RSS discovery {home_url}: {exc}")
    base = urllib.parse.urlsplit(home_url)
    root = f"{base.scheme}://{base.netloc}/"
    candidates += [urllib.parse.urljoin(root, "feed/"), urllib.parse.urljoin(root, "feed.xml"), urllib.parse.urljoin(root, "rss.xml")]
    # dedupe while keeping order; remain on the painter site's host only
    seen, out = set(), []
    for u in candidates:
        if urllib.parse.urlsplit(u).netloc != base.netloc or u in seen:
            continue
        seen.add(u); out.append(u)
    return out[:6]


def first_text(elem, names: list[str]) -> str:
    for name in names:
        v = elem.findtext(name)
        if v:
            return v
    return ""


def parse_rss_bytes(raw: bytes, feed_url: str, p: dict) -> list[dict]:
    try:
        root = ET.fromstring(raw)
    except Exception:
        return []
    items = []
    # RSS 2.x
    rss_nodes = root.findall("./channel/item")
    for node in rss_nodes[:MAX_PER_SOURCE]:
        title = clean(first_text(node, ["title"]))
        href = clean(first_text(node, ["link", "guid"]))
        desc = clean(first_text(node, ["description", "{http://purl.org/rss/1.0/modules/content/}encoded"]))
        published = iso_date(first_text(node, ["pubDate", "{http://purl.org/dc/elements/1.1/}date"]))
        thumb = ""
        media = node.find("{http://search.yahoo.com/mrss/}content") or node.find("{http://search.yahoo.com/mrss/}thumbnail")
        if media is not None:
            thumb = media.attrib.get("url", "")
        if not thumb:
            m = re.search(r'<img[^>]+src=["\']([^"\']+)', first_text(node, ["description", "{http://purl.org/rss/1.0/modules/content/}encoded"]), flags=re.I)
            if m: thumb = htmlmod.unescape(m.group(1))
        if title and href and published:
            stable = re.sub(r"\W+", "-", href).strip("-")[-90:]
            items.append({"id": f"web:{p['id']}:{stable}", "painterId": p["id"], "source": "Website",
                          "title": title, "description": desc[:360], "url": href, "thumbnail": thumb,
                          "publishedAt": published, "tags": auto_tags(title, desc, p.get("specialties", []))})
    if items:
        return items
    # Atom
    atom_entries = root.findall("{http://www.w3.org/2005/Atom}entry")
    for node in atom_entries[:MAX_PER_SOURCE]:
        title = clean(node.findtext("{http://www.w3.org/2005/Atom}title", default=""))
        href = ""
        for ln in node.findall("{http://www.w3.org/2005/Atom}link"):
            if ln.attrib.get("rel", "alternate") in ("", "alternate") and ln.attrib.get("href"):
                href = ln.attrib["href"]; break
        desc = clean(node.findtext("{http://www.w3.org/2005/Atom}summary", default="") or node.findtext("{http://www.w3.org/2005/Atom}content", default=""))
        published = iso_date(node.findtext("{http://www.w3.org/2005/Atom}published", default="") or node.findtext("{http://www.w3.org/2005/Atom}updated", default=""))
        if title and href and published:
            stable = re.sub(r"\W+", "-", href).strip("-")[-90:]
            items.append({"id": f"web:{p['id']}:{stable}", "painterId": p["id"], "source": "Website",
                          "title": title, "description": desc[:360], "url": href, "thumbnail": "",
                          "publishedAt": published, "tags": auto_tags(title, desc, p.get("specialties", []))})
    return items


def website_items(p: dict) -> list[dict]:
    cfg = p.get("sources", {}) or {}
    explicit = cfg.get("websiteRss", "")
    candidates = [explicit] if explicit else []
    if cfg.get("websiteRssAuto"):
        candidates += discover_rss(p.get("website", ""))
    seen = set()
    for url in candidates:
        if not url or url in seen: continue
        seen.add(url)
        try:
            items = parse_rss_bytes(fetch(url), url, p)
            if items:
                print(f"RSS {p['name']}: {url} -> {len(items)}")
                return items
        except Exception as exc:
            print(f"WARN RSS {p['name']} {url}: {exc}")
    return []


def meta_value(page: str, key: str) -> str:
    patterns = [
        rf'<meta[^>]+(?:property|name)=["\']{re.escape(key)}["\'][^>]+content=["\']([^"\']+)',
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(key)}["\']',
    ]
    for pat in patterns:
        m = re.search(pat, page, flags=re.I)
        if m: return htmlmod.unescape(m.group(1)).strip()
    return ""


def artstation_items(p: dict) -> list[dict]:
    profile = (p.get("sources", {}) or {}).get("artstation", "")
    if not profile:
        return []
    try:
        page = fetch(profile).decode("utf-8", errors="ignore")
    except Exception as exc:
        print(f"WARN ArtStation profile {p['name']}: {exc}")
        return []
    links = []
    # ArtStation renders project hrefs in public HTML; both host forms appear.
    for m in re.finditer(r'href=["\'](https?://(?:www\.)?artstation\.com/artwork/[A-Za-z0-9_-]+|/artwork/[A-Za-z0-9_-]+)["\']', page, flags=re.I):
        u = urllib.parse.urljoin("https://www.artstation.com", htmlmod.unescape(m.group(1)))
        if u not in links: links.append(u)
        if len(links) >= MAX_PER_SOURCE: break
    out = []
    for url in links:
        try:
            detail = fetch(url).decode("utf-8", errors="ignore")
        except Exception as exc:
            print(f"WARN ArtStation item {url}: {exc}"); continue
        title = clean(meta_value(detail, "og:title"))
        desc = clean(meta_value(detail, "og:description"))
        thumb = meta_value(detail, "og:image")
        published = ""
        for pat in [r'"published_at"\s*:\s*"([^"]+)"', r'"datePublished"\s*:\s*"([^"]+)"', r'<meta[^>]+property=["\']article:published_time["\'][^>]+content=["\']([^"\']+)']:
            m = re.search(pat, detail, flags=re.I)
            if m:
                published = iso_date(m.group(1)); break
        # Do not invent recency. Projects without a machine-readable publication date are skipped.
        if not (title and published):
            continue
        slug = url.rstrip("/").split("/")[-1]
        out.append({"id": f"art:{slug}", "painterId": p["id"], "source": "ArtStation",
                    "title": title, "description": desc[:360], "url": url, "thumbnail": thumb,
                    "publishedAt": published, "tags": auto_tags(title, desc, p.get("specialties", []))})
    return out


def parse_ts(item: dict) -> datetime:
    try:
        return datetime.fromisoformat(item.get("publishedAt", "").replace("Z", "+00:00"))
    except Exception:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def main():
    painters = json.loads(PAINTERS.read_text(encoding="utf-8"))
    existing = json.loads(FEED.read_text(encoding="utf-8")) if FEED.exists() else []
    generated_prefixes = ("yt:", "web:", "art:")
    manual = [x for x in existing if not str(x.get("id", "")).startswith(generated_prefixes)]
    generated = []
    for p in painters:
        ys = youtube_items(p); ws = website_items(p); ars = artstation_items(p)
        generated += ys + ws + ars
        print(f"{p['name']}: YouTube {len(ys)}, Website {len(ws)}, ArtStation {len(ars)}")
    # Deduplicate by id; later item wins, then sort newest first.
    by_id = {x.get("id"): x for x in manual + generated if x.get("id")}
    merged = list(by_id.values())
    merged.sort(key=parse_ts, reverse=True)
    FEED.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    counts = {}
    for x in merged: counts[x.get("source", "Other")] = counts.get(x.get("source", "Other"), 0) + 1
    print(f"Updated {FEED}: {len(merged)} items {counts}")


if __name__ == "__main__":
    main()
