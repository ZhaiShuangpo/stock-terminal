import asyncio
import time
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
from google import genai
from google.genai import types

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

import json

async def fetch_sectors():
    url = "http://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=3.0)
            response.encoding = 'gbk'
            text = response.text
            json_str = text.split('=', 1)[1].strip().strip(';')
            data = json.loads(json_str)
            sectors = []
            for k, v in data.items():
                parts = v.split(',')
                sectors.append({
                    "name": parts[1],
                    "changePercent": float(parts[5]),
                    "amount": float(parts[7]),
                    "topStockName": parts[12],
                    "topStockChange": float(parts[9])
                })
            sectors.sort(key=lambda x: x["changePercent"], reverse=True)
            return sectors[:5]
        except:
            return []

async def fetch_indices():
    indices = ["s_sh000001", "s_sz399001", "s_sz399006", "s_sh000300"]
    url = f"http://qt.gtimg.cn/q={','.join(indices)}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=2.0)
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
            return results
        except:
            return []

async def fetch_tencent_data(symbols: List[str]):
    if not symbols:
        return [], []
    url = f"http://qt.gtimg.cn/q={','.join(symbols)}"
    alerts = []
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=3.0)
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
                    
                    # Anomaly Detection (Simple Jump Detection)
                    if code_prefix in prev_prices:
                        old_p = prev_prices[code_prefix]
                        if old_p > 0:
                            jump = (price - old_p) / old_p * 100
                            if abs(jump) >= 0.5: # 0.5% jump in 3 seconds is significant
                                alerts.append({
                                    "time": time.strftime("%H:%M:%S"),
                                    "symbol": code_prefix,
                                    "name": name,
                                    "type": "急速拉升" if jump > 0 else "快速跳水",
                                    "value": f"{'+' if jump > 0 else ''}{jump:.2f}%"
                                })
                    prev_prices[code_prefix] = price

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
                        "change": change,
                        "changePercent": change_percent,
                        "volume": volume,
                        "amount": amount,
                        "trend": list(stock_history[code_prefix])
                    })
            return results, alerts
        except Exception as e:
            print(f"Error fetching data: {e}")
            return [], []

@app.get("/api/search")
async def search_stock(q: str):
    if not q:
        return {"results": []}
    url = f"https://smartbox.gtimg.cn/s3/?v=2&q={q}&t=all"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=3.0)
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
    if not symbol:
        return {"data": []}
    url = f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={symbol}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=3.0)
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
    if not symbol:
        return {"data": None}
    url = f"http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_lscjfb?page=1&num=1&sort=opendate&asc=0&daima={symbol}"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=3.0)
            data = response.json()
            if data and len(data) > 0:
                item = data[0]
                return {
                    "data": {
                        "netAmount": float(item.get("netamount", 0)),
                        "ratioAmount": float(item.get("ratioamount", 0))
                    }
                }
        except Exception as e:
            print(f"Fundflow error: {e}")
            return {"data": None}
    return {"data": None}

async def get_kline_data(symbol: str, period: str = "day", limit: int = 100):
    # period: day, week, month
    if symbol.startswith("sh") or symbol.startswith("sz"):
        req_symbol = symbol
    else:
        req_symbol = f"sh{symbol}" if symbol.startswith("6") else f"sz{symbol}"
    
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={req_symbol},{period},,,{limit},qfq"
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, timeout=5.0)
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
async def analyze_stock(symbol: str, name: str = "", price: str = "", changePercent: str = "", x_gemini_key: str = Header(None)):
    if not x_gemini_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required")
    try:
        client = genai.Client(api_key=x_gemini_key)
        stock_identifier = f"{name}({symbol})" if name else symbol
        
        current_status = ""
        if price and changePercent:
            current_status = f"该股当前最新价为 {price}，今日涨跌幅为 {changePercent}%。"

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
作为拥有15年A股游资与机构操盘经验的顶尖操盘手，请对股票 【{stock_identifier}】 进行极速复盘与推演。
{current_status}{kline_context}

请务必利用你强大的联网搜索能力，检索该股票最新的新闻、公告。结合上述提供的近期K线及均线(MA5/MA20)、MACD走势数据。
基于真实的新闻、基本面、长短期量价形态及A股市场风格的深刻理解，提供以下高密度干货：

1. 【资金与技术定性】：结合近十日量价及MACD背离情况，主力是属于洗盘、出货、试盘还是主升浪加速？
2. 【核心逻辑】：该股最近炒作的核心题材或基本面利好是什么？（一句话点透）
3. 【关键点位】：结合MA5和MA20均线，给出一个短线的强支撑位和强压力位。
4. 【操作剧本】：明日及本周若高开/低开应采取的应对预案。

要求语言极度精炼、犀利，多用A股实战术语（如：连板、反包、弱转强、水下捞、金叉死叉等），绝对不要废话和免责声明。

【强制格式要求】
你必须返回一个严格合法的 JSON 对象，不要包含 markdown 代码块(如 ```json)包装，直接返回 JSON 字符串。格式如下：
{{
  "analysis": "上面要求的1到4点的文本分析，可以包含换行符（注意转义）",
  "support": 14.50,  // (可选，数字类型) 从你的分析中提取的具体强支撑位价格，如果没有明确支撑位请返回 null
  "resistance": 15.80, // (可选，数字类型) 从你的分析中提取的具体强压力位价格，如果没有明确压力位请返回 null
  "winRate": "B+" // (字符串) 给出胜率评级，必须是 "A" (强烈看多), "B+" (谨慎看多), "B-" (观望), "C" (看空) 之一
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
            
        prompt = f"""
你是国内顶级游资圈的操盘手与量化研究员，深谙A股的博弈逻辑、情绪周期与资金轮动。现在是盘后复盘时间。
请你基于以下绝对真实的今日收盘数据及上证指数近5日技术走势（均线与MACD），务必利用你的联网搜索能力获取今日最新市场消息，为我生成一份【极客交易员专属】的深度复盘策略报告。

{context}

请严格使用Markdown格式，输出一份干货满满、逻辑严密的复盘与推演报告。不要任何虚头巴脑的开场白或免责声明。

## 🎯 盘面情绪与大势技术定调
* **情绪锚定**: 根据上述指数的涨跌幅差异（如主板与创业板的分化）及今日重大新闻，一针见血地点评今日是冰点、混沌、修复还是高潮？属于缩量博弈还是增量逼空？
* **技术定调**: 结合上证指数近期的MA5/MA20及MACD量能柱变化，判断大盘目前处于什么技术级别（破位、企稳、主升浪还是顶背离）？
* **主力路径**: 判断今日赚钱效应的核心主线在哪个方向（大金融、科技、消费还是周期等）？风格偏向于权重搭台还是游资炒妖？

## ⚔️ 持仓股池（自选）逐个击破与体检
请对**以上提供的每一只自选股**逐一进行简短但犀利的点评（结合其今日涨跌幅及最新驱动逻辑）：
* [股票名称]: (结合该股近期实际技术走势，如：今日放量突破/缩量回踩，受xx消息刺激，主力意图如何，明日关注xx支撑/阻力位...)
（务必覆盖列表中的所有重点股票，如果表现平庸也请指出原因；如果有明显的“领头羊”或“拖油瓶”请重点剖析其背后的资金逻辑和风险点）

## 🔮 次日沙盘推演与操盘纪律
* **大盘剧本**: 预测明日指数可能的走势路径（如：沿MA5惯性冲高、受制MA20探底回升、或者MACD死叉后的横盘震荡）。
* **应对策略**: 针对明日的剧本，给出一套可执行的仓位管理建议（如：保持底仓，围绕核心主线做T；或者防守反击，关注低位补涨）。
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
