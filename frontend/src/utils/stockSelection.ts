import type { ResonanceStock } from '../types/domain';

export interface LongTermAssessment {
  score: number;
  coverage: number;
  tier: 'CANDIDATE' | 'WATCH' | 'INSUFFICIENT';
  tags: string[];
  warnings: string[];
}

const presentPositive = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const presentNumber = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value);

export function assessLongTermCandidate(stock: ResonanceStock): LongTermAssessment {
  let score = 0;
  const tags: string[] = [];
  const warnings: string[] = [];
  const fields = [presentPositive(stock.pe), presentPositive(stock.pb), presentPositive(stock.marketCap), presentPositive(stock.turnover), presentNumber(stock.netProfitGrowth), presentNumber(stock.revenueGrowth)];
  const coverage = fields.filter(Boolean).length / fields.length;

  if ((stock.marketCap || 0) >= 200) { score += 15; tags.push('规模较大'); }
  else if ((stock.marketCap || 0) >= 50) { score += 8; tags.push('市值达标'); }

  if (presentPositive(stock.pe) && stock.pe! <= stock.maxPe) { score += 15; tags.push('PE在规则范围'); if (stock.pe! <= stock.maxPe * 0.7) score += 5; }
  else if (presentPositive(stock.pe)) warnings.push('PE高于规则范围');
  if (presentPositive(stock.pb) && stock.pb! <= stock.maxPb) { score += 10; tags.push('PB在规则范围'); }
  else if (presentPositive(stock.pb)) warnings.push('PB高于规则范围');

  if (presentNumber(stock.netProfitGrowth)) {
    if (stock.netProfitGrowth! > 15) { score += 20; tags.push('利润增长较强'); }
    else if (stock.netProfitGrowth! > 0) { score += 12; tags.push('利润正增长'); }
    else { score -= 15; warnings.push('利润同比未增长'); }
  }
  if (presentNumber(stock.revenueGrowth)) {
    if (stock.revenueGrowth! > 10) { score += 15; tags.push('收入增长较强'); }
    else if (stock.revenueGrowth! > 0) { score += 8; tags.push('收入正增长'); }
    else { score -= 10; warnings.push('收入同比未增长'); }
  }

  if (stock.turnover > 0 && stock.turnover <= 8) score += 5;
  else if (stock.turnover >= 15) { score -= 10; warnings.push('换手偏高'); }
  if (Math.abs(stock.changePercent) <= 4) score += 5;
  else if (stock.changePercent >= 7) { score -= 10; warnings.push('当日涨幅偏高，谨防追涨'); }

  if (coverage < 0.5) warnings.push('基本面字段覆盖不足');
  const normalizedScore = Math.max(0, Math.min(100, score));
  const tier = coverage >= 0.67 && normalizedScore >= 55 ? 'CANDIDATE' : coverage >= 0.5 && normalizedScore >= 35 ? 'WATCH' : 'INSUFFICIENT';
  return { score: normalizedScore, coverage, tier, tags, warnings };
}

export function isTacticalCandidate(stock: ResonanceStock): boolean {
  return Boolean(
    presentPositive(stock.pe) && stock.pe! < stock.maxPe &&
    presentPositive(stock.pb) && stock.pb! < stock.maxPb &&
    stock.changePercent >= 2 && stock.turnover >= 2 && stock.turnover < 18 &&
    (stock.marketCap || 0) >= 50 && stock.maBullish && stock.pocBreakout
  );
}
