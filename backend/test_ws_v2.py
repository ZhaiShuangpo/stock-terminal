import asyncio
import websockets
import json

async def test():
    async with websockets.connect("ws://localhost:8000/ws/market") as ws:
        await ws.send(json.dumps({"type": "subscribe", "symbols": ["sh600519"]}))
        msg = await ws.recv()
        data = json.loads(msg)
        if data.get("type") == "ping": # skip ping
             msg = await ws.recv()
             data = json.loads(msg)
        print(json.dumps({
            "type": data.get("type"),
            "resonanceCount": len(data.get("resonanceStocks", [])),
            "resonanceSymbols": [item.get("symbol") for item in data.get("resonanceStocks", [])],
            "resonanceMeta": data.get("resonanceMeta"),
        }, indent=2, ensure_ascii=False))

asyncio.run(test())
