export const SECTOR_ETF_MAP: Record<string, { symbol: string, name: string }> = {
  // 科技/半导体
  "半导体": { symbol: "sh512480", name: "半导体ETF" },
  "芯片": { symbol: "sz159995", name: "芯片ETF" },
  "消费电子": { symbol: "sz159732", name: "消费电子ETF" },
  "计算机": { symbol: "sh512720", name: "计算机ETF" },
  "软件开发": { symbol: "sh515220", name: "软件ETF" },
  "游戏": { symbol: "sh516010", name: "游戏ETF" },
  "传媒": { symbol: "sh512980", name: "传媒ETF" },
  "通信设备": { symbol: "sh515880", name: "通信ETF" },
  "人工智能": { symbol: "sh515980", name: "人工智能ETF" },
  
  // 新能源/汽车
  "光伏设备": { symbol: "sh515790", name: "光伏ETF" },
  "电池": { symbol: "sz159755", name: "电池ETF" },
  "新能源车": { symbol: "sh515700", name: "新能车ETF" },
  "汽车整车": { symbol: "sh515250", name: "智能汽车ETF" },
  "汽车零部件": { symbol: "sh515250", name: "智能汽车ETF" },
  
  // 医药/医疗
  "医疗器械": { symbol: "sz159883", name: "医疗器械ETF" },
  "医疗服务": { symbol: "sh512170", name: "医疗ETF" },
  "生物制品": { symbol: "sh512290", name: "生物医药ETF" },
  "中药": { symbol: "sh560080", name: "中药ETF" },
  "化学制药": { symbol: "sh512290", name: "生物医药ETF" },
  
  // 大金融/地产
  "证券": { symbol: "sh512880", name: "证券ETF" },
  "保险": { symbol: "sh512880", name: "证券ETF" }, // 暂用大金融
  "银行": { symbol: "sh512800", name: "银行ETF" },
  "房地产开发": { symbol: "sh512200", name: "房地产ETF" },
  "房地产服务": { symbol: "sh512200", name: "房地产ETF" },
  
  // 消费/农业
  "白酒": { symbol: "sh512690", name: "酒ETF" },
  "食品饮料": { symbol: "sh515710", name: "食品饮料ETF" },
  "农牧饲渔": { symbol: "sz159865", name: "农业50ETF" },
  "家电行业": { symbol: "sz159996", name: "家电ETF" },
  "旅游酒店": { symbol: "sz159766", name: "旅游ETF" },
  
  // 周期/制造
  "煤炭行业": { symbol: "sh515220", name: "煤炭ETF" },
  "石油行业": { symbol: "sh515220", name: "能源ETF" }, // 示意
  "有色金属": { symbol: "sz159876", name: "有色金属ETF" },
  "钢铁行业": { symbol: "sh515210", name: "钢铁ETF" },
  "航天航空": { symbol: "sh512710", name: "军工ETF" },
  "船舶制造": { symbol: "sh512710", name: "军工ETF" },
  "专用设备": { symbol: "sz159813", name: "军工ETF" }, // 暂代
  "工程机械": { symbol: "sh516970", name: "基建50ETF" },
  
  // 宽基兜底 (如果是无法映射的小板块，推荐最强宽基)
  "DEFAULT": { symbol: "sh510300", name: "沪深300ETF" }
};
