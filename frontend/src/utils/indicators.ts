export function calculateMA(data: any[], period: number) {
  const result: any[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].value ?? data[i - j].close;
    }
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

export function calculateEMA(data: any[], period: number, key: string = 'close') {
  const result: any[] = [];
  const k = 2 / (period + 1);
  let ema = data[0][key] ?? data[0].value;
  for (let i = 0; i < data.length; i++) {
    const val = data[i][key] ?? data[i].value;
    if (i === 0) {
      result.push({ time: data[i].time, value: val });
    } else {
      ema = val * k + ema * (1 - k);
      result.push({ time: data[i].time, value: ema });
    }
  }
  return result;
}

export function calculateMACD(data: any[], shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  const emaShort = calculateEMA(data, shortPeriod);
  const emaLong = calculateEMA(data, longPeriod);
  
  const difData: any[] = [];
  for (let i = 0; i < data.length; i++) {
    difData.push({ time: data[i].time, value: emaShort[i].value - emaLong[i].value });
  }
  
  const deaData = calculateEMA(difData, signalPeriod, 'value');
  
  const macdHist: any[] = [];
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
