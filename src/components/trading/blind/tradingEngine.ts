import type { ManualActionType, TradingState } from './types'

export interface TradingEngineConfig {
  initialCapital: number
  commissionRate: number
  minCommission: number
  buyBudgetRatio: number
  lotSize: number
}

export const DEFAULT_TRADING_CONFIG: TradingEngineConfig = {
  initialCapital: 100_000,
  commissionRate: 0.0003,
  minCommission: 5,
  buyBudgetRatio: 0.5,
  lotSize: 100
}

export interface ExecutedTrade {
  actionType: ManualActionType
  price: number
  shares: number
  amount: number
  commission: number
  realizedPnl: number
}

type ExecutionFailure = {
  ok: false
  error: string
}

type ExecutionSuccess = {
  ok: true
  nextState: TradingState
  trade: ExecutedTrade
}

export type ManualActionExecution = ExecutionFailure | ExecutionSuccess

export interface SessionSettlement {
  nextState: TradingState
  autoCloseTrade: ExecutedTrade | null
}

export const createInitialTradingState = (
  initialCapital = DEFAULT_TRADING_CONFIG.initialCapital,
  fixedBuyAmount = 0
): TradingState => {
  return {
    cash: initialCapital,
    shares: 0,
    avgPrice: 0,
    realizedPnl: 0,
    fixedBuyAmount
  }
}

const calcCommission = (amount: number, config: TradingEngineConfig): number => {
  if (amount <= 0) return 0
  return Math.max(config.minCommission, amount * config.commissionRate)
}

const calcMaxAffordableShares = (
  cash: number,
  price: number,
  config: TradingEngineConfig
): number => {
  if (cash <= 0 || price <= 0) return 0
  const affordable = cash > config.minCommission
    ? (cash - config.minCommission) / (price * (1 + config.commissionRate))
    : 0
  return Math.floor(affordable / config.lotSize) * config.lotSize
}

export const computeEquity = (state: TradingState, markPrice: number): number => {
  const safePrice = Number.isFinite(markPrice) ? markPrice : 0
  return state.cash + state.shares * safePrice
}

export const computeUnrealizedPnl = (state: TradingState, markPrice: number): number => {
  if (state.shares <= 0) return 0
  const safePrice = Number.isFinite(markPrice) ? markPrice : 0
  return (safePrice - state.avgPrice) * state.shares
}

export const evaluateManualAction = (
  state: TradingState,
  actionType: ManualActionType,
  price: number,
  config: TradingEngineConfig = DEFAULT_TRADING_CONFIG
): ManualActionExecution => {
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: '当前价格异常，无法执行交易。' }
  }

  if (actionType === 'buy') {
    let budget = state.fixedBuyAmount > 0
      ? Math.min(state.fixedBuyAmount, state.cash)
      : state.cash * config.buyBudgetRatio

    let buyShares = budget > config.minCommission
      ? Math.floor((budget - config.minCommission) / (price * (1 + config.commissionRate) * config.lotSize)) * config.lotSize
      : 0

    if (buyShares <= 0) {
      return { ok: false, error: `可用资金不足，无法按 ${config.lotSize} 股单位买入。` }
    }

    let amount = buyShares * price
    let commission = calcCommission(amount, config)
    if (state.cash < amount + commission) {
      buyShares = calcMaxAffordableShares(state.cash, price, config)
      if (buyShares <= 0) {
        return { ok: false, error: '剩余资金不足以下一手。' }
      }
      amount = buyShares * price
      commission = calcCommission(amount, config)
    }

    const newShares = state.shares + buyShares
    const newAvgPrice = newShares > 0
      ? (state.shares * state.avgPrice + amount + commission) / newShares
      : 0
    const nextState: TradingState = {
      cash: state.cash - amount - commission,
      shares: newShares,
      avgPrice: newAvgPrice,
      realizedPnl: state.realizedPnl,
      fixedBuyAmount: state.fixedBuyAmount
    }

    return {
      ok: true,
      nextState,
      trade: {
        actionType: 'buy',
        price,
        shares: buyShares,
        amount,
        commission,
        realizedPnl: 0
      }
    }
  }

  if (actionType === 'sell') {
    if (state.shares <= 0) {
      return { ok: false, error: '当前无持仓，不能执行卖出。' }
    }

    const sellShares = state.shares
    const amount = sellShares * price
    const commission = calcCommission(amount, config)
    const realizedPnl = (price - state.avgPrice) * sellShares - commission
    const nextState: TradingState = {
      cash: state.cash + amount - commission,
      shares: 0,
      avgPrice: 0,
      realizedPnl: state.realizedPnl + realizedPnl,
      fixedBuyAmount: state.fixedBuyAmount
    }

    return {
      ok: true,
      nextState,
      trade: {
        actionType: 'sell',
        price,
        shares: sellShares,
        amount,
        commission,
        realizedPnl
      }
    }
  }

  if (actionType === 'hold') {
    return {
      ok: true,
      nextState: { ...state },
      trade: {
        actionType: 'hold',
        price,
        shares: state.shares,
        amount: 0,
        commission: 0,
        realizedPnl: 0
      }
    }
  }

  return {
    ok: true,
    nextState: { ...state },
    trade: {
      actionType: 'skip',
      price,
      shares: 0,
      amount: 0,
      commission: 0,
      realizedPnl: 0
    }
  }
}

export const settleAtSessionEnd = (
  state: TradingState,
  price: number,
  config: TradingEngineConfig = DEFAULT_TRADING_CONFIG
): SessionSettlement => {
  if (state.shares <= 0 || !Number.isFinite(price) || price <= 0) {
    return { nextState: { ...state }, autoCloseTrade: null }
  }

  const amount = state.shares * price
  const commission = calcCommission(amount, config)
  const realizedPnl = (price - state.avgPrice) * state.shares - commission

  return {
    nextState: {
      cash: state.cash + amount - commission,
      shares: 0,
      avgPrice: 0,
      realizedPnl: state.realizedPnl + realizedPnl,
      fixedBuyAmount: state.fixedBuyAmount
    },
    autoCloseTrade: {
      actionType: 'sell',
      price,
      shares: state.shares,
      amount,
      commission,
      realizedPnl
    }
  }
}
