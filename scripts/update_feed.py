#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, sys, subprocess, time, urllib.request, urllib.error, xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
PFILE = ROOT/"data"/"painters.json"
FFILE = ROOT/"data"/"feed.json"
MFILE = ROOT/"data"/"meta.json"
MAX_PER_SOURCE = 30
UA = "Mozilla/5.0 DVL-Painter-Feed/1.0"

def read_json(p, default):
    try: return json.loads(p.read_text(encoding="utf-8"))
    except Exception: return default

def fetch(url, timeout=20):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept":"*/*"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.read(), r.headers.get("content-type","")

def safe_id(s):
    return re.sub(r"[^a-zA-Z0-9_-]+","-",s).strip("-")[:120]

def classify(text):
    t=(text or "").lower()
    rules={
      "NMM":["nmm","non metallic","non-metallic"],
      "Face":["face","portrait","head"],
      "Skin":["skin","flesh"],
      "OSL":["osl","object source","glow"],
      "Space Marine":["space marine","marine","primaris","warhammer 40"],
      "Ork":["ork","orc"],
      "Gold":["gold"],
      "Steel":["steel","metal"],
      "Glazing":["glaze","glazing"],
      "Airbrush":["airbrush"],
      "Tutorial":["tutorial","how to","guide","painting process"]
    }
    return [k for k,ws in rules.items() if any(w in t for w in ws)]

def yt_dlp_items(p):
    url=(p.get("youtubeUrl") or "").strip()
    if not url:
        return []

    cmd=[
        "yt-dlp",
        "--playlist-end", str(MAX_PER_SOURCE),
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--ignore-errors",
        url.rstrip("/") + "/videos"
    ]
    proc=subprocess.run(cmd,capture_output=True,text=True,timeout=180)
    if proc.returncode!=0 and not proc.stdout.strip():
        raise RuntimeError(proc.stderr.strip()[-800:])

    data=json.loads(proc.stdout)
    entries=[e for e in (data.get("entries") or []) if e][:MAX_PER_SOURCE]
    out=[]

    def iso_from_entry(e):
        ts=e.get("timestamp") or e.get("release_timestamp")
        if ts:
            return datetime.fromtimestamp(ts,tz=timezone.utc).isoformat()

        for k in ("upload_date","modified_date","release_date"):
            v=(e.get(k) or "").strip()
            if re.fullmatch(r"\\d{8}", v):
                try:
                    return datetime.strptime(v,"%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
                except Exception:
                    pass
        return None

    for e in entries:
        vid=e.get("id")
        if not vid:
            continue

        title=e.get("title") or "YouTube video"
        published=iso_from_entry(e)

        if not published:
            watch_url="https://www.youtube.com/watch?v="+vid
            detail_cmd=[
                "yt-dlp",
                "--dump-single-json",
                "--skip-download",
                "--no-warnings",
                "--ignore-errors",
                watch_url
            ]
            try:
                dp=subprocess.run(detail_cmd,capture_output=True,text=True,timeout=60)
                if dp.stdout.strip():
                    de=json.loads(dp.stdout)
                    title=de.get("title") or title
                    published=iso_from_entry(de)
            except Exception:
                pass

        out.append({
          "id":"yt-"+vid,
          "painterId":p["id"],
          "painterName":p["name"],
          "source":"YouTube",
          "title":title,
          "url":"https://www.youtube.com/watch?v="+vid,
          "thumbnail":f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
          "publishedAt":published,
          "tags":classify(title)
        })

    out.sort(key=lambda x: x.get("publishedAt") or "", reverse=True)
    return out

def rss_items(p, feed_url):
    raw,_=fetch(feed_url)
    root=ET.fromstring(raw)
    out=[]
    for it in root.findall(".//item")[:MAX_PER_SOURCE]:
        title=(it.findtext("title") or "").strip()
        link=(it.findtext("link") or "").strip()
        pub=(it.findtext("pubDate") or "").strip()
        desc=(it.findtext("description") or "")
        if not title or not link: continue
        out.append({"id":"web-"+safe_id(link),"painterId":p["id"],"painterName":p["name"],"source":"Website",
                    "title":title,"url":link,"thumbnail":"","publishedAt":pub,"tags":classify(title+" "+desc)})
    return out

def discover_rss(site):
    for u in [urljoin(site,"feed/"),urljoin(site,"feed.xml"),urljoin(site,"rss.xml")]:
        try:
            raw,ct=fetch(u)
            if b"<rss" in raw[:5000].lower() or b"<feed" in raw[:5000].lower(): return u
        except Exception: pass
    return None

def sitemap_items(p):
    site=(p.get("website") or "").strip()
    if not site:return []
    urls=[urljoin(site,"wp-sitemap.xml"),urljoin(site,"sitemap.xml")]
    locs=[]
    for sm in urls:
        try:
            raw,_=fetch(sm); r=ET.fromstring(raw)
            ns={"s":"http://www.sitemaps.org/schemas/sitemap/0.9"}
            for u in r.findall(".//s:url",ns):
                loc=u.findtext("s:loc",default="",namespaces=ns); lm=u.findtext("s:lastmod",default="",namespaces=ns)
                if loc: locs.append((loc,lm))
            if locs: break
        except Exception: pass
    out=[]
    for loc,lm in locs[:MAX_PER_SOURCE]:
        title=loc.rstrip("/").split("/")[-1].replace("-"," ").title()
        if not title: continue
        out.append({"id":"web-"+safe_id(loc),"painterId":p["id"],"painterName":p["name"],"source":"Website",
                    "title":title,"url":loc,"thumbnail":"","publishedAt":lm or None,"tags":classify(title)})
    return out

def website_items(p):
    site=(p.get("website") or "").strip()
    mode=p.get("websiteMode","none")
    if not site or mode=="none": return []
    if mode in ("rss","auto"):
        u=discover_rss(site)
        if u:
            try:return rss_items(p,u)
            except Exception as e: print("  RSS failed:",e)
        if mode=="rss": return []
    return sitemap_items(p)

def merge_source(old, fresh, painter_id, source):
    # Critical invariant: a transient fetch failure must never erase the last good cache.
    prior=[x for x in old if x.get("painterId")==painter_id and x.get("source")==source]
    return fresh if fresh else prior

def main():
    painters=read_json(PFILE,[])
    old=read_json(FFILE,[])
    # Keep only active known painters, but preserve manual/reference items.
    active_ids={p["id"] for p in painters if p.get("active",True)}
    manual=[x for x in old if x.get("source")=="Reference" and not str(x.get("title","")).startswith("Demo")]
    result=list(manual)
    for p in painters:
        if not p.get("active",True): continue
        print(f"\n{p['name']}")
        try:
            y=yt_dlp_items(p)
            print("  YouTube:",len(y))
        except Exception as e:
            print("  YouTube failed:",e); y=[]
        result.extend(merge_source(old,y,p["id"],"YouTube"))
        try:
            w=website_items(p)
            print("  Website:",len(w))
        except Exception as e:
            print("  Website failed:",e); w=[]
        result.extend(merge_source(old,w,p["id"],"Website"))

    # dedupe and stable sort
    ded={}
    for x in result:
        if x.get("painterId") in active_ids or x.get("source")=="Reference":
            ded[x.get("id") or safe_id((x.get("url") or "")+(x.get("title") or ""))]=x
    out=list(ded.values())
    out.sort(
        key=lambda x: (
            1 if x.get("publishedAt") else 0,
            x.get("publishedAt") or ""
        ),
        reverse=True
    )
    FFILE.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    counts={}
    for x in out: counts[x.get("source","Reference")]=counts.get(x.get("source","Reference"),0)+1
    meta={"updatedAt":datetime.now(timezone.utc).isoformat(),"counts":counts}
    MFILE.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("\nUpdated:",len(out),counts)

if __name__=="__main__":
    main()
