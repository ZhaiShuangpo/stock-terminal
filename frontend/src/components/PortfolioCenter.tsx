import { useMemo } from 'react';
import type { IndexData, InvestmentThesis, PaperTrade, StockData } from '../types/domain';
import { benchmarkReturn, tradeReturn } from '../utils/strategyMetrics';

interface Props { trades: PaperTrade[]; stocks: StockData[]; indices: IndexData[]; theses: InvestmentThesis[]; }

export function PortfolioCenter({ trades, stocks, indices, theses }: Props) {
  const open = trades.filter((trade) => trade.sellPrice === undefined);
  const rows = useMemo(() => open.map((trade) => {
    const stock = stocks.find((item) => item.symbol === trade.symbol);
    const quantity = trade.quantity ?? 100;
    const price = stock?.price || trade.buyPrice;
    return { trade, price, quantity, value: price * quantity, pnl: tradeReturn(trade, stocks), benchmark: benchmarkReturn(trade, indices) };
  }), [open, stocks, indices]);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const largestWeight = total ? Math.max(...rows.map((row) => row.value / total * 100)) : 0;
  const covered = new Set(theses.filter((thesis) => thesis.status !== 'INVALIDATED').map((thesis) => thesis.symbol));
  const sectorValues = rows.reduce<Record<string, number>>((acc, row) => {
    const sector = row.trade.entrySnapshot?.sectorName || '未分类';
    acc[sector] = (acc[sector] || 0) + row.value;
    return acc;
  }, {});

  return <div className="flex-1 overflow-auto p-6 bg-[var(--color-stock-bg)]">
    <div className="mb-5"><h2 className="text-2xl font-bold">组合与风险</h2><p className="text-xs text-gray-500 mt-1">基于策略实验室中的未平仓记录计算；默认旧记录为 100 股，未分类行业不会被猜测补齐。</p></div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      {[['模拟市值', total ? `¥${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'], ['持仓数', String(rows.length)], ['最大单仓', rows.length ? `${largestWeight.toFixed(1)}%` : '—'], ['逻辑覆盖', rows.length ? `${rows.filter((row) => covered.has(row.trade.symbol)).length}/${rows.length}` : '—']].map(([label,value]) => <div key={label} className="bg-gray-900 border border-gray-800 rounded-lg p-4"><div className="text-xs text-gray-500">{label}</div><div className="text-xl font-bold mt-1">{value}</div></div>)}
    </div>
    {rows.length === 0 ? <div className="text-center text-gray-500 border border-dashed border-gray-800 rounded-xl py-20">暂无模拟持仓。组合风险只统计已记录的仓位，不从自选股推断持仓。</div> : <div className="grid xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden"><div className="grid grid-cols-7 p-3 text-xs text-gray-500 border-b border-gray-800"><span className="col-span-2">标的</span><span>数量</span><span>权重</span><span>收益</span><span>基准</span><span>逻辑</span></div>{rows.map((row) => <div key={row.trade.id} className="grid grid-cols-7 p-3 text-xs border-b border-gray-800/60 items-center"><span className="col-span-2 font-bold">{row.trade.name}<small className="block text-gray-600">{row.trade.symbol}</small></span><span>{row.quantity}</span><span>{(row.value / total * 100).toFixed(1)}%</span><span className={row.pnl >= 0 ? 'text-red-400' : 'text-green-400'}>{row.pnl > 0 ? '+' : ''}{row.pnl.toFixed(2)}%</span><span>{row.benchmark === null ? '—' : `${row.benchmark.toFixed(2)}%`}</span><span className={covered.has(row.trade.symbol) ? 'text-blue-400' : 'text-yellow-500'}>{covered.has(row.trade.symbol) ? '已覆盖' : '待补充'}</span></div>)}</div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4"><h3 className="font-bold mb-4">行业暴露</h3>{Object.entries(sectorValues).sort((a,b) => b[1]-a[1]).map(([sector,value]) => <div key={sector} className="mb-3"><div className="flex justify-between text-xs mb-1"><span>{sector}</span><span>{(value / total * 100).toFixed(1)}%</span></div><div className="h-1.5 bg-black rounded"><div className="h-full bg-blue-500 rounded" style={{ width: `${value / total * 100}%` }} /></div></div>)}</div>
    </div>}
  </div>;
}
