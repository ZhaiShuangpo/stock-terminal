const fs = require('fs');
fetch("http://localhost:8000/api/intraday?symbol=sh600519").then(r => r.json()).then(data => {
  const dataIntraday = data;
  const year = dataIntraday.date.substring(0, 4);
  const month = dataIntraday.date.substring(4, 6);
  const day = dataIntraday.date.substring(6, 8);
  
  const chartData = [];
  const vwapPoints = [];
  
  dataIntraday.data.forEach((item) => {
    const parts = item.split(' ');
    const price = parseFloat(parts[1]);
    const cumVol = parseFloat(parts[2]);
    const cumAmount = parseFloat(parts[3]);
    
    const hour = parseInt(parts[0].substring(0, 2), 10);
    const minute = parseInt(parts[0].substring(2, 4), 10);
    const time = Math.floor(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day), hour, minute) / 1000);
    
    if (isNaN(price) || isNaN(time)) console.log("NaN price or time", item);
    if (isNaN(cumVol) || isNaN(cumAmount)) console.log("NaN vol/amount", item);
    
    chartData.push({ time, value: price });
    if (cumVol > 0) {
      const vwap = cumAmount / (cumVol * 100);
      if (isNaN(vwap)) console.log("NaN vwap", item);
      vwapPoints.push({ time, value: vwap });
    }
  });
  console.log("Chart Data length:", chartData.length);
  console.log("VWAP Data length:", vwapPoints.length);
  
  // Check if strictly increasing
  for (let i = 1; i < chartData.length; i++) {
    if (chartData[i].time <= chartData[i-1].time) {
      console.log("Not strictly increasing!", chartData[i-1], chartData[i]);
    }
  }
});
