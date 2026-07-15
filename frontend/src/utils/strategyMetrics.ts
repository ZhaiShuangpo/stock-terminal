import type { IndexData, PaperTrade, StockData } from '../types/domain';

export interface StrategyMetrics {
  closedCount: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  averageHoldingDays: number | null;
  averageExcessReturn: number | null;
}

export function tradeReturn(trade: PaperTrade, stocks: StockData[]): number {
  const current = stocks.find((stock) => stock.symbol === trade.symbol)?.price;
  const exit = trade.sellPrice ?? current ?? trade.buyPrice;
  return trade.buyPrice > 0 ? ((exit - trade.buyPrice) / trade.buyPrice) * 100 : 0;
}

export function benchmarkReturn(trade: PaperTrade, indices: IndexData[]): number | null {
  const current = indices.find((index) => index.code === trade.benchmarkCode)?.price;
  const exit = trade.benchmarkSellPrice ?? current;
  if (!trade.benchmarkBuyPrice || !exit) return null;
  return ((exit - trade.benchmarkBuyPrice) / trade.benchmarkBuyPrice) * 100;
}

export function calculateStrategyMetrics(trades: PaperTrade[], indices: IndexData[]): StrategyMetrics {
  const closed = trades.filter((trade) => trade.sellPrice !== undefined);
  const returns = closed.map((trade) => ((trade.sellPrice! - trade.buyPrice) / trade.buyPrice) * 100);
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const averageWin = average(wins);
  const averageLoss = average(losses);
  const winRate = closed.length ? wins.length / closed.length : null;
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  returns.forEach((value) => {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
  });

  const excess = closed.map((trade, index) => {
    const benchmark = benchmarkReturn(trade, indices);
    return benchmark === null ? null : returns[index] - benchmark;
  }).filter((value): value is number => value !== null);
  const holdingDays = closed
    .filter((trade) => trade.sellTime)
    .map((trade) => (trade.sellTime! - trade.buyTime) / 86_400_000);

  return {
    closedCount: closed.length,
    winRate,
    averageWin,
    averageLoss,
    expectancy: closed.length ? average(returns) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    maxDrawdown: closed.length ? maxDrawdown : null,
    averageHoldingDays: average(holdingDays),
    averageExcessReturn: average(excess),
  };
}
