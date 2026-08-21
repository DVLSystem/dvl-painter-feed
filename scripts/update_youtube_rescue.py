#!/usr/bin/env python3
from __future__ import annotations

import html as htmlmod
import json
import re
import sys
import time
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAINTERS = ROOT / 'data' / 'painters.json'
FEED = ROOT / 'data' / 'feed.json'
META = ROOT / 'data' / 'meta.json'
MAX_PER_SOURCE = 12
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36'
NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'yt': 'http://www.youtube.com/xml/schemas/2015',
    'media': 'http://search.yahoo.com/mrss/',
}

TAG_RULES = {
    'NMM': ['nmm', 'non metallic', 'non-metallic', 'nonmetallic'],
    'Face': ['face', 'faces', 'facial', 'portrait', 'head'],
    'Skin': ['skin', 'flesh', 'skintone', 'skin tone'],
    'OSL': ['osl', 'object source light', 'glow', 'lighting effect'],
    'Space Marine': ['space marine', 'spacemarine', 'primaris', 'astartes', 'warhammer 40k'],
    'Ork': [' ork ', 'orks', 'orc', 'orcs', 'greenskin'],
    'Gold': ['gold', 'golden', 'brass'],
    'Steel': ['steel', 'silver', 'metal', 'metallic'],
    'Armour': ['armor', 'armour', 'power armor', 'power armour'],
    'Weathering': ['weathering', 'battle damage', 'chipping', 'rust', 'streaking'],
    'Airbrush': ['airbrush', 'airbrushing'],
    'Glazing': ['glaze', 'glazing'],
    'Layering': ['layering', 'blending', 'blend'],
    'Color Theory': ['color theory', 'colour theory', 'color wheel', 'colour wheel'],
    'Tutorial': ['tutorial', 'how to', 'guide', 'step by step', 'painting process', 'paint along', 'masterclass'],
    'Review': ['review', 'unboxing', 'first look'],
    'Diorama': ['diorama', 'vignette', 'scenic base', 'base building'],
    'Display': ['display', 'competition', 'golden demon', 'box art', 'boxart'],
}


def clean(text: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', text or '')
    return re.sub(r'\s+', ' ', htmlmod.unescape(text)).strip()


def auto_tags(title: str, desc: str, specialties: list[str]) -> list[str]:
    hay = f' {title} {desc} '.lower()
    found: list[str] = []
    for tag, words in TAG_RULES.items():
        if any(w in hay for w in words):
            found.append(tag)
    for tag in specialties or []:
        if tag not in found:
            found.append(tag)
    return found[:8]


def iso_date(value: str) -> str:
    value = (value or '').strip()
    if not value:
        return ''
    try:
        dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
    except Exception:
        return value


def fetch(url: str, retries: int = 3) -> bytes:
    last: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': UA,
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            })
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except Exception as exc:
            last = exc
            if i + 1 < retries:
                time.sleep(2 * (i + 1))
    raise last or RuntimeError('fetch failed')


def resolve_channel_id(youtube_url: str) -> str:
    if not youtube_url:
        return ''
    m = re.search(r'youtube\.com/channel/(UC[\w-]{20,})', youtube_url)
    if m:
        return m.group(1)
    try:
        page = fetch(youtube_url, retries=2).decode('utf-8', errors='ignore')
    except Exception as exc:
        print(f'WARN resolve YouTube {youtube_url}: {exc}')
        return ''

    # Owner-specific fields first. Generic channelId may refer to recommendations.
    patterns = [
        r'"externalId":"(UC[\w-]{20,})"',
        r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']https://www\.youtube\.com/channel/(UC[\w-]{20,})',
        r'<meta[^>]+itemprop=["\']channelId["\'][^>]+content=["\'](UC[\w-]{20,})',
        r'"browseId":"(UC[\w-]{20,})"',
    ]
    for pattern in patterns:
        m = re.search(pattern, page, flags=re.I)
        if m:
            return m.group(1)
    return ''


def parse_feed(p: dict, cid: str) -> list[dict]:
    url = f'https://www.youtube.com/feeds/videos.xml?channel_id={cid}'
    root = ET.fromstring(fetch(url, retries=3))
    out = []
    for entry in root.findall('atom:entry', NS)[:MAX_PER_SOURCE]:
        video_id = entry.findtext('yt:videoId', default='', namespaces=NS)
        title = clean(entry.findtext('atom:title', default='', namespaces=NS))
        published = iso_date(entry.findtext('atom:published', default='', namespaces=NS))
        link = entry.find('atom:link', NS)
        href = link.attrib.get('href') if link is not None else f'https://www.youtube.com/watch?v={video_id}'
        media_group = entry.find('media:group', NS)
        desc = ''
        thumb = f'https://i.ytimg.com/vi/{video_id}/hqdefault.jpg'
        if media_group is not None:
            desc = clean(media_group.findtext('media:description', default='', namespaces=NS))
            mt = media_group.find('media:thumbnail', NS)
            if mt is not None and mt.attrib.get('url'):
                thumb = mt.attrib['url']
        if video_id:
            out.append({
                'id': f'yt:{video_id}',
                'painterId': p['id'],
                'source': 'YouTube',
                'title': title,
                'description': desc[:360],
                'url': href,
                'thumbnail': thumb,
                'publishedAt': published,
                'tags': auto_tags(title, desc, p.get('specialties', [])),
            })
    return out


def youtube_items(p: dict) -> list[dict]:
    # Always resolve the public handle first; stored IDs can become stale/wrong.
    resolved = resolve_channel_id(clean(p.get('youtube', '')))
    stored = clean(p.get('youtubeChannelId', ''))
    candidates = []
    for cid in (resolved, stored):
        if cid and cid not in candidates:
            candidates.append(cid)

    if not candidates:
        return []

    last_exc = None
    for cid in candidates:
        try:
            items = parse_feed(p, cid)
            if items:
                if cid != stored:
                    print(f'INFO YouTube {p["name"]}: resolved channel {cid}')
                return items
        except Exception as exc:
            last_exc = exc
            print(f'WARN YouTube {p["name"]} channel {cid}: {exc}')
    if last_exc:
        print(f'WARN YouTube {p["name"]}: all channel candidates failed')
    return []


def parse_ts(item: dict) -> datetime:
    try:
        return datetime.fromisoformat(item.get('publishedAt', '').replace('Z', '+00:00'))
    except Exception:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def main() -> None:
    painters = json.loads(PAINTERS.read_text(encoding='utf-8'))
    current = json.loads(FEED.read_text(encoding='utf-8')) if FEED.exists() else []

    backup_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    backup = []
    if backup_path and backup_path.exists():
        try:
            backup = json.loads(backup_path.read_text(encoding='utf-8'))
        except Exception:
            backup = []

    # Preserve last known-good YouTube items by painter from the pre-update backup.
    old_yt_by_painter: dict[str, list[dict]] = {}
    for item in backup:
        if item.get('source') == 'YouTube':
            old_yt_by_painter.setdefault(item.get('painterId', ''), []).append(item)

    # Remove any YouTube rows created by update_sources.py; we'll replace or restore them here.
    non_youtube = [x for x in current if x.get('source') != 'YouTube']
    final_youtube: list[dict] = []

    for p in painters:
        fresh = youtube_items(p)
        if fresh:
            final_youtube.extend(fresh)
            print(f'YouTube rescue {p["name"]}: fresh {len(fresh)}')
        else:
            old = old_yt_by_painter.get(p.get('id', ''), [])
            if old:
                final_youtube.extend(old)
                print(f'YouTube rescue {p["name"]}: RESTORED previous {len(old)}')
            elif p.get('youtube') or p.get('youtubeChannelId'):
                print(f'YouTube rescue {p["name"]}: 0 (no previous cache available)')

    merged_by_id = {x.get('id'): x for x in non_youtube + final_youtube if x.get('id')}
    merged = list(merged_by_id.values())
    merged.sort(key=parse_ts, reverse=True)
    FEED.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding='utf-8')

    counts: dict[str, int] = {}
    for x in merged:
        src = x.get('source', 'Other')
        counts[src] = counts.get(src, 0) + 1

    checked = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    META.write_text(json.dumps({
        'lastCheckedAt': checked,
        'totalItems': len(merged),
        'counts': counts,
    }, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'YouTube rescue completed: {len(merged)} items {counts}')


if __name__ == '__main__':
    main()
