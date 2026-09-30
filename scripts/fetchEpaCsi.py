#!/usr/bin/env python3
"""Fetch EPA Certificate Summary Information (CSI) PDFs for the given model years.

    python3 scripts/fetchEpaCsi.py 2021 2022

Same selection as the MY2023-25 pull: keyword "not listed liter engine", EVs
including heavy-duty / commercial, minus Bin>0 (gas/diesel) and fuel cells, and
only the LATEST filing per (year, test group, model list). Writes
<year>/<docid>_<testgroup>.pdf and appends to manifest.txt. The search is a
plain POST to dis.epa.gov/otaqpub/publist1.jsp; PDFs are display_file.jsp?docid=N&flag=1.
"""
import html, re, subprocess, sys, urllib.parse, urllib.request, os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

# Output lives in LocalDev/ (git-ignored): the PDFs are EPA's, not ours to commit.
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'LocalDev', 'epa-csi')
os.makedirs(HERE, exist_ok=True)
URL = 'https://dis.epa.gov/otaqpub/publist1.jsp'

def post(params):
    data = urllib.parse.urlencode(params).encode()
    return urllib.request.urlopen(urllib.request.Request(URL, data=data), timeout=60).read().decode('utf-8', 'replace')

def search(year):
    rows, page, total = [], 1, None
    while total is None or len(rows) < total:
        h = post({'pubmodule': '1', 'topics': '89', 'modelyear': year, 'industry': '-99',
                  'keyword': 'not listed liter engine', 'rpp': '100', 'rpp2': '100', 'page': str(page),
                  'totalcount': str(total or ''), 'pgrangestart': str((page - 1) * 100 + 1)})
        if total is None:
            total = int(re.search(r"name=['\"]totalcount['\"][^>]*value=['\"](\d+)['\"]", h).group(1))
        got = 0
        for tr in re.findall(r'<tr[^>]*>(.*?)</tr>', h, re.S):
            m = re.search(r'display_file\.jsp\?docid=(\d+)', tr)
            if not m: continue
            text = html.unescape(re.sub(r'<[^>]+>', '\n', tr))
            g = lambda k: (re.search(k + r':\s*([^\n]*)', text) or [None, ''])[1].strip()
            rows.append({'docid': m.group(1), 'year': year, 'title': g('Title'), 'abstract': g('Abstract'), 'date': g('Document Date')})
            got += 1
        if not got: break
        page += 1
    return rows, total

# Documents known to be wrong however the filter sees them. Add here rather than
# deleting by hand, or the next run downloads them again.
EXCLUDE = {
    '52740': 'EPA serves an HTML error page, not a PDF (2022 Audi, NVGAV00.0AZG)',
    '51118': 'Honda Clarity Fuel Cell - the abstract does not say fuel cell (2021)',
}

def keep(rows):
    out = {}
    for r in rows:
        if r['docid'] in EXCLUDE: continue
        tg = (re.search(r'test group (\S+)', r['title']) or [None, None])[1]
        bin_ = (re.search(r'certified to (.*?) standards', r['abstract']) or [None, ''])[1]
        models = (re.search(r'models: (.*)', r['abstract']) or [None, ''])[1].strip()
        if bin_ and not re.search(r'Bin 0\b|HDV\d|ZEV', bin_): continue      # gas / diesel
        if re.search(r'MIRAI|NEXO|E-FCEV|FCEV|FUEL CELL', models, re.I): continue
        r.update(tg=tg, bin=bin_, models=models)
        k = (r['year'], tg, models)
        if k not in out or datetime.strptime(r['date'], '%m/%d/%Y') > datetime.strptime(out[k]['date'], '%m/%d/%Y'):
            out[k] = r
    return list(out.values())

def download(r):
    d = os.path.join(HERE, r['year']); os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{r['docid']}_{r['tg']}.pdf")
    if os.path.exists(path): return None
    rc = subprocess.run(['curl', '-sf', '--retry', '2', '-o', path,
                         f"https://dis.epa.gov/otaqpub/display_file.jsp?docid={r['docid']}&flag=1"]).returncode
    if rc: return f"FAIL {r['docid']}"
    with open(path, 'rb') as f:                       # EPA answers 200 with an HTML page for a bad docid
        if b'%PDF' not in f.read(1024):
            os.remove(path)
            return f"NOT A PDF {r['docid']} (add to EXCLUDE)"
    return None

if __name__ == '__main__':
    manifest_path = os.path.join(HERE, 'manifest.txt')
    known = set(open(manifest_path).read().split('\n')) if os.path.exists(manifest_path) else set()
    manifest = open(manifest_path, 'a')
    for year in sys.argv[1:]:
        rows, total = search(year)
        kept = keep(rows)
        print(f'{year}: {len(rows)} of {total} listed, {len(kept)} kept')
        with ThreadPoolExecutor(6) as ex:
            fails = [f for f in ex.map(download, kept) if f]
        for r in kept:
            line = f"{r['year']} {r['docid']} {r['tg']}"
            if line not in known: manifest.write(line + '\n')
        print(f'{year}: downloaded to {year}/, failures: {fails or 0}')
