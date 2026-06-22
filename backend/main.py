import asyncio
import time
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
from google import genai
from google.genai import types
import os
import akshare as ak
import pandas as pd
from datetime import datetime

# Unset proxies to prevent akshare connection issues
for k in ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY']:
    if k in os.environ:
        del os.environ[k]

# Global http client and caches
http_client: httpx.AsyncClient = None

cached_sectors = None
last_sectors_fetch_time = 0

cached_indices = None
last_indices_fetch_time = 0

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global store for trend data and previous prices for anomaly detection
stock_history: Dict[str, List[float]] = {}
prev_prices: Dict[str, float] = {}
prev_amounts: Dict[str, float] = {}
stock_states: Dict[str, dict] = {}

import json

async def fetch_sectors():
    global http_client, cached_sectors, last_sectors_fetch_time
    now = time.time()
    if cached_sectors and (now - last_sectors_fetch_time < 15):
        return cached_sectors
    url = "http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=80&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:90+t:2+f:!50&fields=f12,f14,f3,f109,f110"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        response = await http_client.get(url, headers=headers, timeout=3.0)
        data = response.json()
        sectors = []
        if "data" in data and "diff" in data["data"]:
            for item in data["data"]["diff"]:
                sectors.append({
                    "id": str(item.get("f12", "")),
                    "name": str(item.get("f14", "")),
                    "changePercent": float(item.get("f3", 0.0) or 0.0),
                    "change5d": float(item.get("f109", 0.0) or 0.0),
                    "change20d": float(item.get("f110", 0.0) or 0.0)
                })
        cached_sectors = sectors
        last_sectors_fetch_time = now
        return sectors
    except Exception as e:
        print("Fetch sectors error:", e)
        return cached_sectors or []

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
                "price": float(data[3]),
                "change": float(data[4]),
                "changePercent": float(data[5]),
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
            code_prefix = parts[0].split('_')[1] # sh600519
            data_str = parts[1].strip('"')
            fields = data_str.split('~')
            if len(fields) > 35:
                name = fields[1]
                code = fields[2]
                price = float(fields[3])
                prev_close = float(fields[4])
                
                try:
                    comp = fields[34].split('/')
                    volume = float(comp[1]) * 100 
                    amount = float(comp[2])
                except:
                    volume = float(fields[6]) * 100
                    amount = float(fields[37]) * 10000
                
                change = float(fields[31])
                change_percent = float(fields[32])
                limit_up_price = float(fields[47]) if fields[47] else 0
                limit_down_price = float(fields[48]) if fields[48] else 0
                
                if code_prefix not in stock_states:
                    stock_states[code_prefix] = {"is_zt": False, "is_dt": False}
                state = stock_states[code_prefix]
                
                # 1. Anomaly Detection (Limit Up / Down & Broken Board)
                if limit_up_price > 0 and price >= limit_up_price:
                    buy1_price = float(fields[9])
                    buy1_vol = float(fields[10]) # in hands (100 shares)
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
                    sell1_price = float(fields[19])
                    sell1_vol = float(fields[20])
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

                results.append({
                    "code": code,
                    "symbol": code_prefix,
                    "name": name,
                    "price": price,
                    "high": float(fields[33]),
                    "low": float(fields[34]),
                    "change": change,
                    "changePercent": change_percent,
                    "volume": volume,
                    "amount": amount,
                    "pe": float(fields[39]) if fields[39] else 0.0,
                    "pb": float(fields[46]) if fields[46] else 0.0,
                    "marketCap": float(fields[45]) if fields[45] else 0.0,
                    "trend": list(stock_history[code_prefix])
                })
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
                        except:
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
            r0_net = float(item.get("r0_net", 0))
            r1_net = float(item.get("r1_net", 0))
            main_net_amount = r0_net + r1_net
            return {
                "data": {
                    "netAmount": main_net_amount,
                    "ratioAmount": float(item.get("ratioamount", 0))
                }
            }
    except Exception as e:
        print(f"Fundflow error: {e}")
        return {"data": None}
    return {"data": None}

@app.get("/api/sector/{sector_id}")
async def get_sector_stocks(sector_id: str):
    global http_client
    # Fetch constituent stocks for a given sector from EastMoney
    url = f"http://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=40&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=b:{sector_id}&fields=f12,f14,f2,f3,f4,f5,f6,f15,f16,f1,f9,f23,f21,f8"
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        response = await http_client.get(url, headers=headers, timeout=5.0)
        data = response.json()
        results = []
        if "data" in data and "diff" in data["data"]:
            for item in data["data"]["diff"]:
                market_code = "sh" if item.get("f1") == 1 else "sz"
                code = item.get("f12", "")
                
                try:
                    pe = float(item.get("f9") or 0.0)
                except:
                    pe = 0.0
                try:
                    pb = float(item.get("f23") or 0.0)
                except:
                    pb = 0.0
                try:
                    marketCap = float(item.get("f21") or 0.0) / 100000000
                except:
                    marketCap = 0.0
                try:
                    turnover = float(item.get("f8") or 0.0)
                except:
                    turnover = 0.0
                    
                results.append({
                    "symbol": f"{market_code}{code}",
                    "code": code,
                    "name": item.get("f14", ""),
                    "price": float(item.get("f2", 0.0) or 0.0),
                    "change": float(item.get("f4", 0.0) or 0.0),
                    "changePercent": float(item.get("f3", 0.0) or 0.0),
                    "volume": float(item.get("f5", 0.0) or 0.0),
                    "amount": float(item.get("f6", 0.0) or 0.0),
                    "high": float(item.get("f15", 0.0) or 0.0),
                    "low": float(item.get("f16", 0.0) or 0.0),
                    "pe": pe,
                    "pb": pb,
                    "marketCap": marketCap,
                    "turnover": turnover
                })
        return {"data": results}
    except Exception as e:
        print(f"Sector fetch error: {e}")
        return {"data": []}

async def get_kline_data(symbol: str, period: str = "day", limit: int = 100):
    global http_client
    # period: day, week, month
    if symbol.startswith("sh") or symbol.startswith("sz"):
        req_symbol = symbol
    else:
        req_symbol = f"sh{symbol}" if symbol.startswith("6") else f"sz{symbol}"
    
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
async def analyze_stock(symbol: str, name: str = "", price: str = "", changePercent: str = "", pe: str = "", pb: str = "", marketCap: str = "", x_gemini_key: str = Header(None)):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")
    try:
        client = genai.Client(api_key=x_gemini_key)
        stock_identifier = f"{name}({symbol})" if name else symbol
        
        current_status = ""
        if price and changePercent:
            current_status = f"该股当前最新价为 {price}，今日涨跌幅为 {changePercent}%。"
            
        fundamentals = ""
        if pe and pb and marketCap:
            fundamentals = f"\n【核心基本面】：当前市盈率(PE)为 {pe}，市净率(PB)为 {pb}，流通市值为 {marketCap} 亿元。"

        # Fetch recent historical data (last 40 days) for AI context to compute indicators
        kline_context = ""
        recent_klines = await get_kline_data(symbol, "day", 40)
        if recent_klines and len(recent_klines) > 0:
            closes = [float(k[2]) for k in recent_klines]
            
            ma5 = calculate_ma(closes, 5)
            ma20 = calculate_ma(closes, 20)
            dif, dea, macd = calculate_macd(closes)
            
            recent_10 = recent_klines[-10:]
            kline_text = ""
            for i, k in enumerate(recent_10):
                idx = len(recent_klines) - 10 + i
                c = closes[idx]
                m5 = f"{ma5[idx]:.2f}" if ma5[idx] else "-"
                m20 = f"{ma20[idx]:.2f}" if ma20[idx] else "-"
                md = f"{macd[idx]:.2f}" if macd and len(macd) > idx else "-"
                kline_text += f"{k[0]}(收:{c}, MA5:{m5}, MA20:{m20}, MACD柱:{md}) "
                
            kline_context = f"\n【近10日量价与指标形态】：\n{kline_text}"

        prompt = f"""
作为拥有15年A股长线价值投资与波段趋势跟踪经验的顶尖操盘手，请对股票 【{stock_identifier}】 进行深度复盘与推演。
{current_status}{fundamentals}{kline_context}

请务必利用你强大的联网搜索能力，检索该股票最新的新闻、公告和行业研报。
基于真实的新闻、基本面估值（PE/PB）、长短期量价形态及A股市场风格的深刻理解，提供以下高密度干货：

1. 【基本面与估值诊断】：结合当前的PE、PB和市值，判断该股目前是否处于历史相对底部的击球区？核心护城河或中长线逻辑是什么？
2. 【资金与技术定性】：结合近十日量价及MACD背离情况，判断中线级别的主力意图（吸筹、洗盘、主升浪还是派发）？
3. 【关键点位】：结合MA5和MA20均线，给出一个中短线的强支撑位和强压力位。
4. 【操作剧本】：如果作为长线持仓或大波段操作，未来一周甚至一个月的操作建议是什么？

要求语言极度精炼、犀利，多用A股实战术语，绝对不要废话和免责声明。

【强制格式要求】
你必须返回一个严格合法的 JSON 对象，不要包含 markdown 代码块(如 ```json)包装，直接返回 JSON 字符串。格式如下：
{{
  "analysis": "上面要求的1到4点的文本分析，可以包含换行符（注意转义）",
  "support": 14.50,  // (可选，数字类型) 从你的分析中提取的具体强支撑位价格，如果没有明确支撑位请返回 null
  "resistance": 15.80, // (可选，数字类型) 从你的分析中提取的具体强压力位价格，如果没有明确压力位请返回 null
  "winRate": "B+" // (字符串) 给出中长线胜率评级，必须是 "A" (强烈看多), "B+" (谨慎看多), "B-" (观望), "C" (看空) 之一
}}
"""
        models_to_try = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
        last_error = None
        
        for model_name in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[{"google_search": {}}],
                    )
                )
                import json
                import re
                try:
                    text = response.text.strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```(?:json)?\n", "", text)
                        text = re.sub(r"\n```$", "", text)
                    res_data = json.loads(text)
                    return res_data
                except json.JSONDecodeError:
                    return {"analysis": response.text, "support": None, "resistance": None, "winRate": None}
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e

        return {"analysis": f"AI分析失败: 所有模型均无响应，系统高负载，请稍后再试。最后错误: {str(last_error)}"}
    except Exception as e:
        print(f"Gemini Error: {e}")
        return {"analysis": f"AI分析失败: 请检查您的 API Key 是否有效。({str(e)})"}

@app.post("/api/review")
async def generate_market_review(data: dict, x_gemini_key: str = Header(None)):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")
    
    stocks_summary = data.get("stocks", [])
    indices_summary = data.get("indices", [])
    
    try:
        client = genai.Client(api_key=x_gemini_key)
        
        # Prepare context for Gemini
        context = "【今日大盘指数】\n"
        for idx in indices_summary:
            context += f"- {idx['name']}: {idx['price']} ({idx['changePercent']}%)\n"
            
        # Fetch technical context for Shanghai Composite Index (sh000001)
        sh_klines = await get_kline_data("sh000001", "day", 40)
        if sh_klines and len(sh_klines) > 0:
            sh_closes = [float(k[2]) for k in sh_klines]
            sh_ma5 = calculate_ma(sh_closes, 5)
            sh_ma20 = calculate_ma(sh_closes, 20)
            _, _, sh_macd = calculate_macd(sh_closes)
            
            recent_sh = sh_klines[-5:]
            context += "\n【上证指数近5日量价及技术形态】\n"
            for i, k in enumerate(recent_sh):
                idx = len(sh_klines) - 5 + i
                c = sh_closes[idx]
                m5 = f"{sh_ma5[idx]:.2f}" if sh_ma5[idx] else "-"
                m20 = f"{sh_ma20[idx]:.2f}" if sh_ma20[idx] else "-"
                md = f"{sh_macd[idx]:.2f}" if sh_macd and len(sh_macd) > idx else "-"
                context += f"- {k[0]}: 收盘{c}, MA5:{m5}, MA20:{m20}, MACD柱:{md}, 成交量:{k[5]}\n"
        
        context += "\n【自选股表现详情】\n"
        for s in stocks_summary[:15]: # Limit to top 15 to avoid token bloat
            context += f"- {s['name']}({s['code']}): 现价{s['price']}, 涨跌幅{s['changePercent']}%, 成交额{s['amount']/100000000:.2f}亿\n"
            
        global cached_sentiment
        sentiment_data = cached_sentiment
        
        if sentiment_data:
            context += "\n【全市场真实情绪扫描】\n"
            context += f"- 上涨/下跌/平盘: {sentiment_data.get('up', '未知')} / {sentiment_data.get('down', '未知')} / {sentiment_data.get('flat', '未知')}\n"
            context += f"- 涨跌停家数: 涨停 {sentiment_data.get('limitUp', '未知')} 家 / 跌停 {sentiment_data.get('limitDown', '未知')} 家\n"
            context += f"- 昨日涨停今日平均收益: {sentiment_data.get('prevZtAvg', '未知')}%\n"
            context += f"- 连板天梯分布: {sentiment_data.get('ladder', {})}\n"
            context += f"- 两市总成交额: {sentiment_data.get('totalVolume', '未知')} 亿\n"
            
        prompt = f"""
你是国内顶级游资圈的操盘手与量化研究员，深谙A股的博弈逻辑、情绪周期与资金轮动。现在是盘后复盘时间。
请你基于以下绝对真实的今日收盘数据、全市场情绪扫描及上证指数近5日技术走势（均线与MACD），务必利用你的联网搜索能力获取今日最新市场消息，为我生成一份【极客交易员专属】的深度复盘策略报告。

{context}

请严格使用Markdown格式，输出一份干货满满、逻辑严密的复盘与推演报告。不要任何虚头巴脑的开场白或免责声明。

## 🎯 盘面情绪与大势技术定调
* **情绪锚定**: 根据全市场上涨下跌比、涨跌停家数、连板天梯厚度及今日重大新闻，一针见血地点评今日是冰点、混沌、修复还是高潮？属于缩量博弈还是增量逼空？
* **技术定调**: 结合上证指数近期的MA5/MA20及MACD量能柱变化，判断大盘目前处于什么技术级别（破位、企稳、主升浪还是顶背离）？
* **主力路径**: 判断今日赚钱效应的核心主线在哪个方向？风格偏向于权重搭台还是游资炒妖？

## 🛡️ 宏观仓位风控建议 (AI Position Manager)
* **长线仓位指导**: 结合全市场情绪温度与技术定调，给出明确的长线与大波段仓位建议（例如：“当前处于冰点退潮期，建议长线仓位控制在3成以下”，“主升浪确立，可加仓至7成”等），并说明防守或进攻的理由。切忌模棱两可。

## ⚔️ 持仓股池（自选）逐个击破与体检
请对**以上提供的每一只自选股**逐一进行简短但犀利的点评（结合其今日涨跌幅及最新驱动逻辑）：
* [股票名称]: (结合该股近期实际技术走势，如：今日放量突破/缩量回踩，受xx消息刺激，主力意图如何，明日关注xx支撑/阻力位...)
（务必覆盖列表中的所有重点股票，如果表现平庸也请指出原因；如果有明显的“领头羊”或“拖油瓶”请重点剖析其背后的资金逻辑和风险点）

## 🔮 次日沙盘推演与操盘纪律
* **大盘剧本**: 预测明日指数可能的走势路径（如：沿MA5惯性冲高、受制MA20探底回升、或者MACD死叉后的横盘震荡）。
* **应对策略**: 针对明日的剧本，给出一套可执行的短期策略（如：围绕核心主线做T；或者防守反击，关注低位补涨）。
* **纪律红线**: 结合当前行情特点，设定一条绝对不可触碰的交易红线（例如：严禁追高后排跟风股、严禁抄底左侧破位股等）。

要求：语言极度犀利、专业，多使用A股实战技术术语（如：卡位、金叉死叉、量价背离、均线多头排列、水下捞等）。分析必须有深度、有依据，拒绝平庸的股评家套话。
"""
        models_to_try = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
        last_error = None
        
        for model_name in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[{"google_search": {}}],
                    )
                )
                return {"review": response.text}
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e
                
        return {"review": f"复盘报告生成失败: 所有模型均无响应，系统高负载，请稍后再试。最后错误: {str(last_error)}"}
    except Exception as e:
        print(f"Gemini Review Error: {e}")
        return {"review": f"复盘报告生成失败: {str(e)}"}

@app.websocket("/ws/market")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    # Default watchlist
    current_symbols = [
        "sh600519", "sz300750", "sh601318", "sz002594", 
        "sh601127", "sh601138", "sz000001", "sh600036",
        "sz300059", "sh600030"
    ]
    
    update_event = asyncio.Event()
    
    async def receiver():
        nonlocal current_symbols
        try:
            while True:
                data = await websocket.receive_json()
                if data.get("type") == "pong":
                    pass
                elif data.get("type") == "subscribe":
                    current_symbols = data.get("symbols", [])
                    update_event.set()
        except WebSocketDisconnect:
            pass

    async def sender():
        try:
            while True:
                await websocket.send_json({"type": "ping", "timestamp": int(time.time() * 1000)})
                
                # Fetch indices, market data, and sectors in parallel
                indices_task = asyncio.create_task(fetch_indices())
                market_task = asyncio.create_task(fetch_tencent_data(current_symbols))
                sectors_task = asyncio.create_task(fetch_sectors())
                
                indices, (market_data, alerts), sectors = await asyncio.gather(indices_task, market_task, sectors_task)
                
                payload = {
                    "type": "market_data",
                    "payload": market_data,
                    "indices": indices,
                    "alerts": alerts,
                    "sectors": sectors
                }
                
                await websocket.send_json(payload)
                
                try:
                    await asyncio.wait_for(update_event.wait(), timeout=3.0)
                    update_event.clear()
                except asyncio.TimeoutError:
                    pass
        except Exception:
            pass

    # Run both sender and receiver concurrently
    try:
        receive_task = asyncio.create_task(receiver())
        send_task = asyncio.create_task(sender())
        done, pending = await asyncio.wait(
            [receive_task, send_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except Exception as e:
        print(f"Connection error: {e}")

@app.post("/api/evaluate_thesis")
async def evaluate_thesis(payload: dict, x_gemini_key: str = Header(None)):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")
        
    symbol = payload.get("symbol")
    name = payload.get("name")
    thesis = payload.get("thesis")
    
    if not symbol or not thesis:
        raise HTTPException(status_code=400, detail="Symbol and thesis are required")

    try:
        client = genai.Client(api_key=x_gemini_key)
        stock_identifier = f"{name}({symbol})" if name else symbol
        
        prompt = f"""
作为一名长线价值投资的守护者，您的任务是对长线持仓股票【{stock_identifier}】的买入逻辑进行“周末体检”和重估。

【用户当初买入的核心逻辑/理由】：
{thesis}

请利用你的联网搜索能力，检索该股票、其所属行业最近一周的重大新闻、财报披露、以及宏观政策变化。
基于最新的真实信息，严格、客观地评估用户当初的买入逻辑是否仍然成立：

1. 【逻辑是否被证伪】：当初的预期是否已经实现、正在顺利推进、还是被突发事件彻底破坏？
2. 【新出现的黑天鹅/催化剂】：近期是否有当初没考虑到的重大风险或超预期利好？
3. 【长线持仓建议】：基于基本面逻辑的演变，建议“继续坚定持有”、“减仓观望”还是“果断平仓清仓”？

要求语言极度客观、理性，不要安慰用户，如果逻辑已经破产请直接指出风险。

【强制格式要求】
你必须返回一个严格合法的 JSON 对象，不要包含 markdown 代码块包装，直接返回 JSON 字符串。格式如下：
{{
  "evaluation": "上面要求的1到3点的综合评估报告（可含换行符）",
  "status": "HOLD" // 必须是 "HOLD" (逻辑仍在,建议持有), "WARNING" (逻辑松动,建议减仓/观望), "SELL" (逻辑证伪,建议平仓) 之一
}}
"""
        models_to_try = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-3-flash']
        last_error = None
        
        for model_name in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[{"google_search": {}}],
                    )
                )
                import json
                import re
                try:
                    text = response.text.strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```(?:json)?\n", "", text)
                        text = re.sub(r"\n```$", "", text)
                    res_data = json.loads(text)
                    return res_data
                except json.JSONDecodeError:
                    return {"evaluation": response.text, "status": "WARNING"}
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e

        return {"evaluation": f"逻辑重估失败: 请检查网络或 API Key 状态。最后错误: {str(last_error)}", "status": "WARNING"}

    except Exception as e:
        print(f"Evaluate thesis error: {e}")
        return {"evaluation": "系统错误，请重试。", "status": "WARNING"}

cached_sentiment = {}

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
        
        # 2. Limit Up Ladder & Yesterday's Performance
        ladder = {}
        try:
            zt_df = ak.stock_zt_pool_em(date=date_str)
            limit_up = len(zt_df) # Use more accurate pool size if available
            counts = zt_df['连板数'].value_counts().to_dict()
            ladder = {str(k): int(v) for k, v in counts.items()}
        except Exception as e:
            print("ZT pool error:", e)
            
        prev_zt_avg = 0.0
        try:
            prev_zt_df = ak.stock_zt_pool_previous_em(date=date_str)
            if len(prev_zt_df) > 0 and '涨跌幅' in prev_zt_df.columns:
                prev_zt_avg = float(prev_zt_df['涨跌幅'].mean())
        except Exception as e:
            print("Prev ZT pool error:", e)
            
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

@app.on_event("startup")
async def startup_event():
    global http_client
    http_client = httpx.AsyncClient(timeout=5.0)
    asyncio.create_task(update_sentiment_loop())

@app.on_event("shutdown")
async def shutdown_event():
    global http_client
    if http_client:
        await http_client.aclose()

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

@app.get("/api/news_summary")
async def get_news_summary(symbol: str, name: str = "", x_gemini_key: str = Header(None)):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")
    try:
        client = genai.Client(api_key=x_gemini_key)
        stock_identifier = f"{name}({symbol})" if name else symbol
        
        prompt = f"""
请使用你的联网搜索功能，检索股票【{stock_identifier}】最近一周的重大新闻、公司公告、财报或行业研报。
基于检索到的真实信息，为交易员生成一份极其精炼的“太长不看 (TL;DR)”摘要，帮助交易员快速评估该股最近的动态。

要求输出包含以下三部分（用 Markdown 列表呈现）：
1. 🔴【利空因素/警示】：最近有哪些潜在利空、减持、解禁或负面消息？如果没有，明确写“暂无”。
2. 🟢【利好因素/催化】：最近有哪些业绩超预期、新订单、政策利好、或者是资金青睐？如果没有，明确写“暂无”。
3. 🔵【关键经营/财务变动】：最近公司有什么业务调整、重大合同、高管变动等中性关键事项？

最后给出综合情感判定（Positive, Neutral, Negative 之一）。

【强制格式要求】
你必须返回一个严格合法的 JSON 对象，不要包含 markdown 代码块包装，直接返回 JSON 字符串。格式如下：
{{
  "summary": "以Markdown格式排版的上述三部分分析（利空/利好/关键变动，用小标题或列表，注意换行符转义）",
  "sentiment": "POSITIVE" // 必须是 "POSITIVE", "NEUTRAL", "NEGATIVE" 之一
}}
"""
        models_to_try = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
        last_error = None
        
        for model_name in models_to_try:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        tools=[{"google_search": {}}],
                    )
                )
                import json
                import re
                try:
                    text = response.text.strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```(?:json)?\n", "", text)
                        text = re.sub(r"\n```$", "", text)
                    res_data = json.loads(text)
                    return res_data
                except json.JSONDecodeError:
                    sentiment = "NEUTRAL"
                    if "利好" in response.text or "POSITIVE" in response.text.upper():
                        sentiment = "POSITIVE"
                    elif "利空" in response.text or "NEGATIVE" in response.text.upper():
                        sentiment = "NEGATIVE"
                    return {"summary": response.text, "sentiment": sentiment}
            except Exception as e:
                print(f"Model {model_name} failed: {e}")
                last_error = e

        return {"summary": f"新闻总结失败: 所有模型均无响应。最后错误: {str(last_error)}", "sentiment": "NEUTRAL"}
    except Exception as e:
        print(f"News summary error: {e}")
        return {"summary": f"总结失败: {str(e)}", "sentiment": "NEUTRAL"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
