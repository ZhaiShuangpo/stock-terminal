import type { LinePoint } from '../types/domain';
import type { Time } from 'lightweight-charts';

interface IndicatorInput {
  time: Time;
  value?: number;
  close?: number;
}

function pointValue(point: IndicatorInput, key: 'close' | 'value' = 'close'): number {
  return point[key] ?? point.value ?? point.close ?? 0;
}

export function calculateMA(data: IndicatorInput[], period: number): LinePoint[] {
  if (period <= 0) return [];
  const result: LinePoint[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const val = pointValue(data[i]);
    sum += val;
    if (i >= period) {
      sum -= pointValue(data[i - period]);
    }
    if (i >= period - 1) {
      result.push({ time: data[i].time, value: sum / period });
    }
  }
  return result;
}

export function calculateEMA(data: IndicatorInput[], period: number, key: 'close' | 'value' = 'close'): LinePoint[] {
  if (data.length === 0 || period <= 0) return [];
  const result: LinePoint[] = [];
  const k = 2 / (period + 1);
  let ema = pointValue(data[0], key);
  for (let i = 0; i < data.length; i++) {
    const val = pointValue(data[i], key);
    if (i === 0) {
      result.push({ time: data[i].time, value: val });
    } else {
      ema = val * k + ema * (1 - k);
      result.push({ time: data[i].time, value: ema });
    }
  }
  return result;
}

export function calculateMACD(data: IndicatorInput[], shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  if (data.length === 0) return { dif: [], dea: [], histogram: [] };
  const emaShort = calculateEMA(data, shortPeriod);
  const emaLong = calculateEMA(data, longPeriod);
  
  const difData: LinePoint[] = [];
  for (let i = 0; i < data.length; i++) {
    difData.push({ time: data[i].time, value: emaShort[i].value - emaLong[i].value });
  }
  
  const deaData = calculateEMA(difData, signalPeriod, 'value');
  
  const macdHist: LinePoint[] = [];
  for (let i = 0; i < data.length; i++) {
    const dif = difData[i].value;
    const dea = deaData[i].value;
    const macd = (dif - dea) * 2;
    macdHist.push({ 
      time: data[i].time, 
      value: macd, 
      color: macd >= 0 ? 'rgba(255, 59, 48, 0.5)' : 'rgba(52, 199, 89, 0.5)' // Red for positive, Green for negative
    });
  }
  
  return { dif: difData, dea: deaData, histogram: macdHist };
}
