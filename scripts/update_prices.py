#!/usr/bin/env python3
"""Descarga los precios de cierre, actualiza data/prices.json y envía alertas.

- LME (estaño, plomo, cobre, zinc, aluminio): Cash-Settlement, 3 meses y stocks
  (tabla pública de westmetall.com)
- Plata y oro: cierre diario XAG/USD y XAU/USD (stooq.com; respaldo Yahoo Finance)
- USD/MXN: FIX de Banxico (requiere el secreto BANXICO_TOKEN; respaldo Yahoo / BCE)
- Alertas: reglas en alerts.json, aviso push vía ntfy.sh (secreto NTFY_TOPIC)

Solo usa la biblioteca estándar de Python (no requiere pip install).
"""
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "prices.json"
ALERTS = ROOT / "alerts.json"
KEEP_DAYS = 800  # ~3 años de días hábiles
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

LME = {
    "tin": ("Estaño", "LME_Sn_cash"),
    "lead": ("Plomo", "LME_Pb_cash"),
    "copper": ("Cobre", "LME_Cu_cash"),
    "zinc": ("Zinc", "LME_Zn_cash"),
    "aluminium": ("Aluminio", "LME_Al_cash"),
}
PRECIOUS = {
    "silver": ("Plata", "xagusd", "SI=F", "XAG/USD"),
    "gold": ("Oro", "xauusd", "GC=F", "XAU/USD"),
}

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], 1)}


# ---------------------------------------------------------------- utilidades
def get(url, data=None, headers=None):
    h = {"User-Agent": UA, "Accept-Language": "en"}
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", errors="replace")


def parse_date(text):
    """'08. October 2026' / '2026-10-08' / '08.10.2026' / '08/10/2026' -> '2026-10-08'."""
    t = text.strip().lower().replace(",", " ")
    m = re.match(r"(\d{1,2})\.?\s+([a-z]+)\s+(\d{4})", t)
    if m and m.group(2) in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return m.group(0)
    m = re.match(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", t)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def parse_num(text):
    t = str(text).strip().replace(",", "").replace(" ", "")
    try:
        return float(t)
    except ValueError:
        return None


def merge(old, new, key="date"):
    """Une historiales; lo nuevo gana. Un día con la fuente caída no borra lo previo."""
    by = {r[key]: r for r in old}
    by.update({r[key]: r for r in new})
    return sorted(by.values(), key=lambda r: r[key])[-KEEP_DAYS:]


# ---------------------------------------------------------------- LME
def parse_westmetall(html):
    """[{date, cash, m3, stock}] a partir de la(s) tabla(s) de westmetall."""
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S | re.I):
        cells = [unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
        if len(cells) < 2:
            continue
        d = parse_date(cells[0])
        if not d:
            continue
        nums = [parse_num(c) for c in cells[1:]]
        if not nums or nums[0] is None:
            continue
        rows.append({
            "date": d,
            "cash": nums[0],
            "m3": nums[1] if len(nums) > 1 else None,
            "stock": nums[2] if len(nums) > 2 else None,
        })
    return rows


def fetch_lme(field):
    url = f"https://www.westmetall.com/en/markdaten.php?action=table&field={field}"
    rows = parse_westmetall(get(url))
    if not rows:
        raise RuntimeError(f"no se encontraron filas en {url}")
    return rows


# ---------------------------------------------------------------- metales preciosos
def fetch_stooq(symbol):
    rows = []
    for r in csv.DictReader(io.StringIO(get(f"https://stooq.com/q/d/l/?s={symbol}&i=d"))):
        close, d = parse_num(r.get("Close", "") or ""), parse_date(r.get("Date", "") or "")
        if d and close:
            rows.append({"date": d, "close": close})
    if not rows:
        raise RuntimeError("stooq sin datos")
    return rows


def fetch_yahoo(symbol, field="close"):
    data = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5y&interval=1d"))
    res = data["chart"]["result"][0]
    rows = []
    for ts, c in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if c:
            d = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            rows.append({"date": d, field: round(c, 4)})
    if not rows:
        raise RuntimeError("yahoo sin datos")
    return rows


# ---------------------------------------------------------------- tipo de cambio
def fetch_banxico_fix():
    token = os.environ.get("BANXICO_TOKEN", "").strip()
    if not token:
        raise RuntimeError("falta el secreto BANXICO_TOKEN")
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=1200)).isoformat()
    url = f"https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/{start}/{end}"
    data = json.loads(get(url, headers={"Bmx-Token": token, "Accept": "application/json"}))
    rows = []
    for r in data["bmx"]["series"][0]["datos"]:
        v, d = parse_num(r["dato"]), parse_date(r["fecha"])
        if d and v:
            rows.append({"date": d, "fix": v})
    if not rows:
        raise RuntimeError("Banxico sin datos")
    return rows


def fetch_frankfurter():
    start = (date.today() - timedelta(days=1200)).isoformat()
    data = json.loads(get(f"https://api.frankfurter.app/{start}..?from=USD&to=MXN"))
    rows = [{"date": d, "fix": v["MXN"]} for d, v in sorted(data["rates"].items())]
    if not rows:
        raise RuntimeError("BCE sin datos")
    return rows


# ---------------------------------------------------------------- alertas
def check_alerts(prev_metals, metals):
    """Devuelve mensajes de alerta para los metales con un cierre nuevo."""
    if not ALERTS.exists():
        return []
    try:
        rules = json.loads(ALERTS.read_text()).get("reglas", [])
    except Exception as e:  # noqa: BLE001
        return [f"⚠️ alerts.json no es válido: {e}"]
    msgs = []
    for r in rules:
        key = r.get("metal")
        m = metals.get(key)
        if not m or len(m["history"]) < 2:
            continue
        old_last = (prev_metals.get(key, {}).get("history") or [{}])[-1].get("date")
        last, before = m["history"][-1], m["history"][-2]
        if last["date"] == old_last:
            continue  # no hay cierre nuevo: no repetir avisos
        v = last.get("cash", last.get("close"))
        p = before.get("cash", before.get("close"))
        unit, name = m["unit"], m["name"]
        tipo, val = r.get("tipo"), r.get("valor")
        if tipo == "sube" and p < val <= v:
            msgs.append(f"{name} subió a {v:,.2f} {unit} (cruzó {val:,.2f})")
        elif tipo == "baja" and p > val >= v:
            msgs.append(f"{name} bajó a {v:,.2f} {unit} (cruzó {val:,.2f})")
        elif tipo == "movimiento":
            pct = (v - p) / p * 100
            if abs(pct) >= val:
                msgs.append(f"{name} se movió {pct:+.2f}% en el día: {v:,.2f} {unit}")
    return msgs


def notify(msgs):
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not msgs:
        return
    if not topic:
        print("Alertas (sin NTFY_TOPIC configurado, no se envían):", *msgs, sep="\n  ")
        return
    body = json.dumps({"topic": topic, "title": "Metales — alerta de precio",
                       "message": "\n".join(msgs), "tags": ["chart_with_upwards_trend"]}).encode()
    get("https://ntfy.sh/", data=body, headers={"Content-Type": "application/json"})
    print("Alertas enviadas:", *msgs, sep="\n  ")


# ---------------------------------------------------------------- principal
def main():
    prev = json.loads(OUT.read_text()) if OUT.exists() else {}
    prev_m = prev.get("metals", {})
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "metals": {}, "fx": {}, "errors": []}

    for key, (name, field) in LME.items():
        old = prev_m.get(key, {}).get("history", [])
        try:
            hist = merge(old, fetch_lme(field))
        except Exception as e:  # noqa: BLE001
            out["errors"].append(f"{name}: {e}")
            hist = old
        out["metals"][key] = {"name": name, "unit": "USD/t", "kind": "lme",
                              "source": "LME (vía westmetall.com)", "history": hist}

    for key, (name, stooq, yahoo, label) in PRECIOUS.items():
        old = prev_m.get(key, {}).get("history", [])
        hist, src = old, prev_m.get(key, {}).get("source", "—")
        for fn, lab in ((lambda: fetch_stooq(stooq), f"{label} (stooq.com)"),
                        (lambda: fetch_yahoo(yahoo), f"COMEX {yahoo} (Yahoo Finance)")):
            try:
                hist, src = merge(old, fn()), lab
                break
            except Exception as e:  # noqa: BLE001
                out["errors"].append(f"{name} {lab}: {e}")
        out["metals"][key] = {"name": name, "unit": "USD/oz", "kind": "precious",
                              "source": src, "history": hist}

    old_fx = prev.get("fx", {}).get("usdmxn", {})
    hist, src = old_fx.get("history", []), old_fx.get("source", "—")
    for fn, lab in ((fetch_banxico_fix, "FIX Banxico"),
                    (lambda: fetch_yahoo("MXN=X", "fix"), "USD/MXN (Yahoo Finance)"),
                    (fetch_frankfurter, "USD/MXN (Banco Central Europeo)")):
        try:
            hist, src = merge(old_fx.get("history", []), fn()), lab
            break
        except Exception as e:  # noqa: BLE001
            out["errors"].append(f"Tipo de cambio {lab}: {e}")
    out["fx"]["usdmxn"] = {"name": "USD/MXN", "source": src, "history": hist}
    # No es error si Banxico solo falta por no tener token y otro respaldo funcionó
    out["errors"] = [e for e in out["errors"] if "BANXICO_TOKEN" not in e or not hist]

    if not any(m["history"] for m in out["metals"].values()):
        print("ERROR: ninguna fuente respondió", out["errors"], file=sys.stderr)
        sys.exit(1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    for m in out["metals"].values():
        last = m["history"][-1] if m["history"] else None
        print(f"{m['name']:9s} {len(m['history']):4d} días  último: {last}")
    fx = out["fx"]["usdmxn"]
    print(f"USD/MXN   {len(fx['history']):4d} días  último: {fx['history'][-1] if fx['history'] else None}  ({fx['source']})")
    for e in out["errors"]:
        print("AVISO:", e)

    try:
        notify(check_alerts(prev_m, out["metals"]))
    except Exception as e:  # noqa: BLE001
        print("AVISO: no se pudieron enviar alertas:", e)


if __name__ == "__main__":
    main()
