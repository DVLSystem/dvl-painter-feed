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

    # 1) Always get the channel list in flat mode first.
    # This was the reliable mode in Clean v1 / v1.1 and prevents a metadata
    # lookup failure from turning a healthy channel into 0 feed items.
    cmd=[
        "yt-dlp",
        "--flat-playlist",
        "--playlist-end", str(MAX_PER_SOURCE),
        "--dump-single-json",
        "--no-warnings",
        url.rstrip("/") + "/videos"
    ]
    proc=subprocess.run(cmd,capture_output=True,text=True,timeout=120)
    if proc.returncode!=0 or not proc.stdout.strip():
        raise RuntimeError(proc.stderr.strip()[-800:] or "empty yt-dlp response")

    data=json.loads(proc.stdout)
    entries=[e for e in (data.get("entries") or []) if e][:MAX_PER_SOURCE]

    # 2) Build a date map from YouTube RSS using the channel_id that yt-dlp
    # itself resolved. RSS normally contains the newest ~15 uploads and gives
    # exact published timestamps, which is enough to interleave recent posts
    # from different painters accurately.
    rss_dates={}
    channel_id=(data.get("channel_id") or data.get("uploader_id") or "").strip()
    if channel_id.startswith("UC"):
        try:
            raw,_=fetch("https://www.youtube.com/feeds/videos.xml?channel_id="+channel_id, timeout=20)
            rr=ET.fromstring(raw)
            ns={
              "atom":"http://www.w3.org/2005/Atom",
              "yt":"http://www.youtube.com/xml/schemas/2015"
            }
            for en in rr.findall("atom:entry",ns):
                vid=(en.findtext("yt:videoId",default="",namespaces=ns) or "").strip()
                pub=(en.findtext("atom:published",default="",namespaces=ns) or "").strip()
                if vid and pub:
                    rss_dates[vid]=pub
        except Exception as e:
            print("  YouTube RSS date supplement failed:", e)

    out=[]
    for index,e in enumerate(entries):
        vid=e.get("id")
        if not vid:
            continue
        title=e.get("title") or "YouTube video"

        published=rss_dates.get(vid)
        if not published:
            ts=e.get("timestamp") or e.get("release_timestamp")
            if ts:
                published=datetime.fromtimestamp(ts,tz=timezone.utc).isoformat()
            else:
                ud=(e.get("upload_date") or e.get("release_date") or "").strip()
                if re.fullmatch(r"\d{8}", ud):
                    try:
                        published=datetime.strptime(ud,"%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
                    except Exception:
                        published=None

        out.append({
          "id":"yt-"+vid,
          "painterId":p["id"],
          "painterName":p["name"],
          "source":"YouTube",
          "title":title,
          "url":"https://www.youtube.com/watch?v="+vid,
          "thumbnail":f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
          "publishedAt":published,
          "_channelOrder": index,
          "tags":classify(title)
        })

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
    prior=[x for x in old if x.get("painterId")==painter_id and x.get("source")==source]
    if not fresh:
        return prior

    prior_by_id={x.get("id"):x for x in prior if x.get("id")}
    merged=[]
    for x in fresh:
        prev=prior_by_id.get(x.get("id"))
        if not x.get("publishedAt") and prev and prev.get("publishedAt"):
            x["publishedAt"]=prev.get("publishedAt")
        merged.append(x)
    return merged

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

    # dedupe and global chronological sort
    ded={}
    seq=0
    for x in result:
        if x.get("painterId") in active_ids or x.get("source")=="Reference":
            x["_seq"]=seq
            seq+=1
            ded[x.get("id") or safe_id((x.get("url") or "")+(x.get("title") or ""))]=x
    out=list(ded.values())
    out.sort(
        key=lambda x: (
            1 if x.get("publishedAt") else 0,
            x.get("publishedAt") or "",
            -x.get("_seq",0)
        ),
        reverse=True
    )
    for x in out:
        x.pop("_seq",None)
        x.pop("_channelOrder",None)
    FFILE.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    counts={}
    for x in out: counts[x.get("source","Reference")]=counts.get(x.get("source","Reference"),0)+1
    meta={"updatedAt":datetime.now(timezone.utc).isoformat(),"counts":counts}
    MFILE.write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("\nUpdated:",len(out),counts)

if __name__=="__main__":
    main()
