import type { IndexData, InvestmentThesis, PaperTrade, StockData } from '../types/domain';
import { benchmarkReturn, calculateStrategyMetrics } from '../utils/strategyMetrics';

interface Props {
  trades: PaperTrade[];
  stocks: StockData[];
  indices: IndexData[];
  theses: InvestmentThesis[];
  apiConfigured: boolean;
  onChange: (trades: PaperTrade[]) => void;
  onEvaluate: (trade: PaperTrade) => Promise<void>;
  onRequireApiKey: () => void;
}

const percent = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

export function StrategyLab({ trades, stocks, indices, theses, apiConfigured, onChange, onEvaluate, onRequireApiKey }: Props) {
  const metrics = calculateStrategyMetrics(trades, indices);
  const thesisById = new Map(theses.map((thesis) => [thesis.id, thesis]));
  return <div className="flex-1 flex flex-col p-6 overflow-hidden">
    <div className="flex items-center justify-between mb-5"><div><h2 className="text-2xl font-bold">策略实验室 · 前向验证</h2><p className="text-xs text-gray-500 mt-1">模拟信号跟踪不是历史回测；样本、策略版本和基准不一致时不合并解释。</p></div><button onClick={() => { if (window.confirm('确定清空所有策略验证记录？')) onChange([]); }} className="text-xs text-gray-500 hover:text-white">清空记录</button></div>
    {metrics.closedCount < 20 && <div className="mb-4 px-3 py-2 rounded border border-amber-900/60 bg-amber-950/20 text-xs text-amber-300">当前仅有 {metrics.closedCount} 个已平仓样本，胜率与期望值只作描述，不具备统计稳定性；建议同一策略版本至少积累20笔再比较。</div>}
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">{[
      ['已平仓样本', String(metrics.closedCount)], ['胜率', metrics.winRate === null ? '—' : `${(metrics.winRate * 100).toFixed(1)}%`], ['单笔期望', percent(metrics.expectancy)], ['最大回撤', metrics.maxDrawdown === null ? '—' : `${metrics.maxDrawdown.toFixed(2)}%`], ['平均超额', percent(metrics.averageExcessReturn)],
    ].map(([label,value]) => <div key={label} className="bg-gray-900 border border-gray-800 rounded-lg p-3"><div className="text-[10px] text-gray-500">{label}</div><div className="text-lg font-bold font-mono">{value}</div></div>)}</div>
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-500 mb-4 px-1"><span>平均盈利 {percent(metrics.averageWin)}</span><span>平均亏损 {percent(metrics.averageLoss)}</span><span>盈利因子 {metrics.profitFactor === null ? '—' : metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2)}</span><span>平均持有 {metrics.averageHoldingDays === null ? '—' : `${metrics.averageHoldingDays.toFixed(1)}天`}</span></div>
    <div className="flex-1 overflow-auto space-y-4">{trades.length === 0 ? <div className="text-center text-gray-500 mt-20">暂无策略验证记录。<br/>在个股详情面板点击「记录模拟买入」开始前向跟踪。</div> : trades.slice().reverse().map((trade) => {
      const currentStock = stocks.find((stock) => stock.symbol === trade.symbol);
      const isClosed = trade.sellPrice !== undefined;
      const finalPrice = trade.sellPrice ?? currentStock?.price ?? trade.buyPrice;
      const pnlPercent = trade.buyPrice > 0 ? ((finalPrice - trade.buyPrice) / trade.buyPrice) * 100 : 0;
      const benchmarkPnl = benchmarkReturn(trade, indices);
      const excess = benchmarkPnl === null ? null : pnlPercent - benchmarkPnl;
      const thesis = trade.thesisId ? thesisById.get(trade.thesisId) : undefined;
      return <div key={trade.id} className={`bg-gray-900 border ${isClosed ? 'border-gray-800' : 'border-blue-900/50'} rounded-xl p-5`}>
        <div className="flex justify-between items-start mb-4 border-b border-gray-800 pb-4"><div><div className="font-bold text-lg">{trade.name} <span className="text-gray-500 text-sm font-normal">{trade.symbol}</span> <span className={`text-[10px] px-1.5 py-0.5 rounded ${isClosed ? 'bg-gray-800 text-gray-400' : 'bg-blue-900/30 text-blue-400'}`}>{isClosed ? '已平仓' : '持仓中'}</span></div><div className="text-xs text-gray-500 mt-1">买入 {new Date(trade.buyTime).toLocaleString()}{trade.sellTime ? ` · 卖出 ${new Date(trade.sellTime).toLocaleString()}` : ''}</div></div><div className="text-right"><button onClick={() => onChange(trades.filter((item) => item.id !== trade.id))} className="text-xs text-gray-600 hover:text-red-500">删除</button><div className={`text-xl font-bold font-mono ${pnlPercent >= 0 ? 'text-[var(--color-stock-red)]' : 'text-[var(--color-stock-green)]'}`}>{percent(pnlPercent)}</div></div></div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3 text-sm font-mono bg-black p-3 rounded"><div><span className="text-gray-500">买入:</span> {trade.buyPrice.toFixed(2)}</div><div><span className="text-gray-500">{isClosed ? '卖出:' : '当前:'}</span> {finalPrice.toFixed(2)}</div><div><span className="text-gray-500">数量:</span> {trade.quantity ?? 100}股</div><div><span className="text-gray-500">基准超额:</span> {percent(excess)}</div></div>
        <div className="mb-3 flex flex-wrap gap-2 text-[10px] text-gray-500"><span className="border border-gray-800 rounded px-2 py-1">{trade.signalType === 'TACTICAL' ? '战术信号' : trade.signalType === 'LONG_TERM' ? '长期信号' : '手动记录'}</span><span className="border border-gray-800 rounded px-2 py-1">来源：{trade.signalSource || '旧版记录'}</span><span className="border border-gray-800 rounded px-2 py-1">版本：{trade.strategyVersion || 'legacy'}</span>{trade.benchmarkName && <span className="border border-gray-800 rounded px-2 py-1">基准：{trade.benchmarkName}</span>}<span className={`border rounded px-2 py-1 ${thesis ? 'border-blue-900 text-blue-400' : 'border-amber-900 text-amber-500'}`}>{thesis ? `关联逻辑：${thesis.status}` : '未关联研究卡片'}</span></div>
        <div className="text-sm"><div className="flex justify-between mb-1"><b className="text-blue-400">买入逻辑 / 策略理由</b>{!isClosed && <button disabled={trade.isEvaluating} onClick={() => apiConfigured ? onEvaluate(trade) : onRequireApiKey()} className="text-xs px-2 py-0.5 bg-blue-900/50 hover:bg-blue-800 text-blue-300 rounded disabled:opacity-50">{trade.isEvaluating ? '复核中...' : '联网逻辑体检'}</button>}</div><p className="text-gray-400 whitespace-pre-wrap bg-blue-950/20 p-3 rounded border border-blue-900/30">{trade.aiLogic}</p>
        {trade.evaluation && <div className="mt-3 bg-gray-950 p-3 rounded border border-gray-800"><div className="flex flex-wrap gap-2 items-center mb-2"><b>体检报告</b><span className={`px-2 py-0.5 rounded text-[10px] ${trade.evalStatus === 'HOLD' ? 'text-green-400' : trade.evalStatus === 'SELL' ? 'text-red-400' : 'text-yellow-400'}`}>{trade.evalStatus}</span><span className="text-[10px] text-gray-500">证据置信度 {trade.evaluationConfidence ?? 0}%</span></div><p className="text-gray-400 text-xs whitespace-pre-wrap">{trade.evaluation}</p>{(trade.evaluationSources?.length || 0) > 0 && <div className="mt-2 space-y-1">{trade.evaluationSources!.slice(0,5).map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="block text-xs text-blue-400 hover:underline">{source.title}</a>)}</div>}</div>}
        {isClosed && trade.sellAiLogic && <div className="mt-3"><b className="text-green-400">卖出逻辑 / 平仓理由</b><p className="text-gray-400 whitespace-pre-wrap bg-green-950/20 p-3 rounded border border-green-900/30 mt-1">{trade.sellAiLogic}</p></div>}</div>
      </div>;
    })}</div>
  </div>;
}
