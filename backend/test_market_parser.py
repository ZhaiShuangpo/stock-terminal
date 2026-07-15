import asyncio
import contextlib
import os
import unittest
from datetime import datetime
from unittest.mock import AsyncMock, patch

import main
from main import describe_ai_error, is_current_market_timestamp, normalize_symbols, parse_tencent_quote


class TencentQuoteParserTests(unittest.TestCase):
    def test_incomplete_sector_map_rebuild_is_rejected(self):
        self.assertFalse(main.is_sector_map_candidate_healthy(1059, 186, 85, 20))
        self.assertFalse(main.is_sector_map_candidate_healthy(1059, 900, 85, 60))
        self.assertTrue(main.is_sector_map_candidate_healthy(1059, 1000, 85, 80))

    def make_fields(self):
        fields = [""] * 49
        fields[1] = "测试股票"
        fields[2] = "600000"
        fields[3] = "10.50"
        fields[6] = "123"
        fields[31] = "0.50"
        fields[32] = "5.00"
        fields[33] = "10.80"
        fields[34] = "10.00"
        fields[35] = "10.50/200/210000"
        fields[39] = "12.3"
        fields[45] = "1000000000"
        fields[46] = "1.5"
        return fields

    def test_uses_composite_field_35_for_volume_and_amount(self):
        quote = parse_tencent_quote(self.make_fields(), "sh600000")
        self.assertEqual(quote["low"], 10.0)
        self.assertEqual(quote["volume"], 20_000.0)
        self.assertEqual(quote["amount"], 210_000.0)

    def test_never_uses_unrelated_positional_amount_fallback(self):
        fields = self.make_fields()
        fields[35] = ""
        fields[37] = "999999999"
        quote = parse_tencent_quote(fields, "sh600000")
        self.assertEqual(quote["amount"], 10.5 * 12_300)

    def test_subscription_symbols_are_validated_and_bounded(self):
        symbols = ["sh600000", "invalid", "sz000001"] + [f"sh{i:06d}" for i in range(300)]
        normalized = normalize_symbols(symbols)
        self.assertIn("sh600000", normalized)
        self.assertIn("sz000001", normalized)
        self.assertNotIn("invalid", normalized)
        self.assertLessEqual(len(normalized), 200)

    def test_only_accepts_market_timestamp_from_current_day(self):
        now = datetime(2026, 7, 15, 10, 30)
        current = int(datetime(2026, 7, 15, 9, 45).timestamp())
        previous = int(datetime(2026, 7, 14, 15, 0).timestamp())
        self.assertTrue(is_current_market_timestamp(current, now))
        self.assertFalse(is_current_market_timestamp(previous, now))
        self.assertFalse(is_current_market_timestamp(0, now))

    def test_proxy_environment_is_removed_before_sdk_use(self):
        for key in main.PROXY_ENV_KEYS:
            self.assertNotIn(key, os.environ)

    def test_ai_configuration_errors_are_not_reported_as_high_load(self):
        error = ValueError("Invalid port: ':1'")
        self.assertEqual(describe_ai_error(error), "后端网络代理配置无效")

    def test_ai_model_priority(self):
        self.assertEqual(
            main.AI_MODEL_PRIORITY,
            (
                "antigravity-preview-05-2026",
                "gemini-3.5-flash",
                "gemini-3.1-flash-lite",
                "gemini-2.5-flash",
            ),
        )

    def test_sina_sector_fallback_builds_symbol_map(self):
        sectors = main.pd.DataFrame([
            {"label": "new_bank", "板块": "银行"},
            {"label": "new_chip", "板块": "半导体"},
        ])

        def fake_detail(sector):
            return main.pd.DataFrame({
                "symbol": ["sh600000", "sz000001"] if sector == "new_bank" else ["sh688001"]
            })

        with patch.object(main.ak, "stock_sector_spot", return_value=sectors), patch.object(
            main.ak, "stock_sector_detail", side_effect=fake_detail
        ):
            mapping, total, successful = main.build_sina_sector_map_sync()

        self.assertEqual((total, successful), (2, 2))
        self.assertEqual(mapping["sh600000"], ["银行"])
        self.assertEqual(mapping["sh688001"], ["半导体"])


class ResonanceFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_tencent_fallback_enriches_sina_symbols(self):
        fields = [""] * 49
        fields[1] = "测试股票"
        fields[2] = "600000"
        fields[3] = "10.50"
        fields[30] = "20260715103000"
        fields[31] = "0.50"
        fields[32] = "5.00"
        fields[33] = "10.80"
        fields[34] = "10.00"
        fields[35] = "10.50/200/210000"
        fields[38] = "3.20"
        fields[39] = "12.30"
        fields[45] = "100.00"
        fields[46] = "1.50"

        class FakeResponse:
            text = f'v_sh600000="{"~".join(fields)}";'

        class FakeClient:
            async def get(self, _url, **_kwargs):
                return FakeResponse()

        previous_client = main.http_client
        main.http_client = FakeClient()
        try:
            rows, timestamp = await main.fetch_tencent_resonance_rows(["sh600000"])
        finally:
            main.http_client = previous_client

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["f8"], 3.2)
        self.assertEqual(rows[0]["f21"], 10_000_000_000)
        self.assertEqual(datetime.fromtimestamp(timestamp).date(), datetime(2026, 7, 15).date())


class MarketBroadcastTests(unittest.IsolatedAsyncioTestCase):
    async def test_broken_socket_does_not_block_healthy_clients(self):
        delivered = asyncio.Event()

        class BrokenSocket:
            async def send_json(self, _payload):
                raise ConnectionResetError("client disconnected")

        class HealthySocket:
            def __init__(self):
                self.messages = []

            async def send_json(self, payload):
                self.messages.append(payload)
                if payload.get("type") == "market_data":
                    delivered.set()

        broken = BrokenSocket()
        healthy = HealthySocket()
        main.market_clients.clear()
        main.market_clients[broken] = {"sh600519"}
        main.market_clients[healthy] = {"sh600519"}
        main.market_refresh_event = asyncio.Event()

        async def fake_indices():
            return []

        async def fake_sectors():
            return []

        async def fake_market(_symbols):
            return ([{"symbol": "sh600519"}], [])

        with (
            patch.object(main, "fetch_indices", fake_indices),
            patch.object(main, "fetch_sectors", fake_sectors),
            patch.object(main, "fetch_tencent_data", fake_market),
        ):
            task = asyncio.create_task(main.market_broadcast_loop())
            await asyncio.wait_for(delivered.wait(), timeout=1)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        self.assertNotIn(broken, main.market_clients)
        self.assertTrue(any(message.get("type") == "market_data" for message in healthy.messages))
        main.market_clients.clear()

    async def test_provider_failure_does_not_drop_the_whole_broadcast(self):
        delivered = asyncio.Event()

        class HealthySocket:
            def __init__(self):
                self.messages = []

            async def send_json(self, payload):
                self.messages.append(payload)
                if payload.get("type") == "market_data":
                    delivered.set()

        socket = HealthySocket()
        main.market_clients.clear()
        main.market_clients[socket] = {"sh600519"}
        main.market_refresh_event = asyncio.Event()

        async def broken_indices():
            raise RuntimeError("provider unavailable")

        async def fake_sectors():
            return []

        async def fake_market(_symbols):
            return ([{"symbol": "sh600519", "name": "贵州茅台"}], [])

        with (
            patch.object(main, "fetch_indices", broken_indices),
            patch.object(main, "fetch_sectors", fake_sectors),
            patch.object(main, "fetch_tencent_data", fake_market),
        ):
            task = asyncio.create_task(main.market_broadcast_loop())
            await asyncio.wait_for(delivered.wait(), timeout=1)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        market_messages = [message for message in socket.messages if message.get("type") == "market_data"]
        self.assertEqual(len(market_messages), 1)
        self.assertEqual(market_messages[0]["payload"][0]["symbol"], "sh600519")
        self.assertEqual(market_messages[0]["schemaVersion"], 1)
        main.market_clients.clear()


class SectorSelectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_long_term_sector_universe_is_not_ranked_by_daily_gain(self):
        requested_urls = []

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"data": {"diff": [{"f12": "600000", "f13": 1, "f14": "测试股票", "f2": 10, "f3": 1, "f4": 0.1, "f5": 100, "f6": 1000, "f15": 10.2, "f16": 9.8, "f9": 10, "f23": 1, "f21": 10000000000, "f8": 2, "f185": None, "f186": 5}]}}

        class FakeClient:
            async def get(self, url, **_kwargs):
                requested_urls.append(url)
                return FakeResponse()

        previous_client = main.http_client
        main.http_client = FakeClient()
        try:
            with patch.object(main, "fetch_kline_from_sina", new=AsyncMock()) as kline_mock:
                result = await main.get_sector_stocks("BK0001", mode="long_term")
        finally:
            main.http_client = previous_client

        self.assertIn("pz=200", requested_urls[0])
        self.assertIn("fid=f21", requested_urls[0])
        kline_mock.assert_not_awaited()
        self.assertEqual(result["meta"]["universeSort"], "marketCap")
        self.assertIsNone(result["data"][0]["netProfitGrowth"])

    async def test_tactical_sector_universe_keeps_technical_enrichment_separate(self):
        requested_urls = []

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"data": {"diff": [{"f12": "600000", "f13": 1, "f14": "测试股票", "f2": 10, "f3": 3, "f4": 0.3, "f5": 100, "f6": 1000, "f15": 10.2, "f16": 9.8, "f9": 10, "f23": 1, "f21": 10000000000, "f8": 3, "f185": 10, "f186": 5}]}}

        class FakeClient:
            async def get(self, url, **_kwargs):
                requested_urls.append(url)
                return FakeResponse()

        previous_client = main.http_client
        main.http_client = FakeClient()
        try:
            with patch.object(main, "fetch_kline_from_sina", new=AsyncMock(return_value=None)) as kline_mock:
                result = await main.get_sector_stocks("BK0001", mode="tactical")
        finally:
            main.http_client = previous_client

        self.assertIn("pz=80", requested_urls[0])
        self.assertIn("fid=f3", requested_urls[0])
        kline_mock.assert_awaited_once()
        self.assertTrue(result["meta"]["technicalEnrichment"])


class AIAnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def test_thesis_evaluation_uses_structured_audit_criteria(self):
        captured_prompt = ""

        def fake_generate(_key, _model_name, prompt, _response_schema=None):
            nonlocal captured_prompt
            captured_prompt = prompt
            return main.AIContentResult(
                '{"evaluation":"KPI仍在改善","status":"HOLD","confidence":75,"asOf":"2026-07-15T15:00:00+08:00","searchStatus":"complete","kpiFindings":["毛利率改善"],"invalidations":[],"sources":[]}',
                [{"title": "定期报告", "url": "https://example.com/report"}],
                ["测试股票 定期报告"],
            )

        payload = {"symbol": "sh600000", "name": "测试股票", "thesis": "份额提升", "kpis": "毛利率", "invalidation": "毛利率连续两季下降", "risks": "价格战"}
        with patch.object(main, "generate_ai_content", side_effect=fake_generate):
            result = await main.evaluate_thesis(payload, x_gemini_key="test-key")

        self.assertIn("对每项KPI分别判断", captured_prompt)
        self.assertIn("毛利率连续两季下降", captured_prompt)
        self.assertEqual(result["status"], "HOLD")
        self.assertEqual(result["confidence"], 75)
        self.assertEqual(result["sources"][0]["title"], "定期报告")

    async def test_thesis_evaluation_caps_unstructured_records(self):
        def fake_generate(_key, _model_name, _prompt, _response_schema=None):
            return main.AIContentResult(
                '{"evaluation":"模型认为继续持有","status":"HOLD","confidence":90,"asOf":"","searchStatus":"complete","kpiFindings":[],"invalidations":[],"sources":[]}', [], [],
            )

        with patch.object(main, "generate_ai_content", side_effect=fake_generate):
            result = await main.evaluate_thesis({"symbol": "sh600000", "thesis": "看好公司"}, x_gemini_key="test-key")

        self.assertEqual(result["status"], "WARNING")
        self.assertEqual(result["confidence"], 40)

    async def test_news_summary_never_guesses_sentiment_from_headings(self):
        captured_prompt = ""

        def fake_generate(_key, _model_name, prompt, _response_schema=None):
            nonlocal captured_prompt
            captured_prompt = prompt
            return main.AIContentResult(
                "【利空因素】一项\n【利好因素】一项",
                [{"title": "正式公告", "url": "https://example.com/notice"}],
                ["测试股票 最新公告"],
            )

        with patch.object(main, "generate_ai_content", side_effect=fake_generate):
            result = await main.get_news_summary(
                "sh600000", name="测试股票", price=10, changePercent=1,
                x_gemini_key="test-key",
            )

        self.assertIn("事实方向", captured_prompt)
        self.assertIn("不把股价上涨", captured_prompt)
        self.assertEqual(result["sentiment"], "UNCERTAIN")
        self.assertEqual(result["sources"][0]["title"], "正式公告")

    async def test_analysis_uses_rich_market_context_and_keeps_safe_sources(self):
        klines = [
            [f"2026-06-{(index % 28) + 1:02d}", "10", str(10 + index / 100), "11", "9", str(1000 + index)]
            for index in range(60)
        ]
        captured_prompt = ""

        def fake_generate(_key, _model_name, prompt, _response_schema=None):
            nonlocal captured_prompt
            captured_prompt = prompt
            return main.AIContentResult(
                '{"analysis":"测试分析","searchStatus":"complete","directCatalystFound":false,"confidence":70,"sources":[]}',
                [
                    {"title": "交易所公告", "url": "https://example.com/a"},
                    {"title": "不安全链接", "url": "javascript:alert(1)"},
                ],
                ["测试股票 最新公告"],
            )

        mocked_history = AsyncMock(return_value=klines)
        with patch.object(main, "get_kline_data", new=mocked_history), patch.object(
            main, "generate_ai_content", side_effect=fake_generate
        ):
            result = await main.analyze_stock(
                "sh600000",
                name="测试股票",
                price="10.59",
                changePercent="3.2",
                volume="200000",
                amount="2100000",
                quoteTime="20260715113000",
                fundNetAmount="100000",
                fundRatio="0.03",
                x_gemini_key="test-key",
            )

        self.assertIn("日线长周期历史", captured_prompt)
        self.assertIn("周线长周期历史", captured_prompt)
        self.assertIn("长期投资策略以1至3年为周期", captured_prompt)
        self.assertIn("波段交易策略以1至12周为周期", captured_prompt)
        self.assertIn("不是历史回测胜率", captured_prompt)
        self.assertIn("V=", captured_prompt)
        self.assertIn("巨潮资讯", captured_prompt)
        self.assertEqual(
            [call.args for call in mocked_history.await_args_list],
            [("sh600000", "day", 250), ("sh600000", "week", 156)],
        )
        self.assertEqual(result["modelUsed"], main.AI_MODEL_PRIORITY[0])
        self.assertEqual(result["searchQueries"], ["测试股票 最新公告"])
        self.assertEqual(result["sources"], [{"title": "交易所公告", "url": "https://example.com/a"}])
        self.assertIn("不是历史回测胜率", result["ratingBasis"])

    async def test_market_review_focuses_on_indices_and_sector_rotation(self):
        klines = [
            [f"2026-06-{(index % 28) + 1:02d}", "3000", str(3000 + index), "3100", "2950", str(100000 + index)]
            for index in range(60)
        ]
        captured_prompt = ""

        def fake_generate(_key, _model_name, prompt, _response_schema=None):
            nonlocal captured_prompt
            captured_prompt = prompt
            return main.AIContentResult(
                "## 1. 指数环境与市场宽度\n测试复盘",
                [{"title": "政策来源", "url": "https://example.com/policy"}],
                ["A股 今日 政策 板块轮动"],
            )

        payload = {
            "stocks": [{"name": "不应出现的个股"}],
            "indices": [{"name": "上证指数", "price": 3500, "changePercent": 0.5}],
            "sectors": [
                {"name": "低位启动板块", "changePercent": 2.1, "change5d": 1.2, "change20d": -6, "volRatio": 1.5, "fundFlow": 3.2},
                {"name": "高位分化板块", "changePercent": -1.0, "change5d": 5, "change20d": 15, "volRatio": 0.8, "fundFlow": -2.0},
            ],
            "sentiment": {"up": 3000, "down": 1800, "limitUp": 50, "limitDown": 5},
        }
        with patch.object(main, "fetch_sectors", new=AsyncMock(return_value=payload["sectors"])), patch.object(
            main, "get_kline_data", new=AsyncMock(return_value=klines)
        ), patch.object(main, "generate_ai_content", side_effect=fake_generate):
            result = await main.generate_market_review(payload, x_gemini_key="test-key")

        self.assertIn("全板块轮动矩阵", captured_prompt)
        self.assertIn("低位启动板块", captured_prompt)
        self.assertIn("不得出现个股名称", captured_prompt)
        self.assertNotIn("不应出现的个股", captured_prompt)
        self.assertEqual(result["searchStatus"], "complete")
        self.assertEqual(result["sources"][0]["title"], "政策来源")


if __name__ == "__main__":
    unittest.main()
