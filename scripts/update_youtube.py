#!/usr/bin/env python3
"""Fetch painter YouTube RSS feeds and update data/feed.json. No API key required."""
from __future__ import annotations
import json, re, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAINTERS = ROOT / "data" / "painters.json"
FEED = ROOT / "data" / "feed.json"
MAX_PER_PAINTER = 12
NS = {"atom":"http://www.w3.org/2005/Atom","yt":"http://www.youtube.com/xml/schemas/2015","media":"http://search.yahoo.com/mrss/"}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36"

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
    "Layering": ["layering", "layer", "blending", "blend"],
    "Color Theory": ["color theory", "colour theory", "color wheel", "colour wheel"],
    "Tutorial": ["tutorial", "how to", "guide", "step by step", "painting process", "paint along"],
    "Review": ["review", "unboxing", "first look"],
    "Diorama": ["diorama", "vignette", "scenic base", "base building"],
    "Display": ["display", "competition", "golden demon", "box art"],
}

def fetch(url: str) -> bytes:
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Language":"en-US,en;q=0.9"})
    with urllib.request.urlopen(req,timeout=25) as r:return r.read()
def clean(text: str) -> str:return re.sub(r"\s+"," ",text or "").strip()
def resolve_channel_id(youtube_url: str) -> str:
    if not youtube_url:return ""
    m=re.search(r"youtube\.com/channel/(UC[\w-]{20,})",youtube_url)
    if m:return m.group(1)
    try:html=fetch(youtube_url).decode("utf-8",errors="ignore")
    except Exception as exc: print(f"WARN resolve {youtube_url}: {exc}"); return ""
    for pattern in [r'"channelId":"(UC[\w-]{20,})"',r'"externalId":"(UC[\w-]{20,})"',r'<meta itemprop="channelId" content="(UC[\w-]{20,})"',r'youtube\.com/channel/(UC[\w-]{20,})']:
        m=re.search(pattern,html)
        if m:return m.group(1)
    return ""

def auto_tags(title: str, desc: str, specialties: list[str]) -> list[str]:
    text=f" {title} {desc} ".lower(); found=[]
    for tag, keys in TAG_RULES.items():
        if any(k in text for k in keys): found.append(tag)
    # Painter specialties are useful context, but topic-specific tags should come first.
    for tag in specialties:
        if tag not in found: found.append(tag)
    return found[:8]

def main():
    painters=json.loads(PAINTERS.read_text(encoding="utf-8")); existing=json.loads(FEED.read_text(encoding="utf-8")) if FEED.exists() else []
    manual=[x for x in existing if not str(x.get("id","")).startswith("yt:")]; youtube_items=[]
    for p in painters:
        cid=clean(p.get("youtubeChannelId","")) or resolve_channel_id(clean(p.get("youtube","")))
        if not cid: print(f"SKIP {p['name']}: no resolvable YouTube channel"); continue
        url=f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"
        try: root=ET.fromstring(fetch(url))
        except Exception as exc: print(f"WARN {p['name']}: {exc}"); continue
        for entry in root.findall("atom:entry",NS)[:MAX_PER_PAINTER]:
            video_id=entry.findtext("yt:videoId",default="",namespaces=NS); title=clean(entry.findtext("atom:title",default="",namespaces=NS)); published=entry.findtext("atom:published",default="",namespaces=NS)
            link=entry.find("atom:link",NS); href=link.attrib.get("href") if link is not None else f"https://www.youtube.com/watch?v={video_id}"
            media_group=entry.find("media:group",NS); desc=""; thumb=f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
            if media_group is not None:
                desc=clean(media_group.findtext("media:description",default="",namespaces=NS)); mt=media_group.find("media:thumbnail",NS)
                if mt is not None and mt.attrib.get("url"): thumb=mt.attrib["url"]
            youtube_items.append({"id":f"yt:{video_id}","painterId":p["id"],"source":"YouTube","title":title,"description":desc[:360],"url":href,"thumbnail":thumb,"publishedAt":published,"tags":auto_tags(title,desc,p.get("specialties",[]))})
    merged=manual+youtube_items
    def ts(item):
        try:return datetime.fromisoformat(item.get("publishedAt","").replace("Z","+00:00"))
        except Exception:return datetime(1970,1,1,tzinfo=timezone.utc)
    merged.sort(key=ts,reverse=True); FEED.write_text(json.dumps(merged,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Updated {FEED}: {len(youtube_items)} YouTube + {len(manual)} manual items")
if __name__=="__main__":main()
