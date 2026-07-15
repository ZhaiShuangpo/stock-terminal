import asyncio
import math
import os
import shutil
import time
import httpx
from contextlib import asynccontextmanager
from dataclasses import dataclass
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List, Set

# Third-party HTTP clients used by market providers and Gemini inspect proxy
# variables at different times. The desktop environment can supply IPv6
# NO_PROXY entries such as ``::1`` that some clients misparse as port ``:1``.
# This application connects to providers directly, so remove the complete
# proxy environment before importing those SDKs.
PROXY_ENV_KEYS = (
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
)
for proxy_key in PROXY_ENV_KEYS:
    os.environ.pop(proxy_key, None)

# AI analysis always tries the managed Antigravity agent first, then falls
# back through the requested Gemini models in this exact order.
ANTIGRAVITY_AGENT = "antigravity-preview-05-2026"
AI_MODEL_PRIORITY = (
    ANTIGRAVITY_AGENT,
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
)
AI_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis": {"type": "string"},
        "longTermStrategy": {"type": "string"},
        "swingStrategy": {"type": "string"},
        "shortTermStrategy": {"type": "string"},
        "asOf": {"type": "string"},
        "searchStatus": {"type": "string", "enum": ["complete", "partial", "failed"]},
        "directCatalystFound": {"type": "boolean"},
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
        "support": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "resistance": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        "supportBasis": {"type": "string"},
        "resistanceBasis": {"type": "string"},
        "winRate": {"type": "string", "enum": ["A", "B+", "B-", "C"]},
        "ratingBasis": {"type": "string"},
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "url": {"type": "string"},
                    "publishedAt": {"type": "string"},
                    "sourceType": {"type": "string"},
                    "keyFact": {"type": "string"},
                },
                "required": ["title", "url", "publishedAt", "sourceType", "keyFact"],
            },
        },
    },
    "required": [
        "analysis", "longTermStrategy", "swingStrategy", "shortTermStrategy",
        "asOf", "searchStatus", "directCatalystFound", "confidence",
        "support", "resistance", "supportBasis", "resistanceBasis",
        "winRate", "ratingBasis", "sources",
    ],
}
NEWS_SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "sentiment": {"type": "string", "enum": ["POSITIVE", "NEUTRAL", "NEGATIVE", "UNCERTAIN"]},
        "factSentiment": {"type": "string", "enum": ["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED", "UNCERTAIN"]},
        "shortTermImpact": {"type": "string", "enum": ["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED", "UNCERTAIN"]},
        "pricedInRisk": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "UNKNOWN"]},
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
        "asOf": {"type": "string"},
        "searchStatus": {"type": "string", "enum": ["complete", "partial", "failed"]},
        "sources": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "url": {"type": "string"}, "publishedAt": {"type": "string"},
            "sourceType": {"type": "string"}, "keyFact": {"type": "string"},
        }, "required": ["title", "url", "publishedAt", "sourceType", "keyFact"]}},
    },
    "required": ["summary", "sentiment", "factSentiment", "shortTermImpact", "pricedInRisk", "confidence", "asOf", "searchStatus", "sources"],
}
THESIS_EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "evaluation": {"type": "string"},
        "status": {"type": "string", "enum": ["HOLD", "WARNING", "SELL"]},
        "confidence": {"type": "integer", "minimum": 0, "maximum": 100},
        "asOf": {"type": "string"},
        "searchStatus": {"type": "string", "enum": ["complete", "partial", "failed"]},
        "kpiFindings": {"type": "array", "items": {"type": "string"}},
        "invalidations": {"type": "array", "items": {"type": "string"}},
        "sources": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "url": {"type": "string"}, "publishedAt": {"type": "string"},
            "sourceType": {"type": "string"}, "keyFact": {"type": "string"},
        }, "required": ["title", "url", "publishedAt", "sourceType", "keyFact"]}},
    },
    "required": ["evaluation", "status", "confidence", "asOf", "searchStatus", "kpiFindings", "invalidations", "sources"],
}

from google import genai
from google.genai import types
from market_core import is_current_market_timestamp, normalize_symbols, parse_tencent_quote, safe_float
import re
import akshare as ak
import pandas as pd
from datetime import datetime
from urllib.parse import urlparse

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
SECTOR_MAP_PATH = os.path.join(BACKEND_DIR, "sector_stock_map.json")
MIN_HEALTHY_SECTOR_MAP_STOCKS = 800
MIN_SECTOR_FETCH_SUCCESS_RATIO = 0.85


def is_sector_map_candidate_healthy(existing_count: int, new_count: int, sector_count: int, successful_sectors: int) -> bool:
    success_ratio = successful_sectors / sector_count if sector_count > 0 else 0
    return (
        new_count >= MIN_HEALTHY_SECTOR_MAP_STOCKS
        and success_ratio >= MIN_SECTOR_FETCH_SUCCESS_RATIO
        and (existing_count < MIN_HEALTHY_SECTOR_MAP_STOCKS or new_count >= existing_count * 0.8)
    )

# Global http client and caches
http_client: httpx.AsyncClient | None = None

cached_sectors = None
last_sectors_fetch_time = 0
last_sectors_fetch_failed = False

cached_indices = None
last_indices_fetch_time = 0

# The market feed is process-wide.  Clients only subscribe to symbols; one
# background task fetches the union and fans the result out to every client.
market_clients: Dict[WebSocket, Set[str]] = {}
market_refresh_event: asyncio.Event | None = None
background_tasks: List[asyncio.Task] = []


@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    await startup_event()
    try:
        yield
    finally:
        await shutdown_event()


app = FastAPI(lifespan=app_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # The browser client does not use cookies. Wildcard origins and credential
    # mode are not a valid combination in browsers.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global store for trend data and previous prices for anomaly detection
stock_history: Dict[str, List[float]] = {}
prev_prices: Dict[str, float] = {}
prev_amounts: Dict[str, float] = {}
stock_states: Dict[str, dict] = {}

import json

sector_volume_ratios: Dict[str, float] = {}
kline_semaphore = asyncio.Semaphore(5)


async def fetch_kline_from_sina(symbol: str, period: str = "day", limit: int = 100):
    global http_client
    if not (symbol.startswith("sh") or symbol.startswith("sz")):
        symbol = f"sh{symbol}" if symbol.startswith("6") else f"sz{symbol}"

    scale_map = {
        "day": 240,
        "week": 1200,
        "month": 7200
    }
    scale = scale_map.get(period, 240)
    url = f"http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={symbol}&scale={scale}&ma=no&datalen={limit}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    try:
        response = await http_client.get(url, headers=headers, timeout=5.0)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list):
                klines = []
                for item in data:
                    klines.append([
                        item.get("day", ""),
                        float(item.get("open", 0.0) or 0.0),
                        float(item.get("close", 0.0) or 0.0),
                        float(item.get("high", 0.0) or 0.0),
                        float(item.get("low", 0.0) or 0.0),
                        float(item.get("volume", 0.0) or 0.0) / 100.0
                    ])
                return klines
    except Exception as e:
        print(f"Error fetching Sina K-line for {symbol}: {e}")
    return None

async def calculate_sector_volume_ratio_by_constituents(sector_id: str) -> float:
    global http_client
    url = f"http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=40&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=b:{sector_id}&fields=f12,f13"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://quote.eastmoney.com/',
        'Connection': 'close'
    }
    try:
        response = await http_client.get(url, headers=headers, timeout=5.0)
        data = response.json()
        if "data" not in data or "diff" not in data["data"]:
            return 1.0

        diff_list = data["data"]["diff"]
        symbols = []
        for item in diff_list:
            market_code = "sh" if item.get("f13") == 1 else "sz"
            code = item.get("f12", "")
            symbols.append(f"{market_code}{code}")

        if not symbols:
            return 1.0

        async def fetch_kline(symbol):
            async with kline_semaphore:
                try:
                    res = await fetch_kline_from_sina(symbol, "day", 30)
                    if res:
                        return symbol, res
                except Exception:
                    pass
                return symbol, None

        tasks = [fetch_kline(sym) for sym in symbols]
        kline_results = await asyncio.gather(*tasks)

        daily_amounts = {}
        for sym, klines in kline_results:
            if not klines: continue
            for k in klines:
                dt = k[0]
                try:
                    close = float(k[2])
                    vol = float(k[5])
                    amt = close * vol * 100.0
                    daily_amounts[dt] = daily_amounts.get(dt, 0.0) + amt
                except (IndexError, TypeError, ValueError):
                    pass

        sorted_dates = sorted(list(daily_amounts.keys()))
        if len(sorted_dates) >= 20:
            amounts_seq = [daily_amounts[d] for d in sorted_dates]
            amt_5 = sum(amounts_seq[-5:]) / 5.0
            amt_20 = sum(amounts_seq[-20:]) / 20.0
            if amt_20 > 0:
                return amt_5 / amt_20
    except Exception as e:
        print(f"Error calculating sector volume ratio for {sector_id}: {e}")
    return 1.0

async def update_sector_volume_loop():
    try:
        global http_client, sector_volume_ratios
        print("update_sector_volume_loop entered, sleeping 20s...")
        await asyncio.sleep(20)
        while True:
            try:
                print("Background updating sector volume ratios by constituents...")
                url = "http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=f12,f3,f109,f110"
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Referer': 'https://quote.eastmoney.com/',
                    'Connection': 'close'
                }
                response = await http_client.get(url, headers=headers, timeout=5.0)
                data = response.json()
                if "data" in data and "diff" in data["data"]:
                    candidates = []
                    for item in data["data"]["diff"]:
                        sec_id = item.get("f12")
                        change = safe_float(item.get("f3"))
                        change5d = safe_float(item.get("f109"))
                        change20d = safe_float(item.get("f110"))

                        if change20d <= -5.0 and 0.0 < change5d < 4.0 and change >= -1.0:
                            candidates.append(sec_id)

                    print(f"Found {len(candidates)} sector candidates matching price criteria for volume check.")

                    for sid in candidates:
                        try:
                            ratio = await calculate_sector_volume_ratio_by_constituents(sid)
                            sector_volume_ratios[sid] = ratio
                        except Exception as inner_e:
                            print(f"Error calculating volume ratio for {sid}: {inner_e}")
                        await asyncio.sleep(1.0)

                    print(f"Background updated {len(sector_volume_ratios)} sector volume ratios.")
                await asyncio.sleep(300)
            except Exception as e:
                print(f"Background sector volume ratios error: {e}")
                await asyncio.sleep(60)
    except Exception as fatal_e:
        print(f"FATAL error in update_sector_volume_loop: {fatal_e}")





async def fetch_sectors():
    global http_client, cached_sectors, last_sectors_fetch_time, last_sectors_fetch_failed, sector_volume_ratios
    now = time.time()
    cache_ttl = 30 if last_sectors_fetch_failed else 60
    if cached_sectors is not None and (now - last_sectors_fetch_time < cache_ttl):
        return cached_sectors
    url = "http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=f12,f14,f3,f109,f110,f62"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://quote.eastmoney.com/',
        'Connection': 'close'
    }
    last_error = None
    for attempt in range(3):
        try:
            response = await http_client.get(url, headers=headers, timeout=5.0)
            response.raise_for_status()
            data = response.json()
            diff = (data.get("data") or {}).get("diff")
            if not isinstance(diff, list):
                raise ValueError("Eastmoney sector response has no data.diff list")

            sectors = []
            for item in diff:
                sec_id = str(item.get("f12", ""))
                fund_flow_raw = safe_float(item.get("f62"))
                fund_flow = fund_flow_raw / 100000000.0
                vol_ratio = sector_volume_ratios.get(sec_id, 1.0)
                sectors.append({
                    "id": sec_id,
                    "name": str(item.get("f14", "")),
                    "changePercent": safe_float(item.get("f3")),
                    "change5d": safe_float(item.get("f109")),
                    "change20d": safe_float(item.get("f110")),
                    "volRatio": vol_ratio,
                    "fundFlow": fund_flow
                })
            cached_sectors = sectors
            last_sectors_fetch_time = time.time()
            last_sectors_fetch_failed = False
            return sectors
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                await asyncio.sleep(0.4 * (attempt + 1))

    print(f"Fetch sectors error after 3 attempts: {type(last_error).__name__}: {last_error!r}")
    last_sectors_fetch_time = time.time()
    last_sectors_fetch_failed = True
    if cached_sectors is None:
        cached_sectors = []
    return cached_sectors


async def fetch_indices():
    global http_client, cached_indices, last_indices_fetch_time
    now = time.time()
    if cached_indices and (now - last_indices_fetch_time < 2):
        return cached_indices
    indices = ["s_sh000001", "s_sz399001", "s_sz399006", "s_sh000300"]
    url = f"http://qt.gtimg.cn/q={','.join(indices)}"
    try:
        response = await http_client.get(url, timeout=2.0)
        results = []
        for line in response.text.split(';'):
            if '=' not in line: continue
            parts = line.split('=')
            data = parts[1].strip('"').split('~')
            if len(data) < 6: continue
            results.append({
                "name": data[1],
                "code": data[2],
                "price": safe_float(data[3]),
                "change": safe_float(data[4]),
                "changePercent": safe_float(data[5]),
            })
        cached_indices = results
        last_indices_fetch_time = now
        return results
    except Exception as e:
        print("Fetch indices error:", e)
        return cached_indices or []

async def fetch_tencent_data(symbols: List[str]):
    global http_client
    if not symbols:
        return [], []
    url = f"http://qt.gtimg.cn/q={','.join(symbols)}"
    alerts = []
    try:
        response = await http_client.get(url, timeout=3.0)
        text = response.text
        results = []
        for line in text.split(';'):
            line = line.strip()
            if not line:
                continue
            parts = line.split('=')
            if len(parts) < 2: continue
            symbol_parts = parts[0].split('_', 1)
            if len(symbol_parts) != 2:
                print(f"Skipping malformed Tencent symbol: {parts[0]!r}")
                continue
            code_prefix = symbol_parts[1] # sh600519
            data_str = parts[1].strip('"')
            fields = data_str.split('~')
            quote = parse_tencent_quote(fields, code_prefix)
            if quote:
                name = quote["name"]
                price = quote["price"]
                amount = quote["amount"]

                limit_up_price = safe_float(fields[47])
                limit_down_price = safe_float(fields[48])

                if code_prefix not in stock_states:
                    stock_states[code_prefix] = {"is_zt": False, "is_dt": False}
                state = stock_states[code_prefix]

                # 1. Anomaly Detection (Limit Up / Down & Broken Board)
                if limit_up_price > 0 and price >= limit_up_price:
                    buy1_price = safe_float(fields[9])
                    buy1_vol = safe_float(fields[10]) # in hands (100 shares)
                    if buy1_price >= limit_up_price and buy1_vol > 0:
                        seal_amount = (buy1_vol * 100 * buy1_price) / 100000000 # in 亿
                        if not state["is_zt"]:
                            alerts.append({
                                "time": time.strftime("%H:%M:%S"),
                                "symbol": code_prefix, "name": name,
                                "type": "封死涨停", "value": f"封单 {seal_amount:.1f}亿"
                            })
                            state["is_zt"] = True
                else:
                    if state["is_zt"]:
                        alerts.append({
                            "time": time.strftime("%H:%M:%S"),
                            "symbol": code_prefix, "name": name,
                            "type": "涨停炸板", "value": "封单撤销/被砸"
                        })
                        state["is_zt"] = False

                if limit_down_price > 0 and price <= limit_down_price:
                    sell1_price = safe_float(fields[19])
                    sell1_vol = safe_float(fields[20])
                    if sell1_price <= limit_down_price and sell1_vol > 0:
                        seal_amount = (sell1_vol * 100 * sell1_price) / 100000000
                        if not state["is_dt"]:
                            alerts.append({
                                "time": time.strftime("%H:%M:%S"),
                                "symbol": code_prefix, "name": name,
                                "type": "封死跌停", "value": f"封单 {seal_amount:.1f}亿"
                            })
                            state["is_dt"] = True
                else:
                    if state["is_dt"]:
                        alerts.append({
                            "time": time.strftime("%H:%M:%S"),
                            "symbol": code_prefix, "name": name,
                            "type": "跌停撬开", "value": "巨单撬板"
                        })
                        state["is_dt"] = False

                # 2. Large Order Tracking (千万大单)
                if code_prefix in prev_amounts:
                    delta_amount = amount - prev_amounts[code_prefix]
                    if delta_amount >= 10000000: # 10 Million RMB
                        if price > prev_prices.get(code_prefix, price):
                            alerts.append({
                                "time": time.strftime("%H:%M:%S"),
                                "symbol": code_prefix, "name": name,
                                "type": "大单扫货", "value": f"{delta_amount/10000:.0f}万"
                            })
                        elif price < prev_prices.get(code_prefix, price):
                            alerts.append({
                                "time": time.strftime("%H:%M:%S"),
                                "symbol": code_prefix, "name": name,
                                "type": "大单砸盘", "value": f"{delta_amount/10000:.0f}万"
                            })

                # 3. Simple Jump Detection
                if code_prefix in prev_prices:
                    old_p = prev_prices[code_prefix]
                    if old_p > 0:
                        jump = (price - old_p) / old_p * 100
                        if abs(jump) >= 0.8: # 0.8% jump in 3 seconds is very strong
                            alerts.append({
                                "time": time.strftime("%H:%M:%S"),
                                "symbol": code_prefix,
                                "name": name,
                                "type": "急速拉升" if jump > 0 else "快速跳水",
                                "value": f"{'+' if jump > 0 else ''}{jump:.2f}%"
                            })

                prev_prices[code_prefix] = price
                prev_amounts[code_prefix] = amount

                if code_prefix not in stock_history:
                    stock_history[code_prefix] = []

                stock_history[code_prefix].append(price)
                if len(stock_history[code_prefix]) > 60:
                    stock_history[code_prefix].pop(0)

                quote["trend"] = list(stock_history[code_prefix])
                results.append(quote)
        return results, alerts
    except Exception as e:
        print(f"Error fetching data: {e}")
        return [], []

@app.get("/api/search")
async def search_stock(q: str):
    global http_client
    if not q:
        return {"results": []}
    url = f"https://smartbox.gtimg.cn/s3/?v=2&q={q}&t=all"
    try:
        response = await http_client.get(url, timeout=3.0)
        text = response.text
        if 'v_hint="' in text:
            data_str = text.split('v_hint="')[1].split('"')[0]
            results = []
            for item in data_str.split('^'):
                if not item: continue
                parts = item.split('~')
                if len(parts) >= 3:
                    market = parts[0]
                    code = parts[1]
                    name = parts[2]
                    if market in ['sh', 'sz']:
                        try:
                            name = name.encode('utf-8').decode('unicode_escape')
                        except UnicodeError:
                            pass
                        results.append({
                            "symbol": f"{market}{code}",
                            "name": name,
                            "code": code
                        })
            return {"results": results}
    except Exception as e:
        print(f"Search error: {e}")
        return {"results": []}
    return {"results": []}

@app.get("/api/intraday")
async def intraday_stock(symbol: str):
    global http_client
    if not symbol:
        return {"data": []}
    url = f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={symbol}"
    try:
        response = await http_client.get(url, timeout=3.0)
        data = response.json()
        if data.get("code") == 0 and symbol in data.get("data", {}):
            stock_data = data["data"][symbol]["data"]["data"]
            date_str = data["data"][symbol]["data"]["date"]
            return {"data": stock_data, "date": date_str}
    except Exception as e:
        print(f"Intraday error: {e}")
        return {"data": []}
    return {"data": []}

@app.get("/api/fundflow")
async def fundflow_stock(symbol: str):
    global http_client
    if not symbol:
        return {"data": None}
    url = f"http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_lscjfb?page=1&num=1&sort=opendate&asc=0&daima={symbol}"
    try:
        response = await http_client.get(url, timeout=3.0)
        data = response.json()
        if data and len(data) > 0:
            item = data[0]
            # Sina's r0_net is super large order net inflow, r1_net is large order net inflow
            r0_net = safe_float(item.get("r0_net"))
            r1_net = safe_float(item.get("r1_net"))
            main_net_amount = r0_net + r1_net
            return {
                "data": {
                    "netAmount": main_net_amount,
                    "ratioAmount": safe_float(item.get("ratioamount"))
                }
            }
    except Exception as e:
        print(f"Fundflow error: {e}")
        return {"data": None}
    return {"data": None}

@app.get("/api/sector/{sector_id}")
async def get_sector_stocks(sector_id: str, mode: str = "long_term"):
    global http_client
    # Long-term mode deliberately samples the broader constituent universe by
    # market cap instead of taking only the day's top gainers. Tactical mode is
    # separate and may use short-term ranking plus K-line enrichment.
    normalized_mode = "tactical" if mode == "tactical" else "long_term"
    page_size = 80 if normalized_mode == "tactical" else 200
    sort_field = "f3" if normalized_mode == "tactical" else "f21"
    url = f"http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz={page_size}&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid={sort_field}&fs=b:{sector_id}&fields=f12,f14,f2,f3,f4,f5,f6,f15,f16,f13,f9,f23,f21,f8,f185,f186"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://quote.eastmoney.com/',
        'Connection': 'close'
    }
    try:
        response = await http_client.get(url, headers=headers, timeout=5.0)
        response.raise_for_status()
        data = response.json()
        if not isinstance((data.get("data") or {}).get("diff"), list):
            raise ValueError("Eastmoney sector constituent response has no data.diff list")
        results = []
        if "data" in data and "diff" in data["data"]:
            diff_list = data["data"]["diff"]

            async def enrich_stock_kline(item):
                market_code = "sh" if item.get("f13") == 1 else "sz"
                code = item.get("f12", "")
                symbol = f"{market_code}{code}"

                ma_bullish = False
                poc_breakout = False
                daily_amts = {}

                async with kline_semaphore:
                    try:
                        klines = await fetch_kline_from_sina(symbol, "day", 70)
                        if klines:
                            if len(klines) >= 50:
                                closes = [float(k[2]) for k in klines]
                                highs = [float(k[3]) for k in klines]
                                lows = [float(k[4]) for k in klines]

                                current_price = float(klines[-1][2])

                                ma5 = sum(closes[-5:]) / 5.0
                                ma10 = sum(closes[-10:]) / 10.0
                                ma20 = sum(closes[-20:]) / 20.0
                                ma60 = sum(closes[-60:]) / 60.0 if len(closes) >= 60 else 0.0

                                if current_price > ma20 and ma5 > ma10:
                                    if ma60 == 0.0 or ma20 > ma60:
                                        ma_bullish = True

                                h_max = max(highs[-50:])
                                l_min = min(lows[-50:])
                                if h_max > l_min:
                                    bin_width = (h_max - l_min) / 20.0
                                    bins = [0.0] * 20
                                    for k in klines[-50:]:
                                        c = float(k[2])
                                        v = float(k[5])
                                        bin_idx = int((c - l_min) / bin_width)
                                        if bin_idx >= 20:
                                            bin_idx = 19
                                        elif bin_idx < 0:
                                            bin_idx = 0
                                        bins[bin_idx] += v

                                    poc_idx = bins.index(max(bins))
                                    poc_high = l_min + (poc_idx + 1) * bin_width
                                    poc_breakout = current_price >= poc_high

                                for k in klines[-30:]:
                                    try:
                                        c = float(k[2])
                                        v = float(k[5])
                                        daily_amts[k[0]] = c * v * 100.0
                                    except (IndexError, TypeError, ValueError):
                                        pass
                    except Exception as exc:
                        print(f"K-line enrichment failed for {symbol}: {exc}")
                return symbol, ma_bullish, poc_breakout, daily_amts

            enrich_tasks = [enrich_stock_kline(item) for item in diff_list] if normalized_mode == "tactical" else []
            enrich_results = await asyncio.gather(*enrich_tasks)
            enrich_map = {r[0]: (r[1], r[2]) for r in enrich_results}

            sector_daily_amounts = {}
            for r in enrich_results:
                daily_amts = r[3]
                for dt, amt in daily_amts.items():
                    sector_daily_amounts[dt] = sector_daily_amounts.get(dt, 0.0) + amt

            sorted_dates = sorted(list(sector_daily_amounts.keys()))
            if len(sorted_dates) >= 20:
                amounts_seq = [sector_daily_amounts[d] for d in sorted_dates]
                amt_5 = sum(amounts_seq[-5:]) / 5.0
                amt_20 = sum(amounts_seq[-20:]) / 20.0
                if amt_20 > 0:
                    vol_ratio = amt_5 / amt_20
                    sector_volume_ratios[sector_id] = vol_ratio

            for item in diff_list:
                market_code = "sh" if item.get("f13") == 1 else "sz"
                code = item.get("f12", "")
                symbol = f"{market_code}{code}"

                pe = safe_float(item.get("f9"))
                pb = safe_float(item.get("f23"))
                marketCap = safe_float(item.get("f21")) / 100000000.0
                turnover = safe_float(item.get("f8"))
                def optional_metric(value):
                    if value in (None, "", "-"):
                        return None
                    return safe_float(value)

                netProfitGrowth = optional_metric(item.get("f185"))
                revenueGrowth = optional_metric(item.get("f186"))
                profit_growth_for_limits = netProfitGrowth if netProfitGrowth is not None else 0.0
                revenue_growth_for_limits = revenueGrowth if revenueGrowth is not None else 0.0

                if revenue_growth_for_limits > 20.0 or profit_growth_for_limits > 15.0:
                    maxPe, maxPb = 80.0, 8.0
                elif netProfitGrowth is not None and netProfitGrowth <= 0.0:
                    maxPe, maxPb = 12.0, 1.2
                else:
                    maxPe, maxPb = 40.0, 4.5

                ma_bullish, poc_breakout = enrich_map.get(symbol, (False, True))

                results.append({
                    "symbol": symbol,
                    "code": code,
                    "name": item.get("f14", ""),
                    "price": safe_float(item.get("f2")),
                    "change": safe_float(item.get("f4")),
                    "changePercent": safe_float(item.get("f3")),
                    "volume": safe_float(item.get("f5")),
                    "amount": safe_float(item.get("f6")),
                    "high": safe_float(item.get("f15")),
                    "low": safe_float(item.get("f16")),
                    "pe": pe,
                    "pb": pb,
                    "marketCap": marketCap,
                    "turnover": turnover,
                    "netProfitGrowth": netProfitGrowth,
                    "revenueGrowth": revenueGrowth,
                    "maxPe": maxPe,
                    "maxPb": maxPb,
                    "maBullish": ma_bullish,
                    "pocBreakout": poc_breakout,
                })
        return {
            "data": results,
            "meta": {
                "mode": normalized_mode,
                "universeSort": "dailyChange" if normalized_mode == "tactical" else "marketCap",
                "sampleSize": len(results),
                "requestedLimit": page_size,
                "technicalEnrichment": normalized_mode == "tactical",
                "asOf": datetime.now().astimezone().isoformat(timespec="seconds"),
                "message": "短期战术样本按当日涨幅排序" if normalized_mode == "tactical" else "长期研究样本按流通市值覆盖，不以当日涨幅入选",
            },
        }
    except Exception as e:
        print(f"Sector fetch error: {e}")
        return {"data": [], "meta": {"mode": normalized_mode, "sampleSize": 0, "asOf": datetime.now().astimezone().isoformat(timespec="seconds"), "message": "板块成分股数据获取失败"}}


async def get_kline_data(symbol: str, period: str = "day", limit: int = 100):
    global http_client
    # period: day, week, month
    if symbol.startswith("sh") or symbol.startswith("sz"):
        req_symbol = symbol
    else:
        req_symbol = f"sh{symbol}" if symbol.startswith("6") else f"sz{symbol}"

    # Try Sina K-line first as primary
    try:
        klines = await fetch_kline_from_sina(req_symbol, period, limit)
        if klines:
            return klines
    except Exception as e:
        print(f"Sina K-line fallback error: {e}")

    # Fallback to Tencent K-line API
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={req_symbol},{period},,,{limit},qfq"
    try:
        response = await http_client.get(url, timeout=5.0)
        data = response.json()
        if data and "data" in data and req_symbol in data["data"]:
            stock_data = data["data"][req_symbol]
            kline_key = f"qfq{period}" if f"qfq{period}" in stock_data else period
            if kline_key in stock_data:
                return stock_data[kline_key]
    except Exception as e:
        print(f"K-line error: {e}")
        return None
    return None

def calculate_ema(data_list, period):
    k = 2 / (period + 1)
    ema_list = []
    ema = data_list[0]
    for i, val in enumerate(data_list):
        if i == 0:
            ema_list.append(val)
        else:
            ema = val * k + ema * (1 - k)
            ema_list.append(ema)
    return ema_list

def calculate_macd(close_prices, short_period=12, long_period=26, signal_period=9):
    if len(close_prices) < long_period:
        return [], [], []
    ema_short = calculate_ema(close_prices, short_period)
    ema_long = calculate_ema(close_prices, long_period)
    dif = [s - l for s, l in zip(ema_short, ema_long)]
    dea = calculate_ema(dif, signal_period)
    macd = [(d - de) * 2 for d, de in zip(dif, dea)]
    return dif, dea, macd

def calculate_ma(close_prices, period):
    if len(close_prices) < period:
        return []
    ma_list = []
    for i in range(len(close_prices)):
        if i < period - 1:
            ma_list.append(None)
        else:
            ma_list.append(sum(close_prices[i-period+1:i+1]) / period)
    return ma_list


def build_historical_market_context(klines: list, label: str, recent_rows: int = 12) -> str:
    """Compress a long OHLCV series into auditable trend/risk statistics."""
    valid = [item for item in (klines or []) if len(item) >= 6 and safe_float(item[2]) > 0]
    if not valid:
        return f"{label}不可用"

    closes = [safe_float(item[2]) for item in valid]
    highs = [safe_float(item[3]) for item in valid]
    lows = [safe_float(item[4]) for item in valid]
    volumes = [safe_float(item[5]) for item in valid]
    returns = [closes[index] / closes[index - 1] - 1 for index in range(1, len(closes)) if closes[index - 1] > 0]
    periods_per_year = 52 if "周线" in label else 252
    if len(returns) > 1:
        mean_return = sum(returns) / len(returns)
        variance = sum((value - mean_return) ** 2 for value in returns) / (len(returns) - 1)
        annualized_volatility = math.sqrt(variance) * math.sqrt(periods_per_year) * 100
    else:
        annualized_volatility = None

    peak = closes[0]
    max_drawdown = 0.0
    for close in closes:
        peak = max(peak, close)
        max_drawdown = min(max_drawdown, (close / peak - 1) * 100)

    def period_return(period: int) -> str:
        if len(closes) <= period or closes[-period - 1] <= 0:
            return "数据不足"
        return f"{(closes[-1] / closes[-period - 1] - 1) * 100:.2f}%"

    moving_averages = []
    for period in (20, 60, 120, 250):
        if len(closes) >= period:
            moving_averages.append(f"MA{period}={sum(closes[-period:]) / period:.2f}")
    recent_volume_count = min(20, len(volumes))
    average_volume = sum(volumes[-recent_volume_count:]) / recent_volume_count if recent_volume_count else 0
    volume_ratio = volumes[-1] / average_volume if average_volume > 0 else 0
    price_range = max(highs) - min(lows)
    range_percentile = (closes[-1] - min(lows)) / price_range * 100 if price_range > 0 else 50

    volatility_text = f"{annualized_volatility:.2f}%" if annualized_volatility is not None else "数据不足"
    summary = (
        f"{label}覆盖={valid[0][0]}至{valid[-1][0]}，有效样本={len(valid)}；"
        f"区间最高={max(highs):.2f}，区间最低={min(lows):.2f}，收盘位置分位={range_percentile:.1f}%；"
        f"20/60/120/250周期收益={period_return(20)}/{period_return(60)}/{period_return(120)}/{period_return(250)}；"
        f"最大回撤={max_drawdown:.2f}%，年化波动率={volatility_text}"
    )
    indicator_summary = (
        f"当前收盘={closes[-1]:.2f}，{', '.join(moving_averages) or '长期均线数据不足'}，"
        f"最新成交量/近20周期均量={volume_ratio:.2f}"
    )
    rows = [
        f"{item[0]} O={safe_float(item[1]):.2f} C={safe_float(item[2]):.2f} "
        f"H={safe_float(item[3]):.2f} L={safe_float(item[4]):.2f} V={safe_float(item[5]):.0f}"
        for item in valid[-recent_rows:]
    ]
    return summary + "\n" + indicator_summary + "\n近期明细：\n" + "\n".join(rows)


@dataclass
class AIContentResult:
    text: str
    sources: List[dict]
    search_queries: List[str]


def _safe_web_source(title: str, url: str) -> dict | None:
    """Accept only displayable HTTP(S) citations returned by Gemini."""
    parsed = urlparse(str(url or ""))
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return {"title": str(title or parsed.netloc).strip() or parsed.netloc, "url": url}


def _deduplicate_sources(sources: List[dict]) -> List[dict]:
    unique = []
    seen = set()
    for source in sources:
        normalized = _safe_web_source(source.get("title", ""), source.get("url", ""))
        if not normalized or normalized["url"] in seen:
            continue
        seen.add(normalized["url"])
        unique.append({**source, **normalized})
    return unique[:10]


def finalize_ai_analysis(payload: dict, ai_result: AIContentResult, model_name: str, as_of: str) -> dict:
    """Validate additive AI fields while preserving the original response contract."""
    result = payload if isinstance(payload, dict) else {}
    model_sources = [source for source in result.get("sources", []) if isinstance(source, dict)]
    result["sources"] = _deduplicate_sources(model_sources + ai_result.sources)
    result["searchQueries"] = list(dict.fromkeys(ai_result.search_queries))[:10]
    formal_source_types = ("交易所", "公司", "监管", "定期报告")
    formal_source_count = sum(
        any(source_type in str(source.get("sourceType", "")) for source_type in formal_source_types)
        for source in result["sources"]
    )
    result["searchStatus"] = (
        "complete" if len(result["sources"]) >= 4 and formal_source_count >= 2
        else "partial" if result["sources"] else "failed"
    )
    result["asOf"] = result.get("asOf") or as_of
    result["modelUsed"] = model_name
    result["directCatalystFound"] = result.get("directCatalystFound") is True
    confidence = int(safe_float(result.get("confidence"), 0))
    result["confidence"] = max(0, min(100, confidence))
    for level_name in ("support", "resistance"):
        level = safe_float(result.get(level_name), 0)
        result[level_name] = level if level > 0 else None
    result.setdefault("supportBasis", "历史数据不足，无法确认支撑依据")
    result.setdefault("resistanceBasis", "历史数据不足，无法确认压力依据")
    result["winRate"] = result.get("winRate") if result.get("winRate") in {"A", "B+", "B-", "C"} else None
    result.setdefault("ratingBasis", "模型未提供评级依据；该等级不是历史回测胜率")
    result.setdefault("longTermStrategy", "长期策略数据不足，暂不形成结论")
    result.setdefault("swingStrategy", "波段策略数据不足，暂不形成结论")
    result.setdefault("shortTermStrategy", "短线策略数据不足，暂不形成结论")
    result.setdefault("analysis", "AI 未返回可展示的分析正文")
    return result


def finalize_market_review(ai_result: AIContentResult, model_name: str, as_of: str) -> dict:
    return {
        "review": ai_result.text,
        "asOf": as_of,
        "modelUsed": model_name,
        "searchStatus": "complete" if ai_result.sources else "partial",
        "searchQueries": list(dict.fromkeys(ai_result.search_queries))[:10],
        "sources": ai_result.sources,
    }


def finalize_news_summary(payload: dict, ai_result: AIContentResult, model_name: str, as_of: str) -> dict:
    result = payload if isinstance(payload, dict) else {}
    allowed_sentiment = {"POSITIVE", "NEUTRAL", "NEGATIVE", "UNCERTAIN"}
    allowed_fact = allowed_sentiment | {"MIXED"}
    result["sentiment"] = result.get("sentiment") if result.get("sentiment") in allowed_sentiment else "UNCERTAIN"
    result["factSentiment"] = result.get("factSentiment") if result.get("factSentiment") in allowed_fact else "UNCERTAIN"
    result["shortTermImpact"] = result.get("shortTermImpact") if result.get("shortTermImpact") in allowed_fact else "UNCERTAIN"
    result["pricedInRisk"] = result.get("pricedInRisk") if result.get("pricedInRisk") in {"LOW", "MEDIUM", "HIGH", "UNKNOWN"} else "UNKNOWN"
    result["confidence"] = max(0, min(100, int(safe_float(result.get("confidence"), 0))))
    model_sources = [source for source in result.get("sources", []) if isinstance(source, dict)]
    result["sources"] = _deduplicate_sources(model_sources + ai_result.sources)
    result["searchQueries"] = list(dict.fromkeys(ai_result.search_queries))[:10]
    result["searchStatus"] = result.get("searchStatus") if result.get("searchStatus") in {"complete", "partial", "failed"} else ("complete" if result["sources"] else "failed")
    result["asOf"] = result.get("asOf") or as_of
    result["modelUsed"] = model_name
    result.setdefault("summary", "未获得可核验的近期重大信息。")
    return result


def finalize_thesis_evaluation(payload: dict, ai_result: AIContentResult, model_name: str, as_of: str) -> dict:
    result = payload if isinstance(payload, dict) else {}
    result["status"] = result.get("status") if result.get("status") in {"HOLD", "WARNING", "SELL"} else "WARNING"
    result["confidence"] = max(0, min(100, int(safe_float(result.get("confidence"), 0))))
    result["kpiFindings"] = [str(item) for item in result.get("kpiFindings", []) if str(item).strip()][:10]
    result["invalidations"] = [str(item) for item in result.get("invalidations", []) if str(item).strip()][:10]
    model_sources = [source for source in result.get("sources", []) if isinstance(source, dict)]
    result["sources"] = _deduplicate_sources(model_sources + ai_result.sources)
    result["searchStatus"] = result.get("searchStatus") if result.get("searchStatus") in {"complete", "partial", "failed"} else ("complete" if result["sources"] else "failed")
    result["asOf"] = result.get("asOf") or as_of
    result["modelUsed"] = model_name
    result.setdefault("evaluation", "没有获得足够证据完成逻辑复核。")
    return result


def generate_ai_content(
    api_key: str,
    model_name: str,
    prompt: str,
    response_schema: dict | None = None,
) -> AIContentResult:
    """Run an Antigravity agent or Gemini model and retain search citations."""
    client = genai.Client(api_key=api_key)
    try:
        if model_name == ANTIGRAVITY_AGENT:
            interaction = client.interactions.create(
                agent=ANTIGRAVITY_AGENT,
                input=prompt,
                store=True,
                environment="remote",
                timeout=180.0,
            )
            if interaction.status != "completed":
                raise RuntimeError(f"Antigravity interaction ended with status {interaction.status}")
            sources = []
            search_queries = []
            for step in interaction.steps or []:
                if getattr(step, "type", None) == "google_search_call":
                    search_queries.extend(getattr(getattr(step, "arguments", None), "queries", None) or [])
                if getattr(step, "type", None) != "model_output":
                    continue
                for content in getattr(step, "content", None) or []:
                    if getattr(content, "type", None) != "text":
                        continue
                    for annotation in getattr(content, "annotations", None) or []:
                        if getattr(annotation, "type", None) == "url_citation":
                            sources.append({
                                "title": getattr(annotation, "title", ""),
                                "url": getattr(annotation, "url", ""),
                            })
            if not interaction.output_text:
                raise RuntimeError("Antigravity returned no text output")
            return AIContentResult(
                interaction.output_text,
                _deduplicate_sources(sources),
                list(dict.fromkeys(search_queries)),
            )

        config_kwargs = {"tools": [{"google_search": {}}]}
        if response_schema and model_name.startswith("gemini-3"):
            config_kwargs.update({
                "response_mime_type": "application/json",
                "response_json_schema": response_schema,
            })
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(**config_kwargs),
        )
        sources = []
        search_queries = []
        for candidate in response.candidates or []:
            metadata = candidate.grounding_metadata
            if not metadata:
                continue
            search_queries.extend(metadata.web_search_queries or [])
            for chunk in metadata.grounding_chunks or []:
                if chunk.web:
                    sources.append({"title": chunk.web.title or "", "url": chunk.web.uri or ""})
        return AIContentResult(response.text, _deduplicate_sources(sources), search_queries)
    finally:
        client.close()


def describe_ai_error(error: Exception | None) -> str:
    if error is None:
        return "未知错误"
    message = str(error)
    lowered = message.lower()
    if "invalid port" in lowered or "proxy" in lowered:
        return "后端网络代理配置无效"
    if any(token in lowered for token in ("api key", "api_key", "401", "403", "permission_denied")):
        return "Gemini API Key 无效或没有模型访问权限"
    if any(token in lowered for token in ("429", "resource_exhausted", "quota")):
        return "Gemini 调用额度或频率已达到限制"
    if any(token in lowered for token in ("timeout", "timed out", "connection")):
        return "连接 Gemini 服务失败"
    return message


def is_non_retryable_ai_error(error: Exception) -> bool:
    lowered = str(error).lower()
    return any(token in lowered for token in (
        "invalid port", "api key", "api_key", "401", "403", "permission_denied"
    ))

@app.get("/api/history")
async def history_stock(symbol: str, period: str = "day"):
    if not symbol:
        return {"data": []}

    kline_raw = await get_kline_data(symbol, period, 200)
    if not kline_raw:
        return {"data": []}

    formatted_data = []
    for item in kline_raw:
        if len(item) >= 6:
            # item = [date, open, close, high, low, volume]
            formatted_data.append({
                "time": item[0],
                "open": float(item[1]),
                "close": float(item[2]),
                "high": float(item[3]),
                "low": float(item[4]),
                "volume": float(item[5])
            })
    return {"data": formatted_data}

@app.get("/api/analyze")
async def analyze_stock(
    symbol: str,
    name: str = "",
    price: str = "",
    changePercent: str = "",
    pe: str = "",
    pb: str = "",
    marketCap: str = "",
    high: str = "",
    low: str = "",
    volume: str = "",
    amount: str = "",
    quoteTime: str = "",
    fundNetAmount: str = "",
    fundRatio: str = "",
    x_gemini_key: str = Header(None),
):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")
    try:
        stock_identifier = f"{name}({symbol})" if name else symbol

        analysis_time = datetime.now().astimezone().isoformat(timespec="seconds")
        snapshot_context = (
            f"最新价={price or '未知'}, 涨跌幅={changePercent or '未知'}%, "
            f"最高={high or '未知'}, 最低={low or '未知'}, "
            f"成交量={volume or '未知'}股, 成交额={amount or '未知'}元, "
            f"行情时间={quoteTime or '未提供'}"
        )
        fundamentals = (
            f"PE={pe or '未知'}, PB={pb or '未知'}, 流通市值={marketCap or '未知'}亿元"
        )
        fund_flow_context = (
            f"主力净额={fundNetAmount or '未知'}元, "
            f"主力净额占比={safe_float(fundRatio) * 100:.2f}%"
            if fundRatio else f"主力净额={fundNetAmount or '未知'}元, 主力净额占比=未知"
        )

        history_results = await asyncio.gather(
            get_kline_data(symbol, "day", 250),
            get_kline_data(symbol, "week", 156),
            return_exceptions=True,
        )
        daily_klines = history_results[0] if not isinstance(history_results[0], Exception) else []
        weekly_klines = history_results[1] if not isinstance(history_results[1], Exception) else []
        daily_context = build_historical_market_context(daily_klines, "日线长周期", 20)
        weekly_context = build_historical_market_context(weekly_klines, "周线长周期", 12)

        prompt = f"""
<role>
你是服务于长线交易员的A股投资分析师。核心任务是评估企业长期投资价值，再分别制定波段与短线执行策略。
不得虚构公告、财报、新闻、研报、历史估值分位、资金行为或历史行情。
“吸筹、洗盘、主升、派发”等只能作为概率性技术推断，不能写成已确认事实。
</role>

<time_context>
当前北京时间：{analysis_time}
本地行情时间：{quoteTime or '未提供；必须降低时效置信度'}
处理时必须明确当前年份为 {datetime.now().year} 年，搜索词和结论不得忽略日期。
</time_context>

<local_market_data>
标的：{stock_identifier}
行情快照：{snapshot_context}
估值快照：{fundamentals}
资金快照：{fund_flow_context}
日线长周期历史（目标约1年，实际覆盖以样本日期为准）：
{daily_context}

周线长周期历史（目标约3年，实际覆盖以样本日期为准）：
{weekly_context}
</local_market_data>

<research_workflow>
在分析前必须联网搜索，并按以下优先级核验：
1. 巨潮资讯、上交所、深交所、北交所正式公告；
2. 公司官网、投资者关系记录及监管机构；
3. 权威财经媒体；
4. 券商或行业研究资料。

公告和新闻重点检索最近30日，并核对可能改变长期逻辑的重大事项；财务经营数据至少检查最近4个季度，能获得时回看3至5年；行业周期、竞争格局和政策资料优先采用最近12个月信息。
至少尝试获得4个有效来源，其中至少2个应为交易所、监管机构、公司正式披露或定期报告。每个来源记录标题、URL、发布时间、来源类型和支持的关键事实。
必须区分“近期增量信息”“长期基本面证据”和“市场观点”。旧信息不能冒充近期催化，媒体或研报观点不能冒充公司事实。
来源冲突时以交易所、监管机构和公司正式披露为准。没有直接证据时明确写“暂无可验证的直接催化”。
</research_workflow>

<analysis_rules>
1. 先列已确认事实，再写推断，二者不得混淆；长期结论优先于短期价格波动。
2. 仅凭当前PE/PB不得声称处于历史估值底部；缺少历史分位时明确说明数据不足。
3. 长期投资策略以1至3年为周期，评价商业模式、竞争优势、盈利与现金流质量、治理、行业空间、估值安全边际、核心催化和逻辑证伪条件，并给出建仓/加仓/持有/减仓/回避的条件式建议。
4. 波段交易策略以1至12周为周期，结合周线/日线趋势、量价、估值与催化，给出入场区间、仓位节奏、止损或退出条件。
5. 短线交易策略以1至10个交易日为周期，只作为战术执行，不得用短线强弱替代长期价值判断；给出触发条件、止损和止盈纪律。
6. support和resistance返回距离现价最近、可执行的主要支撑位和压力位；必须基于所给OHLCV、均线、前高前低或成交密集区，并分别写明依据。数据不足时返回null，不得猜测。
7. 必须给出基准、乐观、悲观三种长期情景及各自触发条件，不能承诺收益。
8. confidence为0到100，取决于行情时效、来源质量、来源数量和证据一致性，不代表收益概率。
9. winRate是“胜率评级”的兼容字段，只能是A、B+、B-或C。它代表当前策略的证据充分度、风险收益结构和多周期一致性，不是历史回测胜率；没有真实回测不得输出百分比。证据不足、历史样本不足或多周期冲突时不得高于B-。
</analysis_rules>

<output_format>
只返回一个严格合法的JSON对象，不要Markdown代码块，不要JSON注释。字段必须如下：
{{
  "analysis": "投资结论摘要；包含已确认事实、长期基本面与估值判断、历史行情状态、三种长期情景、主要风险和逻辑失效条件",
  "longTermStrategy": "1至3年策略；长期逻辑、建仓/加仓/持有/减仓条件、仓位原则和证伪条件",
  "swingStrategy": "1至12周策略；趋势判断、入场区间、仓位节奏、退出与止损条件",
  "shortTermStrategy": "1至10个交易日策略；触发条件、止盈止损和不交易条件",
  "asOf": "ISO 8601时间",
  "searchStatus": "complete或partial或failed",
  "directCatalystFound": false,
  "confidence": 0,
  "support": null,
  "resistance": null,
  "supportBasis": "主要支撑位的客观依据；无数据时说明不足",
  "resistanceBasis": "主要压力位的客观依据；无数据时说明不足",
  "winRate": "B-",
  "ratingBasis": "评级依据，并明确这是定性策略评级而非历史回测胜率",
  "sources": [
    {{"title": "", "url": "https://...", "publishedAt": "", "sourceType": "交易所/公司/监管/媒体/研报", "keyFact": ""}}
  ]
}}
</output_format>
"""
        last_error = None

        for model_name in AI_MODEL_PRIORITY:
            try:
                ai_result = await asyncio.to_thread(
                    generate_ai_content, x_gemini_key, model_name, prompt, AI_ANALYSIS_SCHEMA
                )
                response_text = ai_result.text
                import json
                import re
                try:
                    text = response_text.strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```(?:json)?\n", "", text)
                        text = re.sub(r"\n```$", "", text)
                    res_data = json.loads(text)
                    return finalize_ai_analysis(res_data, ai_result, model_name, analysis_time)
                except json.JSONDecodeError:
                    return finalize_ai_analysis(
                        {"analysis": response_text, "searchStatus": "partial"},
                        ai_result,
                        model_name,
                        analysis_time,
                    )
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e
                if is_non_retryable_ai_error(e):
                    break

        return {"analysis": f"AI分析失败: {describe_ai_error(last_error)}"}
    except Exception as e:
        print(f"Gemini Error: {e}")
        return {"analysis": f"AI分析失败: 请检查您的 API Key 是否有效。({str(e)})"}

@app.post("/api/review")
async def generate_market_review(data: dict, x_gemini_key: str = Header(None)):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")

    indices_summary = data.get("indices", [])
    sectors_summary = data.get("sectors", [])

    try:
        review_time = datetime.now().astimezone().isoformat(timespec="seconds")
        latest_sectors = await fetch_sectors()
        if latest_sectors:
            sectors_summary = latest_sectors
        sector_snapshot_time = (
            datetime.fromtimestamp(last_sectors_fetch_time).astimezone().isoformat(timespec="seconds")
            if last_sectors_fetch_time else "未知"
        )
        context = (
            f"【分析请求时间】{review_time}\n"
            f"【板块数据抓取时间】{sector_snapshot_time}\n\n"
            "【主要指数实时快照】\n"
        )
        for idx in indices_summary:
            context += (
                f"- {idx.get('name', '未知指数')}: {safe_float(idx.get('price')):.2f}, "
                f"涨跌幅 {safe_float(idx.get('changePercent')):.2f}%\n"
            )

        index_symbols = (
            ("上证指数", "sh000001"),
            ("深证成指", "sz399001"),
            ("创业板指", "sz399006"),
        )
        context += "\n【主要指数60日趋势摘要】\n"
        for index_name, index_symbol in index_symbols:
            klines = await get_kline_data(index_symbol, "day", 60)
            if not klines:
                context += f"- {index_name}: 历史行情不可用\n"
                continue
            closes = [safe_float(k[2]) for k in klines]
            volumes = [safe_float(k[5]) for k in klines]
            ma5 = calculate_ma(closes, 5)
            ma10 = calculate_ma(closes, 10)
            ma20 = calculate_ma(closes, 20)
            ma60 = calculate_ma(closes, 60)
            _, _, macd = calculate_macd(closes)

            def latest_indicator(values):
                return f"{values[-1]:.2f}" if values and values[-1] is not None else "-"

            average_volume_20 = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 0
            volume_ratio = volumes[-1] / average_volume_20 if average_volume_20 > 0 else 0
            context += (
                f"- {index_name} 数据日={klines[-1][0]} 收={closes[-1]:.2f} "
                f"MA5={latest_indicator(ma5)} MA10={latest_indicator(ma10)} "
                f"MA20={latest_indicator(ma20)} MA60={latest_indicator(ma60)} "
                f"MACD柱={latest_indicator(macd)} 量比20日={volume_ratio:.2f}\n"
            )

        valid_sectors = [sector for sector in sectors_summary if isinstance(sector, dict)]
        valid_sectors.sort(key=lambda sector: safe_float(sector.get("changePercent")), reverse=True)
        context += "\n【全板块轮动矩阵（按当日涨幅排序）】\n"
        for sector in valid_sectors[:100]:
            context += (
                f"- {sector.get('name', '未知板块')}: 今日={safe_float(sector.get('changePercent')):.2f}%, "
                f"5日={safe_float(sector.get('change5d')):.2f}%, "
                f"20日={safe_float(sector.get('change20d')):.2f}%, "
                f"量比={safe_float(sector.get('volRatio'), 1):.2f}, "
                f"主力净流入={safe_float(sector.get('fundFlow')):.2f}亿元\n"
            )

        global cached_sentiment
        sentiment_data = data.get("sentiment") if isinstance(data.get("sentiment"), dict) else cached_sentiment

        if sentiment_data:
            context += "\n【全市场真实情绪扫描】\n"
            context += f"- 上涨/下跌/平盘: {sentiment_data.get('up', '未知')} / {sentiment_data.get('down', '未知')} / {sentiment_data.get('flat', '未知')}\n"
            context += f"- 涨跌停家数: 涨停 {sentiment_data.get('limitUp', '未知')} 家 / 跌停 {sentiment_data.get('limitDown', '未知')} 家\n"
            context += f"- 两市总成交额: {sentiment_data.get('totalVolume', '未知')} 亿\n"
            context += "- 当前数据源未可靠提供昨日涨停收益与连板天梯，禁止据此推断情绪。\n"

        prompt = f"""
<role>
你是严格基于数据和联网证据的A股盘面与板块轮动研究员。你的任务是分析指数环境、市场宽度、资金风格和板块轮动，不分析任何单只股票。
</role>

<time_context>
当前北京时间：{review_time}。若当前尚未收盘，必须称为“盘中快照”，不得冒充收盘复盘。
</time_context>

<market_context>
{context}
</market_context>

<web_research>
分析前必须联网核验当日影响指数和板块的宏观、政策、产业及海外事件。
优先级：国务院及部委/央行/证监会/交易所等官方来源，其次为行业协会和公司正式信息，再次为权威财经媒体。
重点检查最近3个交易日，较早信息只能作为背景，不得直接解释当日轮动。来源冲突时以官方发布时间和原文为准。
如果未发现直接政策或事件驱动，明确写“本轮动更可能由资金与技术结构驱动，暂无可验证的新催化”。
</web_research>

<rotation_method>
综合板块今日、5日、20日涨跌幅、量比和主力净流入，将板块归入：
1. 主线强化：多周期走强且量价/资金确认；
2. 低位启动：20日偏弱但今日与5日转强，量能或资金开始确认；
3. 高位分化：20日强势但今日资金或量价转弱；
4. 退潮弱势：多周期偏弱且缺少资金承接。
不能仅凭当日涨幅推荐板块，也不能把板块普涨简单解释成持续主线。
</rotation_method>

<required_report>
使用Markdown，严格按以下结构输出：

## 1. 指数环境与市场宽度
- 判断上证、深证、创业板之间的强弱和风格差异。
- 结合MA5/10/20/60、MACD、量比、上涨下跌比和涨跌停判断趋势、情绪周期与成交环境。

## 2. 板块轮动全景
- 说明资金由哪些方向流向哪些方向，当前属于集中主线、快速轮动还是防御切换。
- 分别列出主线强化、低位启动、高位分化、退潮弱势板块及数据依据。
- 只分析板块，不得出现个股名称、代码或逐股点评。

## 3. 下一交易日易启动方向
- 最多给出3个候选板块，按启动概率排序。
- 每个板块必须写：入选依据、需要观察的开盘/量能/资金确认条件、失效条件和追高风险。
- 如果证据不足，可以少于3个或明确无高确定性方向，不得凑数。

## 4. 大盘次日情景推演
- 给出偏强、震荡、调整三种路径及各自触发条件，不作单一路径的确定性预测。
- 明确指数可能的压力、支撑或均线观察位；数据不足时不要编造点位。
- 判断调整预期来自缩量、技术压力、外围扰动还是板块退潮。

## 5. 仓位与执行纪律
- 给出指数/板块层面的仓位区间和加减仓条件。
- 给出次日最重要的一条交易纪律。

## 6. 联网证据摘要
- 列出真正参与结论的来源、发布时间和支持事实。

要求事实与推断分开，语言简洁专业。不得分析自选股、持仓股或任何个股。
</required_report>
"""
        last_error = None

        for model_name in AI_MODEL_PRIORITY:
            try:
                ai_result = await asyncio.to_thread(
                    generate_ai_content, x_gemini_key, model_name, prompt
                )
                return finalize_market_review(ai_result, model_name, review_time)
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e
                if is_non_retryable_ai_error(e):
                    break

        return {"review": f"复盘报告生成失败: {describe_ai_error(last_error)}"}
    except Exception as e:
        print(f"Gemini Review Error: {e}")
        return {"review": f"复盘报告生成失败: {str(e)}"}

DEFAULT_SYMBOLS = {
    "sh600519", "sz300750", "sh601318", "sz002594", "sh601127",
    "sh601138", "sz000001", "sh600036", "sz300059", "sh600030",
}
async def market_broadcast_loop():
    """Fetch the union of subscriptions once and fan it out to clients."""
    global market_refresh_event
    while True:
        try:
            subscribers = list(market_clients.items())
            if not subscribers:
                try:
                    await asyncio.wait_for(market_refresh_event.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    pass
                market_refresh_event.clear()
                continue

            symbols = sorted(set().union(*(subscription for _, subscription in subscribers)))
            indices_task = asyncio.create_task(fetch_indices())
            market_task = asyncio.create_task(fetch_tencent_data(symbols))
            sectors_task = asyncio.create_task(fetch_sectors())
            indices_result, market_result, sectors_result = await asyncio.gather(
                indices_task, market_task, sectors_task, return_exceptions=True
            )
            if isinstance(indices_result, Exception):
                print(f"Indices provider failed: {type(indices_result).__name__}: {indices_result!r}")
                indices = cached_indices or []
            else:
                indices = indices_result

            if isinstance(market_result, Exception):
                print(f"Market provider failed: {type(market_result).__name__}: {market_result!r}")
                market_data, alerts = [], []
            else:
                market_data, alerts = market_result

            if isinstance(sectors_result, Exception):
                print(f"Sectors provider failed: {type(sectors_result).__name__}: {sectors_result!r}")
                sectors = cached_sectors or []
            else:
                sectors = sectors_result

            market_by_symbol = {item["symbol"]: item for item in market_data}
            timestamp = int(time.time() * 1000)

            for websocket, subscription in subscribers:
                if websocket not in market_clients:
                    continue
                payload = {
                    "type": "market_data",
                    "schemaVersion": 1,
                    "serverTime": timestamp,
                    "payload": [market_by_symbol[symbol] for symbol in subscription if symbol in market_by_symbol],
                    "indices": indices,
                    "alerts": [alert for alert in alerts if alert["symbol"] in subscription],
                    "sectors": sectors,
                    "resonanceStocks": cached_resonance_stocks,
                    "resonanceMeta": cached_resonance_meta,
                }
                try:
                    await websocket.send_json({"type": "ping", "timestamp": timestamp})
                    await websocket.send_json(payload)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    market_clients.pop(websocket, None)
                    print(
                        "Removed failed market WebSocket "
                        f"({type(exc).__name__}: {exc!r})"
                    )

            try:
                await asyncio.wait_for(market_refresh_event.wait(), timeout=3.0)
                market_refresh_event.clear()
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"Market broadcaster error ({type(exc).__name__}): {exc!r}")
            await asyncio.sleep(1)


@app.websocket("/ws/market")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    market_clients[websocket] = set(DEFAULT_SYMBOLS)
    market_refresh_event.set()
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "subscribe":
                market_clients[websocket] = normalize_symbols(data.get("symbols", []))
                market_refresh_event.set()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"WebSocket receiver error: {exc}")
    finally:
        market_clients.pop(websocket, None)
        market_refresh_event.set()

@app.post("/api/evaluate_thesis")
async def evaluate_thesis(payload: dict, x_gemini_key: str = Header(None)):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")

    symbol = payload.get("symbol")
    name = payload.get("name")
    thesis = payload.get("thesis")
    catalysts = payload.get("catalysts", "")
    risks = payload.get("risks", "")
    kpis = payload.get("kpis", "")
    invalidation = payload.get("invalidation", "")
    entry_snapshot = payload.get("entrySnapshot", {})
    has_audit_criteria = bool(str(kpis or "").strip() and str(invalidation or "").strip())

    if not symbol or not thesis:
        raise HTTPException(status_code=400, detail="Symbol and thesis are required")

    try:
        stock_identifier = f"{name}({symbol})" if name else symbol
        analysis_time = datetime.now().astimezone().isoformat(timespec="seconds")

        prompt = f"""
<role>你是独立、审慎的长期投资逻辑审计员。你只判断证据是否支持原假设，不预测短期涨跌，也不替用户下达交易指令。</role>
<context>
复核时间：{analysis_time}
标的：{stock_identifier}
核心逻辑：{thesis}
预期催化：{catalysts or '未记录'}
已知风险：{risks or '未记录'}
跟踪KPI：{kpis or '未记录'}
明确证伪条件：{invalidation or '未记录'}
入场快照：{entry_snapshot}
</context>
<research>
必须联网核验。优先查询交易所/巨潮公告、定期报告、公司投资者关系材料和监管信息；其次使用权威行业数据与财经媒体。
经营与财务KPI检查最近4个季度，公告与风险事件重点检查最近30日。每条关键判断需有来源和日期；无法核验时明确写“数据不足”，不得用股价表现代替基本面证据。
</research>
<audit_rules>
1. 对每项KPI分别判断“改善/持平/恶化/无法核验”，列入kpiFindings。
2. 对每项证伪条件逐条检查，invalidations只记录已触发或接近触发的条件。
3. HOLD仅表示当前未发现证伪证据；WARNING表示证据不足、KPI恶化或接近证伪；SELL仅在正式信息明确触发核心证伪条件时使用。
4. 没有结构化KPI或证伪条件时，status最高只能为WARNING，confidence不得超过40。
5. confidence代表证据质量与覆盖度，不代表收益概率。evaluation必须包含支持证据、反方证据、缺失数据和下一次复核事项。
</audit_rules>
<output>只返回严格合法JSON：
{{
  "evaluation": "结构化复核正文",
  "status": "HOLD|WARNING|SELL",
  "confidence": 0,
  "asOf": "ISO 8601",
  "searchStatus": "complete|partial|failed",
  "kpiFindings": [""],
  "invalidations": [""],
  "sources": [{{"title":"", "url":"https://...", "publishedAt":"", "sourceType":"公告/财报/监管/行业/媒体", "keyFact":""}}]
}}
</output>
"""
        last_error = None

        for model_name in AI_MODEL_PRIORITY:
            try:
                ai_result = await asyncio.to_thread(
                    generate_ai_content, x_gemini_key, model_name, prompt, THESIS_EVALUATION_SCHEMA
                )
                response_text = ai_result.text
                import json
                import re
                try:
                    text = response_text.strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```(?:json)?\n", "", text)
                        text = re.sub(r"\n```$", "", text)
                    res_data = json.loads(text)
                    result = finalize_thesis_evaluation(res_data, ai_result, model_name, analysis_time)
                    if not has_audit_criteria:
                        result["status"] = "WARNING"
                        result["confidence"] = min(result["confidence"], 40)
                    return result
                except json.JSONDecodeError:
                    result = finalize_thesis_evaluation(
                        {"evaluation": response_text, "status": "WARNING", "searchStatus": "partial"},
                        ai_result, model_name, analysis_time,
                    )
                    if not has_audit_criteria:
                        result["confidence"] = min(result["confidence"], 40)
                    return result
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e
                if is_non_retryable_ai_error(e):
                    break

        return {"evaluation": f"逻辑重估失败: {describe_ai_error(last_error)}", "status": "WARNING", "confidence": 0, "searchStatus": "failed", "sources": []}

    except Exception as e:
        print(f"Evaluate thesis error: {e}")
        return {"evaluation": "系统错误，请重试。", "status": "WARNING"}

cached_sentiment = {}
cached_resonance_stocks = []
cached_resonance_meta = {
    "status": "initializing",
    "updatedAt": None,
    "dataTimestamp": None,
    "failedPages": [],
    "message": "共振扫描正在初始化",
}
stock_to_sectors = {}
sector_map_meta = {
    "status": "initializing",
    "source": None,
    "updatedAt": None,
    "lastError": None,
}
MAX_RESONANCE_SECTORS = 85
MAX_RESONANCE_KLINE_CHECKS = 60


def build_sina_sector_map_sync() -> tuple[dict, int, int]:
    """Build a broad industry map from Sina when Eastmoney is unavailable."""
    sectors = ak.stock_sector_spot(indicator="新浪行业")
    new_map: dict[str, list[str]] = {}
    successful_sectors = 0
    for _, sector in sectors.iterrows():
        label = str(sector.get("label", "")).strip()
        sector_name = str(sector.get("板块", "")).strip()
        if not label or not sector_name:
            continue
        try:
            constituents = ak.stock_sector_detail(sector=label)
            if constituents.empty or "symbol" not in constituents.columns:
                continue
            successful_sectors += 1
            for symbol in constituents["symbol"].dropna().astype(str):
                if not re.fullmatch(r"(?:sh|sz|bj)\d{6}", symbol):
                    continue
                new_map.setdefault(symbol, [])
                if sector_name not in new_map[symbol]:
                    new_map[symbol].append(sector_name)
        except Exception as exc:
            print(f"Sina sector fallback failed for {sector_name}: {exc}")
    return new_map, len(sectors), successful_sectors


def fetch_sina_spot_symbols_sync(limit: int = 300) -> list[str]:
    """Return current top movers from Sina without relying on Eastmoney pages."""
    spot = ak.stock_zh_a_spot()
    if spot.empty or "代码" not in spot.columns or "涨跌幅" not in spot.columns:
        return []
    ranked = spot.copy()
    ranked["涨跌幅"] = pd.to_numeric(ranked["涨跌幅"], errors="coerce")
    ranked = ranked.dropna(subset=["涨跌幅"]).sort_values("涨跌幅", ascending=False)
    return [
        symbol for symbol in ranked["代码"].astype(str).head(limit).tolist()
        if re.fullmatch(r"(?:sh|sz|bj)\d{6}", symbol)
    ]


async def fetch_tencent_resonance_rows(symbols: list[str]) -> tuple[list[dict], int]:
    """Enrich Sina's market ranking with Tencent valuation and liquidity fields."""
    rows = []
    latest_timestamp = 0
    for start in range(0, len(symbols), 60):
        batch = symbols[start:start + 60]
        try:
            response = await http_client.get(f"http://qt.gtimg.cn/q={','.join(batch)}", timeout=8.0)
            for line in response.text.split(";"):
                if "=" not in line:
                    continue
                symbol = line.split("=", 1)[0].split("_")[-1]
                fields = line.split("=", 1)[1].strip().strip('"').split("~")
                quote = parse_tencent_quote(fields, symbol)
                if not quote:
                    continue
                quote_time = str(quote.get("quoteTime", ""))
                timestamp = 0
                try:
                    timestamp = int(datetime.strptime(quote_time[:14], "%Y%m%d%H%M%S").timestamp())
                    latest_timestamp = max(latest_timestamp, timestamp)
                except (TypeError, ValueError):
                    pass
                market = 1 if symbol.startswith("sh") else 2 if symbol.startswith("bj") else 0
                rows.append({
                    "f12": quote["code"], "f13": market, "f14": quote["name"],
                    "f2": quote["price"], "f3": quote["changePercent"], "f4": quote["change"],
                    "f5": quote["volume"], "f6": quote["amount"], "f8": safe_float(fields[38]),
                    "f9": quote["pe"], "f15": quote["high"], "f16": quote["low"],
                    "f21": quote["marketCap"] * 100_000_000, "f23": quote["pb"],
                    "f124": timestamp, "f185": 0, "f186": 0,
                })
        except Exception as exc:
            print(f"Tencent resonance fallback batch failed: {exc}")
    return rows, latest_timestamp

def get_market_sentiment_helper():
    try:
        date_str = datetime.now().strftime('%Y%m%d')

        # 1. Total Volume & Up/Down Counts
        spot_df = ak.stock_zh_a_spot()
        spot_df['changepercent'] = pd.to_numeric(spot_df['涨跌幅'], errors='coerce').fillna(0)
        spot_df['amount'] = pd.to_numeric(spot_df['成交额'], errors='coerce').fillna(0)

        up = len(spot_df[spot_df['changepercent'] > 0])
        down = len(spot_df[spot_df['changepercent'] < 0])
        flat = len(spot_df[spot_df['changepercent'] == 0])
        limit_up = len(spot_df[spot_df['changepercent'] >= 9.8])
        limit_down = len(spot_df[spot_df['changepercent'] <= -9.8])
        total_amount = spot_df['amount'].sum() / 100000000 # in billions (亿)

        # 2. Limit Up Ladder & Yesterday's Performance (Disabled to prevent sequential HTTP anti-scraping firewall blocks)
        ladder = {}
        prev_zt_avg = 0.0

        return {
            "up": up,
            "down": down,
            "flat": flat,
            "limitUp": limit_up,
            "limitDown": limit_down,
            "totalVolume": round(total_amount, 2),
            "ladder": ladder,
            "prevZtAvg": round(prev_zt_avg, 2)
        }
    except Exception as e:
        print(f"Market sentiment error: {e}")
        return {}

def get_pe_pb_limits(sector_name: str) -> tuple[float, float]:
    growth_sectors = ['半导体', '电子', '芯片', '消费电子', '软件', '计算机', '电池', '光伏', '医疗器械', '生物制品', '制药', '医疗研发外包', '医药', '化学制药', '中药', '军工', '航天', '通信']
    cyclical_sectors = ['银行', '煤炭', '钢铁', '水泥', '房地产', '港口', '航运', '石油', '金属', '公路', '电力']

    if any(g in sector_name for g in growth_sectors):
        return 80.0, 8.0
    if any(c in sector_name for c in cyclical_sectors):
        return 12.0, 1.2
    return 40.0, 4.5

async def evaluate_stock_resonance(item: dict, sector_name: str):
    market_code = "sh" if item.get("f13") == 1 else "sz"
    if item.get("f13") == 2:
        market_code = "bj"
    code = item.get("f12", "")
    symbol = f"{market_code}{code}"

    pe = safe_float(item.get("f9"))
    pb = safe_float(item.get("f23"))
    changePercent = safe_float(item.get("f3"))
    turnover = safe_float(item.get("f8"))
    marketCap = safe_float(item.get("f21")) / 100000000.0
    netProfitGrowth = safe_float(item.get("f185"))
    revenueGrowth = safe_float(item.get("f186"))

    change_ok = changePercent >= 2.0
    turnover_ok = 2.0 <= turnover < 18.0
    mcap_ok = marketCap >= 50.0

    if not (change_ok and turnover_ok and mcap_ok):
        return None

    maxPe, maxPb = get_pe_pb_limits(sector_name)

    pe_ok = 0 < pe < maxPe
    pb_ok = 0 < pb < maxPb

    if not (pe_ok and pb_ok):
        return None

    async with kline_semaphore:
        try:
            klines = await fetch_kline_from_sina(symbol, "day", 70)
            if not klines or len(klines) < 50:
                return None

            closes = [safe_float(k[2]) for k in klines]
            highs = [safe_float(k[3]) for k in klines]
            lows = [safe_float(k[4]) for k in klines]
            current_price = safe_float(klines[-1][2])

            # MA check
            ma5 = sum(closes[-5:]) / 5.0
            ma10 = sum(closes[-10:]) / 10.0
            ma20 = sum(closes[-20:]) / 20.0
            ma60 = sum(closes[-60:]) / 60.0 if len(closes) >= 60 else 0.0

            ma_bullish = False
            if current_price > ma20 and ma5 > ma10:
                if ma60 == 0.0 or ma20 > ma60:
                    ma_bullish = True

            if not ma_bullish:
                return None

            # POC Breakout check
            poc_breakout = True
            h_max = max(highs[-50:])
            l_min = min(lows[-50:])
            if h_max > l_min:
                bin_width = (h_max - l_min) / 20.0
                bins = [0.0] * 20
                for k in klines[-50:]:
                    c = safe_float(k[2])
                    v = safe_float(k[5])
                    bin_idx = int((c - l_min) / bin_width)
                    if bin_idx >= 20: bin_idx = 19
                    elif bin_idx < 0: bin_idx = 0
                    bins[bin_idx] += v
                poc_idx = bins.index(max(bins))
                poc_high = l_min + (poc_idx + 1) * bin_width
                poc_breakout = current_price >= poc_high

            if not poc_breakout:
                return None

            return {
                "symbol": symbol,
                "code": code,
                "name": item.get("f14", ""),
                "price": safe_float(item.get("f2")),
                "change": safe_float(item.get("f4")),
                "changePercent": changePercent,
                "volume": safe_float(item.get("f5")),
                "amount": safe_float(item.get("f6")),
                "high": safe_float(item.get("f15")),
                "low": safe_float(item.get("f16")),
                "pe": pe,
                "pb": pb,
                "marketCap": marketCap,
                "turnover": turnover,
                "netProfitGrowth": netProfitGrowth,
                "revenueGrowth": revenueGrowth,
                "maxPe": maxPe,
                "maxPb": maxPb,
                "maBullish": ma_bullish,
                "pocBreakout": poc_breakout,
                "sectorName": sector_name
            }
        except Exception as exc:
            print(f"Resonance evaluation failed for {symbol}: {exc}")
            return None

async def load_or_build_sector_map():
    global stock_to_sectors, sector_map_meta
    await asyncio.sleep(5)
    refresh_delay = 2
    if os.path.exists(SECTOR_MAP_PATH):
        try:
            with open(SECTOR_MAP_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict) and data:
                    stock_to_sectors = data
                    sector_map_meta = {
                        "status": "ready" if len(data) >= MIN_HEALTHY_SECTOR_MAP_STOCKS else "degraded",
                        "source": "local-cache",
                        "updatedAt": datetime.fromtimestamp(os.path.getmtime(SECTOR_MAP_PATH)).isoformat(timespec="seconds"),
                        "lastError": None,
                    }
                    print(f"Loaded sector stock map from file: {len(stock_to_sectors)} stocks mapped.")
                    refresh_delay = 600 if len(stock_to_sectors) >= MIN_HEALTHY_SECTOR_MAP_STOCKS else 2
                    if refresh_delay == 2:
                        print("Sector stock map is incomplete; scheduling an early safe rebuild.")
        except Exception as e:
            print(f"Failed to load sector map: {e}")

    while True:
        accepted = await build_sector_map_background(delay_start=refresh_delay)
        # Failed/incomplete providers are retried without requiring a process
        # restart; once healthy, refresh gently to avoid provider pressure.
        refresh_delay = 21_600 if accepted else 300

async def build_sector_map_background(delay_start=2):
    global stock_to_sectors, sector_map_meta, http_client
    print(f"Starting background sector map builder in {delay_start}s...")
    await asyncio.sleep(delay_start)
    if len(stock_to_sectors) < MIN_HEALTHY_SECTOR_MAP_STOCKS:
        sector_map_meta = {
            **sector_map_meta,
            "status": "rebuilding",
            "updatedAt": datetime.now().isoformat(timespec="seconds"),
        }

    try:
        url = "http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=85&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=f12,f14"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://quote.eastmoney.com/',
            'Connection': 'close'
        }
        response = await http_client.get(url, headers=headers, timeout=5.0)
        data = response.json()
        if "data" not in data or "diff" not in data["data"]:
            print("Failed to fetch sectors list for builder")
            return False

        sectors = data["data"]["diff"]
        new_map = {}
        successful_sectors = 0

        print(f"Mapping stocks for {len(sectors)} sectors...")
        for sec in sectors:
            sec_id = sec.get("f12")
            sec_name = sec.get("f14")
            if not sec_id or not sec_name:
                continue

            sec_url = f"http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=150&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=b:{sec_id}&fields=f12,f13"
            try:
                r = await http_client.get(sec_url, headers=headers, timeout=5.0)
                r.raise_for_status()
                response_data = r.json().get("data") or {}
                diff = response_data.get("diff")
                if not isinstance(diff, list) or not diff:
                    raise ValueError("constituent response is empty")
                successful_sectors += 1
                for item in diff:
                    m_code = "sh" if item.get("f13") == 1 else "sz"
                    if item.get("f13") == 2:
                        m_code = "bj"
                    code = item.get("f12")
                    symbol = f"{m_code}{code}"

                    if symbol not in new_map:
                        new_map[symbol] = []
                    if sec_name not in new_map[symbol]:
                        new_map[symbol].append(sec_name)
            except Exception as e:
                print(f"Failed to fetch constituents for sector {sec_name}: {e}")
            await asyncio.sleep(2.0) # sleep 2.0s to be extremely gentle!

        sector_count = len(sectors)
        success_ratio = successful_sectors / sector_count if sector_count else 0
        existing_count = len(stock_to_sectors)
        candidate_is_healthy = is_sector_map_candidate_healthy(
            existing_count, len(new_map), sector_count, successful_sectors
        )
        if candidate_is_healthy:
            temporary_path = f"{SECTOR_MAP_PATH}.tmp"
            with open(temporary_path, "w", encoding="utf-8") as f:
                json.dump(new_map, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            if os.path.exists(SECTOR_MAP_PATH) and existing_count >= MIN_HEALTHY_SECTOR_MAP_STOCKS:
                shutil.copy2(SECTOR_MAP_PATH, f"{SECTOR_MAP_PATH}.bak")
            os.replace(temporary_path, SECTOR_MAP_PATH)
            stock_to_sectors = new_map
            sector_map_meta = {
                "status": "ready", "source": "eastmoney",
                "updatedAt": datetime.now().isoformat(timespec="seconds"), "lastError": None,
            }
            print(f"Successfully built and saved sector map with {len(stock_to_sectors)} stocks.")
            return True
        else:
            raise RuntimeError(
                "Eastmoney sector map candidate incomplete: "
                f"stocks={len(new_map)}, sector_success={successful_sectors}/{sector_count} "
                f"({success_ratio:.1%}), existing={existing_count}"
            )
    except Exception as e:
        print(f"Eastmoney sector map builder failed, trying Sina fallback: {e}")
        try:
            new_map, sector_count, successful_sectors = await asyncio.to_thread(build_sina_sector_map_sync)
            success_ratio = successful_sectors / sector_count if sector_count else 0
            if len(new_map) < MIN_HEALTHY_SECTOR_MAP_STOCKS or success_ratio < MIN_SECTOR_FETCH_SUCCESS_RATIO:
                raise RuntimeError(
                    f"Sina map incomplete: stocks={len(new_map)}, sectors={successful_sectors}/{sector_count}"
                )
            temporary_path = f"{SECTOR_MAP_PATH}.tmp"
            with open(temporary_path, "w", encoding="utf-8") as f:
                json.dump(new_map, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            if os.path.exists(SECTOR_MAP_PATH) and len(stock_to_sectors) >= MIN_HEALTHY_SECTOR_MAP_STOCKS:
                shutil.copy2(SECTOR_MAP_PATH, f"{SECTOR_MAP_PATH}.bak")
            os.replace(temporary_path, SECTOR_MAP_PATH)
            stock_to_sectors = new_map
            sector_map_meta = {
                "status": "ready", "source": "sina",
                "updatedAt": datetime.now().isoformat(timespec="seconds"),
                "lastError": f"东方财富不可用，已自动切换新浪: {type(e).__name__}",
            }
            print(f"Successfully built Sina fallback sector map with {len(new_map)} stocks.")
            return True
        except Exception as fallback_error:
            sector_map_meta = {
                "status": "degraded", "source": "local-cache" if stock_to_sectors else None,
                "updatedAt": datetime.now().isoformat(timespec="seconds"),
                "lastError": f"东方财富与新浪均失败: {fallback_error}",
            }
            print(f"Sina sector map fallback failed: {fallback_error}")
            return False

async def update_resonance_stocks_loop():
    global cached_resonance_stocks, cached_resonance_meta, stock_to_sectors, http_client
    print("update_resonance_stocks_loop entered, sleeping 40s...")
    await asyncio.sleep(40)
    while True:
        try:
            print("Background scanning for resonance stocks using all A-shares...")

            # Make sure we have the sector map
            if not stock_to_sectors:
                print("Sector map not ready, waiting 10s...")
                await asyncio.sleep(10)
                continue

            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://quote.eastmoney.com/',
                'Connection': 'close'
            }

            # Fetch top 300 A-share stocks sorted by change desc in 3 pages of 100
            stocks = []
            failed_pages = []
            data_source = "eastmoney"
            for p in range(1, 4):
                url = f"http://push2.eastmoney.com/api/qt/clist/get?pn={p}&pz=100&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f12,f13,f14,f2,f3,f4,f5,f6,f8,f9,f15,f16,f21,f23,f124,f185,f186"
                page_data = None
                for attempt in range(1, 4):
                    try:
                        response = await http_client.get(url, headers=headers, timeout=10.0)
                        response.raise_for_status()
                        data = response.json()
                        diff = data.get("data", {}).get("diff")
                        if isinstance(diff, list):
                            page_data = diff
                            break
                        raise ValueError("response does not contain a stock list")
                    except Exception as exc:
                        print(
                            f"A-share page {p} attempt {attempt}/3 failed "
                            f"({type(exc).__name__}: {exc!r})"
                        )
                        if attempt < 3:
                            await asyncio.sleep(0.5 * attempt)
                if page_data is None:
                    failed_pages.append(p)
                else:
                    stocks.extend(page_data)
                await asyncio.sleep(0.3)

            if not stocks:
                try:
                    print("Eastmoney A-share pages unavailable; trying Sina + Tencent fallback...")
                    fallback_symbols = await asyncio.to_thread(fetch_sina_spot_symbols_sync, 300)
                    stocks, _ = await fetch_tencent_resonance_rows(fallback_symbols)
                    if stocks:
                        failed_pages = []
                        data_source = "sina+tencent"
                        print(f"Fallback market snapshot loaded {len(stocks)} stocks.")
                except Exception as fallback_error:
                    print(f"Sina + Tencent resonance fallback failed: {fallback_error}")

            if not stocks:
                cached_resonance_stocks = []
                cached_resonance_meta = {
                    "status": "error",
                    "updatedAt": datetime.now().isoformat(timespec="seconds"),
                    "dataTimestamp": None,
                    "failedPages": failed_pages,
                    "dataSource": None,
                    "message": "东方财富、新浪和腾讯实时股票源均不可用，未展示历史结果",
                }
                print("Failed to fetch A-share stocks (empty list); cleared resonance cache")
                await asyncio.sleep(60)
                continue

            source_timestamps = [int(safe_float(stock.get("f124"))) for stock in stocks]
            source_timestamp = max(source_timestamps, default=0)
            if not is_current_market_timestamp(source_timestamp):
                cached_resonance_stocks = []
                cached_resonance_meta = {
                    "status": "error",
                    "updatedAt": datetime.now().isoformat(timespec="seconds"),
                    "dataTimestamp": None,
                    "failedPages": failed_pages,
                    "message": "数据源尚未更新至今日，未展示历史结果",
                }
                print("A-share source timestamp is not current; cleared resonance cache")
                await asyncio.sleep(60)
                continue
            candidates = []

            for s in stocks:
                m_code = "sh" if s.get("f13") == 1 else "sz"
                if s.get("f13") == 2:
                    m_code = "bj"
                code = s.get("f12")
                symbol = f"{m_code}{code}"

                sec_names = stock_to_sectors.get(symbol, [])
                sec_name = sec_names[0] if sec_names else "其他"

                pe = safe_float(s.get("f9"))
                pb = safe_float(s.get("f23"))
                max_pe, max_pb = get_pe_pb_limits(sec_name)

                changePercent = safe_float(s.get("f3"))
                turnover = safe_float(s.get("f8"))
                marketCap = safe_float(s.get("f21")) / 100000000.0

                if (
                    changePercent >= 2.0
                    and 2.0 <= turnover < 18.0
                    and marketCap >= 50.0
                    and 0 < pe < max_pe
                    and 0 < pb < max_pb
                ):
                    candidates.append((s, sec_name))

            candidate_names = [f"{item[1]}:{item[0].get('f14')}({item[0].get('f12')})" for item in candidates]
            print(f"All A-shares scan found {len(candidates)} candidates matching price criteria: {candidate_names}")

            candidates.sort(key=lambda item: safe_float(item[0].get("f3")), reverse=True)

            resonance_tasks = [
                evaluate_stock_resonance(stock, sec_name)
                for stock, sec_name in candidates[:MAX_RESONANCE_KLINE_CHECKS]
            ]
            results = await asyncio.gather(*resonance_tasks)
            resonance_stocks = [r for r in results if r is not None]

            # The card is a live snapshot, not a rolling recommendation list.
            # Even a partial or empty current scan must replace the previous
            # result so stale symbols are never carried into a new round.
            cached_resonance_stocks = resonance_stocks

            cached_resonance_meta = {
                "status": "partial" if failed_pages else "ok",
                "updatedAt": datetime.now().isoformat(timespec="seconds"),
                "dataTimestamp": datetime.fromtimestamp(source_timestamp).isoformat(timespec="seconds") if source_timestamp else None,
                "failedPages": failed_pages,
                "dataSource": data_source,
                "message": (
                    f"第 {','.join(map(str, failed_pages))} 页暂时不可用，结果来自部分实时样本"
                    if failed_pages else f"实时扫描完成（{data_source}）"
                ),
            }
            print(f"Background updated {len(cached_resonance_stocks)} resonance stocks.")
            await asyncio.sleep(600)
        except Exception as e:
            cached_resonance_stocks = []
            cached_resonance_meta = {
                "status": "error",
                "updatedAt": datetime.now().isoformat(timespec="seconds"),
                "dataTimestamp": None,
                "failedPages": [],
                "message": f"共振扫描异常，未展示历史结果: {type(e).__name__}",
            }
            print(f"Background resonance scanner error: {e}")
            await asyncio.sleep(60)

async def update_sentiment_loop():
    import datetime
    global cached_sentiment
    while True:
        try:
            now = datetime.datetime.now()
            # A-share trading hours: Mon-Fri 9:15-11:40, 13:00-15:10
            is_weekday = now.weekday() < 5
            is_trading_hours = False
            if is_weekday:
                if (now.hour == 9 and now.minute >= 15) or (now.hour == 10) or (now.hour == 11 and now.minute <= 40):
                    is_trading_hours = True
                elif (now.hour == 13) or (now.hour == 14) or (now.hour == 15 and now.minute <= 10):
                    is_trading_hours = True

            if not cached_sentiment or is_trading_hours:
                print("Background updating market sentiment data...")
                loop = asyncio.get_event_loop()
                data = await loop.run_in_executor(None, get_market_sentiment_helper)
                if data:
                    cached_sentiment = data
                    print("Background updated market sentiment successfully.")

            if is_trading_hours:
                await asyncio.sleep(120)
            else:
                await asyncio.sleep(900)
        except Exception as e:
            print(f"Background sentiment updater error: {e}")
            await asyncio.sleep(60)

async def startup_event():
    global http_client, market_refresh_event, background_tasks
    # Market providers are contacted directly.  Ignoring proxy environment
    # variables also avoids malformed NO_PROXY entries (for example ``::1``)
    # preventing the whole application from starting.
    http_client = httpx.AsyncClient(timeout=5.0, trust_env=False)
    market_refresh_event = asyncio.Event()
    background_tasks = [
        asyncio.create_task(market_broadcast_loop(), name="market-broadcaster"),
        asyncio.create_task(update_sentiment_loop(), name="sentiment-updater"),
        asyncio.create_task(update_sector_volume_loop(), name="sector-volume-updater"),
        asyncio.create_task(update_resonance_stocks_loop(), name="resonance-updater"),
        asyncio.create_task(load_or_build_sector_map(), name="sector-map-loader"),
    ]


async def shutdown_event():
    global http_client, background_tasks
    for task in background_tasks:
        task.cancel()
    if background_tasks:
        await asyncio.gather(*background_tasks, return_exceptions=True)
    background_tasks = []
    if http_client:
        await http_client.aclose()
        http_client = None


@app.get("/api/health")
def get_health():
    task_status = {
        task.get_name(): "cancelled" if task.cancelled() else "done" if task.done() else "running"
        for task in background_tasks
    }
    continuous_tasks = {
        "market-broadcaster", "sentiment-updater", "sector-volume-updater", "resonance-updater", "sector-map-loader"
    }
    unhealthy_tasks = [
        name for name in continuous_tasks if task_status.get(name) != "running"
    ]
    return {
        "status": "degraded" if unhealthy_tasks else "ok",
        "connectedClients": len(market_clients),
        "backgroundTasks": task_status,
        "resonance": cached_resonance_meta,
        "sectorCacheReady": cached_sectors is not None,
        "sectorMap": {
            "stockCount": len(stock_to_sectors),
            "healthy": len(stock_to_sectors) >= MIN_HEALTHY_SECTOR_MAP_STOCKS,
            "minimumHealthyStockCount": MIN_HEALTHY_SECTOR_MAP_STOCKS,
            **sector_map_meta,
        },
    }

@app.get("/api/market_sentiment")
def get_market_sentiment():
    global cached_sentiment
    if not cached_sentiment:
        return {
            "up": 0,
            "down": 0,
            "flat": 0,
            "limitUp": 0,
            "limitDown": 0,
            "totalVolume": 0.0,
            "ladder": {},
            "prevZtAvg": 0.0,
            "loading": True
        }
    return cached_sentiment


@app.get("/api/resonance_stocks")
def get_resonance_stocks():
    """HTTP fallback for clients that miss a WebSocket broadcast."""
    return {
        "data": cached_resonance_stocks,
        "meta": cached_resonance_meta,
    }

@app.get("/api/news_summary")
async def get_news_summary(
    symbol: str, name: str = "", price: float = 0, changePercent: float = 0,
    volume: float = 0, amount: float = 0, quoteTime: str = "",
    x_gemini_key: str = Header(None),
):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")
    try:
        stock_identifier = f"{name}({symbol})" if name else symbol
        analysis_time = datetime.now().astimezone().isoformat(timespec="seconds")

        prompt = f"""
<role>你是审慎的A股公告与短期事件研究员。目标是压缩已核验事实，不是迎合多空观点。</role>
<context>
分析时间：{analysis_time}
标的：{stock_identifier}
行情快照：价格={price}，涨跌幅={changePercent}% ，成交量={volume}，成交额={amount}，行情时间={quoteTime or '未知'}
</context>
<research>
必须联网检索，先查巨潮资讯、交易所和公司正式披露，再查监管机构、权威财经媒体，研报只能作为补充。
重点窗口为最近7个自然日；重大事项可回溯30日，但必须标明事件发生日和披露日。至少尝试获得3个独立有效来源。
合并重复转载；来源冲突时以正式公告原文为准。搜索不到不等于“暂无利空/利好”，应写“未检索到可核验信息”。
</research>
<rules>
1. 区分事实方向 factSentiment 与未来1至5个交易日影响 shortTermImpact；好消息可能已计价，坏消息也可能已被预期。
2. 不把股价上涨、大单流入、媒体猜测本身当作公司基本面利好。
3. 每条结论附日期和来源序号；没有来源的推断必须标“推断”。
4. summary按“已确认事实 / 潜在影响 / 反向风险 / 尚待核验”四段输出，每段最多3条。
5. confidence只代表证据质量和一致性，不代表上涨概率。证据少于2个有效来源时不得超过40。
</rules>
<output>
只返回严格合法JSON，不要代码块：
{{
  "summary": "精炼Markdown正文",
  "sentiment": "POSITIVE|NEUTRAL|NEGATIVE|UNCERTAIN",
  "factSentiment": "POSITIVE|NEUTRAL|NEGATIVE|MIXED|UNCERTAIN",
  "shortTermImpact": "POSITIVE|NEUTRAL|NEGATIVE|MIXED|UNCERTAIN",
  "pricedInRisk": "LOW|MEDIUM|HIGH|UNKNOWN",
  "confidence": 0,
  "asOf": "ISO 8601",
  "searchStatus": "complete|partial|failed",
  "sources": [{{"title":"", "url":"https://...", "publishedAt":"", "sourceType":"公告/交易所/监管/媒体/研报", "keyFact":""}}]
}}
</output>
"""
        last_error = None

        for model_name in AI_MODEL_PRIORITY:
            try:
                ai_result = await asyncio.to_thread(
                    generate_ai_content, x_gemini_key, model_name, prompt, NEWS_SUMMARY_SCHEMA
                )
                response_text = ai_result.text
                import json
                import re
                try:
                    text = response_text.strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```(?:json)?\n", "", text)
                        text = re.sub(r"\n```$", "", text)
                    res_data = json.loads(text)
                    return finalize_news_summary(res_data, ai_result, model_name, analysis_time)
                except json.JSONDecodeError:
                    return finalize_news_summary(
                        {"summary": response_text, "sentiment": "UNCERTAIN", "searchStatus": "partial"},
                        ai_result, model_name, analysis_time,
                    )
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e
                if is_non_retryable_ai_error(e):
                    break

        return {"summary": f"新闻总结失败: {describe_ai_error(last_error)}", "sentiment": "UNCERTAIN", "searchStatus": "failed", "confidence": 0, "sources": []}
    except Exception as e:
        print(f"News summary error: {e}")
        return {"summary": f"总结失败: {str(e)}", "sentiment": "UNCERTAIN", "searchStatus": "failed", "confidence": 0, "sources": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
