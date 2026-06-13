import { LATEST_PYTHON_FEATURE_SPEC_VERSION, PYTHON_FEATURE_SPECS, type PythonFeatureSpecContract } from './featureSpecRegistry.generated'

export interface FeatureSpecEntry {
  version: string
  interval: string
  lookbackBars: number
  columns: number
  columnNames: string[]
  desc: string
  highlights: string[]
}

interface FeatureSpecUiMeta {
  desc: string
  highlights: string[]
}

const FEATURE_SPEC_UI_META: Record<string, FeatureSpecUiMeta> = {
  v001: { desc: '基础特征集', highlights: ['价格结构', '趋势指标', '波动率', '量能'] },
  v002: { desc: '增强特征', highlights: ['扩展均线', '动量', '量价背离', '滞后', '交叉'] },
  v003: { desc: '短线反转增强', highlights: ['隔夜收益分解', '收盘位置', 'GK 波动率'] },
  v004: { desc: '趋势跟随增强', highlights: ['突破指标', '趋势强度', '资金方向'] },
  v005: { desc: '大盘与截面因子', highlights: ['指数相对', '市场宽度', '截面排名'] },
  v006: { desc: '短线实战特征', highlights: ['跳空强度', '日内动量', '量价确认', '短期反转'] },
  v007: { desc: '多尺度特征', highlights: ['EWMA 衰减', '多周期 RSI/ATR', '跨尺度背离'] },
  v008: { desc: '板块因子', highlights: ['行业动量', '板块排名', '板块超额'] },
  v009: { desc: '隔夜策略因子', highlights: ['多日隔夜动量', '波动压缩', '收盘强度', '跳空频率'] },
  v010: { desc: '增强隔夜预测', highlights: ['收盘盘口', '隔夜分解增强', '流动性代理', '量价交互'] },
}

const fallbackMeta = (spec: PythonFeatureSpecContract): FeatureSpecUiMeta => ({
  desc: `特征规格 ${spec.version}`,
  highlights: [`${spec.interval} 频率`, `lookback=${spec.lookbackBars}`, `${spec.columnCount} 列`],
})

export const FEATURE_SPECS: FeatureSpecEntry[] = PYTHON_FEATURE_SPECS.map((spec) => {
  const meta = FEATURE_SPEC_UI_META[spec.version] ?? fallbackMeta(spec)
  return {
    version: spec.version,
    interval: spec.interval,
    lookbackBars: spec.lookbackBars,
    columns: spec.columnCount,
    columnNames: spec.columns,
    desc: meta.desc,
    highlights: meta.highlights,
  }
})

export const DEFAULT_FEATURE_SPEC_VERSION = LATEST_PYTHON_FEATURE_SPEC_VERSION
