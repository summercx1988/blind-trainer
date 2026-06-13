import { contextBridge, ipcRenderer } from 'electron'
import type {
  DataStats,
  DataBackfillData,
  DataInitData,
  DataSyncData,
  DatasetLabelInspectResponse,
  DatasetCompareData,
  DatasetDeleteData,
  DatasetFreezeData,
  DatasetMergeData,
  DatasetPolicyPreviewData,
  DatasetRollbackData,
  DbStatistics,
  FinishSessionContext,
  FeedbackBackfillData,
  SaveLabelInput,
  SaveLabelResult,
  SaveSessionInput,
  SaveSessionResult,
  SaveTradeActionInput,
  SaveTradeActionResult,
  ProfileDeleteData,
  SessionActionRecord,
  SessionFinishData,
  SessionReview,
  SessionSummary,
  CandidateGenerationData,
  CandidateReviewData,
  LabelReviewData,
  LabelStatusUpdateData,
  LabelingTaskTriggerData,
  ModelActivationData,
  ModelDescriptionData,
  ModelMutationData,
  ModelRenameData,
  RetrainingTriggerData,
  SignalFeedbackSubmitData,
  SignalInferenceRunData,
  ThresholdOptimizationData,
  BacktestRunData,
  BacktestReportData,
  PlatformResult,
  UnknownRecord
} from '../types/ipc'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

type SignalFeedbackAction = 'accept' | 'ignore' | 'modify'

const electronAPI = {
  quit: (): Promise<{ success: boolean }> => invoke('app:quit'),
  aichatGetDefaultConfig: (): Promise<{ endpoint: string; apiKey: string; model: string }> => invoke('aichat:getDefaultConfig'),
  aichatGetRecentSessions: (limit?: number): Promise<UnknownRecord[]> => invoke('aichat:getRecentSessions', limit),

  db: {
    getStatistics: (): Promise<DbStatistics> => invoke('db:getStatistics'),
    saveSession: (session: SaveSessionInput): Promise<SaveSessionResult> => invoke('db:saveSession', session),
    finishSession: (
      sessionId: string,
      finalCapital: number,
      realizedPnl: number,
      context?: FinishSessionContext
    ): Promise<PlatformResult<SessionFinishData>> => {
      return invoke('db:finishSession', sessionId, finalCapital, realizedPnl, context)
    },
    saveTradeAction: (action: SaveTradeActionInput): Promise<SaveTradeActionResult> => invoke('db:saveTradeAction', action),
    saveLabel: (label: SaveLabelInput): Promise<SaveLabelResult> => invoke('db:saveLabel', label),
    updateLabelStatus: (labelId: string, status: string, userConfidence?: number): Promise<PlatformResult<LabelStatusUpdateData>> => {
      return invoke('db:updateLabelStatus', labelId, status, userConfidence)
    },
    getSessionLabels: (sessionId: string): Promise<UnknownRecord[]> => invoke('db:getSessionLabels', sessionId),
    getSessionActions: (sessionId: string): Promise<SessionActionRecord[]> => invoke('db:getSessionActions', sessionId),
    getSessionReview: (sessionId: string): Promise<SessionReview | null> => invoke('db:getSessionReview', sessionId),
    exportLabelsCSV: (sessionId: string): Promise<string> => invoke('db:exportLabelsCSV', sessionId),
    listSessions: (): Promise<SessionSummary[]> => invoke('db:listSessions')
  },

  profile: {
    list: (): Promise<UnknownRecord[]> => invoke('profile:list'),
    getActive: (): Promise<UnknownRecord> => invoke('profile:getActive'),
    create: (name: string, initialCapital: number): Promise<UnknownRecord> => invoke('profile:create', name, initialCapital),
    load: (profileId: string): Promise<UnknownRecord> => invoke('profile:load', profileId),
    delete: (profileId: string): Promise<PlatformResult<ProfileDeleteData>> => invoke('profile:delete', profileId),
    resetCapital: (profileId: string, newCapital: number): Promise<UnknownRecord> => invoke('profile:resetCapital', profileId, newCapital)
  },

  labeling: {
    listLabels: (): Promise<UnknownRecord[]> => invoke('labeling:listLabels'),
    createLabel: (label: SaveLabelInput): Promise<SaveLabelResult> => invoke('labeling:createLabel', label),
    updateLabel: (label: UnknownRecord): Promise<UnknownRecord> => invoke('labeling:updateLabel', label),
    listReviewQueue: (): Promise<UnknownRecord[]> => invoke('labeling:listReviewQueue'),
    reviewCandidate: (labelId: string, decision: string): Promise<PlatformResult<LabelReviewData>> => invoke('labeling:reviewCandidate', labelId, decision),
  },

  startSession: (sampleId: string): Promise<UnknownRecord> => invoke('simulation:startSession', sampleId),
  getSession: (sessionId: string): Promise<UnknownRecord> => invoke('simulation:getSession', sessionId),
  applyAction: (action: SaveTradeActionInput): Promise<SaveTradeActionResult> => invoke('simulation:applyAction', action),
  step: (sessionId: string): Promise<UnknownRecord> => invoke('simulation:step', sessionId),
  finish: (sessionId: string): Promise<UnknownRecord> => invoke('simulation:finish', sessionId),
  getReview: (sessionId: string): Promise<UnknownRecord> => invoke('simulation:getReview', sessionId),

  listDatasets: (): Promise<UnknownRecord[]> => invoke('modeling:listDatasets'),
  getDataset: (datasetId: string): Promise<UnknownRecord> => invoke('modeling:getDataset', datasetId),
  getDatasetLabelDetails: (datasetId: string, code: string, limit?: number): Promise<DatasetLabelInspectResponse> => {
    return invoke('modeling:getDatasetLabelDetails', datasetId, code, limit)
  },
  createDatasetDraft: (input?: {
    name?: string
    description?: string
    code?: string
    period?: string
    sourceStrategy?: string
    outcomeFilter?: 'all' | 'qualified_only'
    limit?: number
    conflictPolicy?: string
  }): Promise<UnknownRecord> => invoke('modeling:createDatasetDraft', input),
  previewDatasetDraftPolicies: (input?: {
    code?: string
    period?: string
    sourceStrategy?: string
    outcomeFilter?: 'all' | 'qualified_only'
    limit?: number
  }): Promise<PlatformResult<DatasetPolicyPreviewData>> => invoke('modeling:previewDatasetDraftPolicies', input),
  freezeDataset: (datasetId: string): Promise<PlatformResult<DatasetFreezeData>> => invoke('modeling:freezeDataset', datasetId),
  deleteDraftDataset: (datasetId: string): Promise<PlatformResult<DatasetDeleteData>> => invoke('modeling:deleteDraftDataset', datasetId),
  compareDatasets: (leftDatasetId: string, rightDatasetId: string): Promise<PlatformResult<DatasetCompareData>> => {
    return invoke('modeling:compareDatasets', leftDatasetId, rightDatasetId)
  },
  rollbackDatasetToDraft: (sourceDatasetId: string, draftName?: string): Promise<PlatformResult<DatasetRollbackData>> => {
    return invoke('modeling:rollbackDatasetToDraft', sourceDatasetId, draftName)
  },
  mergeDatasetsToDraft: (
    leftDatasetId: string,
    rightDatasetId: string,
    input?: { name?: string; conflictPolicy?: string }
  ): Promise<PlatformResult<DatasetMergeData>> => invoke('modeling:mergeDatasetsToDraft', leftDatasetId, rightDatasetId, input),
  listDatasetPolicyEvaluations: (mode?: string, limit?: number): Promise<UnknownRecord[]> => {
    return invoke('modeling:listDatasetPolicyEvaluations', mode, limit)
  },
  getDatasetPolicyTrendReport: (limit?: number): Promise<UnknownRecord> => invoke('modeling:getDatasetPolicyTrendReport', limit),
  getDatasetPolicyOutcomeReport: (limit?: number): Promise<UnknownRecord> => invoke('modeling:getDatasetPolicyOutcomeReport', limit),
  getDatasetPolicyPnlAttributionReport: (limit?: number): Promise<UnknownRecord> => {
    return invoke('modeling:getDatasetPolicyPnlAttributionReport', limit)
  },
  getDatasetPolicySignalTradingOutcomeReport: (limit?: number): Promise<UnknownRecord> => {
    return invoke('modeling:getDatasetPolicySignalTradingOutcomeReport', limit)
  },
  createFeatureBuildTask: (datasetId: string, specVersion?: string, strictRealDataset?: boolean): Promise<UnknownRecord> => {
    return invoke('modeling:createFeatureBuildTask', datasetId, specVersion, strictRealDataset)
  },
  listFeatureBuildTasks: (datasetId?: string, limit?: number): Promise<UnknownRecord[]> => {
    return invoke('modeling:listFeatureBuildTasks', datasetId, limit)
  },
  getFeatureSampleAudit: (featureTaskId: string): Promise<UnknownRecord> => {
    return invoke('modeling:getFeatureSampleAudit', featureTaskId)
  },
  createModelTrainingTask: (
    datasetId: string,
    specVersion?: string,
    taskType?: string,
    engine?: string,
    trials?: number,
    trainingOptions?: { numBoostRound?: number; earlyStoppingRounds?: number; runName?: string }
  ): Promise<UnknownRecord> => {
    return invoke('modeling:createModelTrainingTask', datasetId, specVersion, taskType, engine, trials, trainingOptions)
  },
  listModelTrainingTasks: (datasetId?: string, limit?: number): Promise<UnknownRecord[]> => {
    return invoke('modeling:listModelTrainingTasks', datasetId, limit)
  },
  deleteTrainingTask: (taskId: string): Promise<UnknownRecord> => invoke('modeling:deleteTrainingTask', taskId),
  deleteFeatureTask: (taskId: string): Promise<UnknownRecord> => invoke('modeling:deleteFeatureTask', taskId),
  deleteRetrainingRun: (runId: string): Promise<UnknownRecord> => invoke('modeling:deleteRetrainingRun', runId),
  deleteLabelingTask: (taskId: string): Promise<UnknownRecord> => invoke('modeling:deleteLabelingTask', taskId),
  clearOldRecords: (table: string, days: number): Promise<UnknownRecord> => invoke('modeling:clearOldRecords', table, days),
  updateTrainingTaskStatus: (taskId: string, status: string): Promise<UnknownRecord> => invoke('modeling:updateTrainingTaskStatus', taskId, status),
  listModels: (): Promise<UnknownRecord[]> => invoke('modeling:listModels'),
  getModel: (modelId: string): Promise<UnknownRecord> => invoke('modeling:getModel', modelId),
  listModelEvaluations: (modelId?: string, limit?: number): Promise<UnknownRecord[]> => {
    return invoke('modeling:listModelEvaluations', modelId, limit)
  },
  getActiveModel: (): Promise<UnknownRecord> => invoke('modeling:getActiveModel'),
  getPredictionSettings: (): Promise<UnknownRecord> => invoke('modeling:getPredictionSettings'),
  updatePredictionSettings: (input?: UnknownRecord): Promise<UnknownRecord> => invoke('modeling:updatePredictionSettings', input),
  getOutcomeGateSettings: (): Promise<UnknownRecord> => invoke('modeling:getOutcomeGateSettings'),
  updateOutcomeGateSettings: (input?: UnknownRecord): Promise<UnknownRecord> => invoke('modeling:updateOutcomeGateSettings', input),
  syncModelArtifacts: (): Promise<UnknownRecord> => invoke('modeling:syncModelArtifacts'),
  runSignalInference: (code: string, period: string, minConfidence?: number): Promise<PlatformResult<SignalInferenceRunData>> => {
    return invoke('modeling:runSignalInference', code, period, minConfidence)
  },
  runSignalScan: (periods?: string[], options?: { maxCodesPerPeriod?: number; minConfidence?: number }): Promise<UnknownRecord> => {
    return invoke('modeling:runSignalScan', periods, options)
  },
  runHistoricalReplay: (options?: { period?: string; startDate?: string; endDate?: string; minConfidence?: number }): Promise<UnknownRecord> => {
    return invoke('modeling:runHistoricalReplay', options)
  },
  listSignalEvents: (filters?: {
    code?: string
    period?: string
    modelId?: string
    status?: string
    limit?: number
  }): Promise<UnknownRecord[]> => invoke('modeling:listSignalEvents', filters),
  listRecommendationReview: (filters?: {
    modelId?: string
    period?: string
    startDate?: string
    endDate?: string
    horizonDays?: number
    limit?: number
    minPrice?: number
    maxPrice?: number
    minAmount?: number
    markets?: string[]
    source?: string
    latestBatchOnly?: boolean
    filterMa20Up?: boolean
    filterMa5GtMa20?: boolean
    filterAboveMa20?: boolean
  }): Promise<UnknownRecord> => invoke('modeling:listRecommendationReview', filters),
  cleanupLegacyReplayRecommendations: (): Promise<PlatformResult<{ deleted: number }>> => invoke('modeling:cleanupLegacyReplayRecommendations'),
  submitSignalFeedback: (signalEventId: string, action: SignalFeedbackAction, note?: string): Promise<PlatformResult<SignalFeedbackSubmitData>> => {
    return invoke('modeling:submitSignalFeedback', signalEventId, action, note)
  },
  backfillFeedbackCandidates: (limit?: number, sinceCreatedAt?: number): Promise<PlatformResult<FeedbackBackfillData>> => {
    return invoke('modeling:backfillFeedbackCandidates', limit, sinceCreatedAt)
  },
  createFeedbackRetrainingRun: (input?: {
    triggerType?: string
    specVersion?: string
    taskType?: string
    sampleLimit?: number
    minSamples?: number
    activateOnSuccess?: boolean
    sinceCreatedAt?: number
  }): Promise<PlatformResult<RetrainingTriggerData>> => invoke('modeling:createFeedbackRetrainingRun', input),
  createIncrementalRetrainingRun: (input?: {
    triggerType?: string
    specVersion?: string
    taskType?: string
    sampleLimit?: number
    minSamples?: number
    activateOnSuccess?: boolean
    sinceCreatedAt?: number
  }): Promise<PlatformResult<RetrainingTriggerData>> => invoke('modeling:createIncrementalRetrainingRun', input),
  activateModel: (modelId: string): Promise<PlatformResult<ModelActivationData>> => invoke('modeling:activateModel', modelId),
  deleteModel: (modelId: string): Promise<PlatformResult<ModelMutationData>> => invoke('modeling:deleteModel', modelId),
  renameModel: (modelId: string, newName: string): Promise<PlatformResult<ModelRenameData>> => invoke('modeling:renameModel', modelId, newName),
  deactivateModel: (modelId: string): Promise<PlatformResult<ModelMutationData>> => invoke('modeling:deactivateModel', modelId),
  updateModelDescription: (modelId: string, description: string): Promise<PlatformResult<ModelDescriptionData>> => invoke('modeling:updateModelDescription', modelId, description),
  predictLive: (modelId: string, code: string, period: string): Promise<UnknownRecord> => invoke('modeling:predictLive', modelId, code, period),
  predictBatch: (modelId: string, codes: string[], period: string): Promise<UnknownRecord> => invoke('modeling:predictBatch', modelId, codes, period),
  predictSeries: (modelId: string, code: string, period: string): Promise<UnknownRecord> => invoke('modeling:predictSeries', modelId, code, period),
  getModelArtifact: (modelId: string): Promise<UnknownRecord> => invoke('modeling:getModelArtifact', modelId),
  getModelReport: (modelId: string): Promise<UnknownRecord> => invoke('modeling:getModelReport', modelId),
  createEnsemble: (trendModelId: string, reversalModelId: string, weightTrend?: number): Promise<UnknownRecord> => {
    return invoke('modeling:createEnsemble', trendModelId, reversalModelId, weightTrend)
  },
  ensembleWalkforward: (params: Record<string, unknown>): Promise<UnknownRecord> => {
    return invoke('modeling:ensembleWalkforward', params)
  },
  runTask: (taskType: string, params: Record<string, unknown>): Promise<UnknownRecord> => {
    return invoke('modeling:runTask', taskType, params)
  },
  generateCandidates: (code: string, period: string, limit?: number): Promise<PlatformResult<CandidateGenerationData>> => {
    return invoke('modeling:generateCandidates', code, period, limit)
  },
  listCandidates: (filters?: { status?: string; code?: string; period?: string; limit?: number }): Promise<UnknownRecord[]> => {
    return invoke('modeling:listCandidates', filters)
  },
  reviewSignalCandidate: (
    candidateId: string,
    decision: string,
    note?: string
  ): Promise<PlatformResult<CandidateReviewData>> => {
    return invoke('modeling:reviewSignalCandidate', candidateId, decision, note)
  },
  generateLabels: (params: {
    labeler: string
    codes?: string[]
    start?: string
    end?: string
    strategy?: string
    qualityPreset?: string
    stockLimit?: number
    lookbackBars?: number
    minRequiredBars?: number
    forwardDays?: number
  }): Promise<UnknownRecord> => invoke('modeling:generateLabels', params),
  runLabelingTask: (params: { labeler: string; qualityPreset?: string; stockLimit?: number; saveDb?: boolean }): Promise<PlatformResult<LabelingTaskTriggerData>> => invoke('modeling:runLabelingTask', params),
  cancelLabelGeneration: (): Promise<UnknownRecord> => invoke('modeling:cancelLabelGeneration'),
  listLabelers: (): Promise<UnknownRecord> => invoke('modeling:listLabelers'),
  onLabelProgress: (callback: (msg: string) => void) => {
    const sub = (_event: Electron.IpcRendererEvent, msg: string) => callback(msg)
    ipcRenderer.on('modeling:labelProgress', sub)
    return () => { ipcRenderer.removeListener('modeling:labelProgress', sub) }
  },
  getSwingReviewQueue: (params?: {
    sampleSize?: number
    status?: string
    sourceStrategy?: string
    signalType?: string
    stratify?: boolean
    runId?: string
    latestRunOnly?: boolean
  }): Promise<UnknownRecord> => invoke('modeling:getSwingReviewQueue', params),
  getSwingLabelDetails: (params: {
    code: string
    signalType?: string
    sourceStrategy?: string
    status?: string
    pairOnly?: boolean
    limit?: number
    runId?: string
    latestRunOnly?: boolean
  }): Promise<UnknownRecord> => invoke('modeling:getSwingLabelDetails', params),
  reviewSwingLabelRun: (params?: {
    decision?: 'accept' | 'reject'
    runId?: string
    sourceStrategy?: string
    latestRunOnly?: boolean
    status?: string
  }): Promise<UnknownRecord> => invoke('modeling:reviewSwingLabelRun', params),
  listSwingLabelRuns: (params?: {
    sourceStrategy?: string
    limit?: number
    includeRejected?: boolean
  }): Promise<UnknownRecord> => invoke('modeling:listSwingLabelRuns', params),
  createDatasetDraftFromRuns: (params?: {
    runIds?: string[]
    name?: string
    sourceStrategy?: string
    conflictPolicy?: 'keep_all' | 'single_best'
    includeStatuses?: Array<'accepted' | 'proposed' | 'rejected'>
    limit?: number
    qualityFilter?: {
      labelMode: 'triple_barrier' | 'binary_profit' | 'raw'
      minProfitPct?: number
      minDrawdownRatio?: number
      minHoldDays?: number
    }
  }): Promise<UnknownRecord> => invoke('modeling:createDatasetDraftFromRuns', params),

  data: {
    init: (): Promise<PlatformResult<DataInitData>> => invoke('data:init'),
    sync: (count: number, periods: string[]): Promise<PlatformResult<DataSyncData>> => invoke('data:sync', count, periods),
    getRandomSamples: (
      regime: string,
      period: string,
      count: number,
      options?: { maxBarsPerSymbol?: number; excludeRecent?: number; profileId?: string; candidateCount?: number; minPrice?: number }
    ): Promise<UnknownRecord[]> => {
      return invoke('data:getRandomSamples', regime, period, count, options)
    },
    getStockList: (limit: number): Promise<UnknownRecord[]> => invoke('data:getStockList', limit),
    getStats: (): Promise<DataStats> => invoke('data:getStats'),
    syncKline5m: (code: string, startDate: string, endDate: string): Promise<UnknownRecord> => {
      return invoke('data:syncKline5m', code, startDate, endDate)
    },
    syncStockList: (): Promise<UnknownRecord> => invoke('data:syncStockList'),
    syncKline: (code: string, interval: string, limit: number): Promise<UnknownRecord> => invoke('data:syncKline', code, interval, limit),
    batchSync: (codes: string[], interval: string, limit: number): Promise<UnknownRecord[]> => invoke('data:batchSync', codes, interval, limit),
    getCandles: (code: string, interval: string, startDate?: string, endDate?: string): Promise<UnknownRecord[]> => invoke('data:getCandles', code, interval, startDate, endDate),
    checkSufficiency: (codes: string[]): Promise<{ results: Record<string, { barCount: number; needsBackfill: boolean }>; needsBackfill: string[]; sufficientCount: number }> => invoke('data:checkSufficiency', codes),
    getKline: (code: string, period: string, limit: number): Promise<UnknownRecord[]> => invoke('data:getKline', code, period, limit),
    backfill15m: (codes: string[]): Promise<PlatformResult<DataBackfillData>> => invoke('data:backfill15m', codes),
    inspectMissingCoverage: (): Promise<UnknownRecord> => invoke('data:inspectMissingCoverage'),
    executeBackfillPlan: (plan: { dailyCodes?: string[]; m15Codes?: string[]; m5Codes?: string[] }): Promise<UnknownRecord> => {
      return invoke('data:executeBackfillPlan', plan)
    },
    triggerIncrementalSync: (): Promise<UnknownRecord> => invoke('data:triggerIncrementalSync'),
    rebuildStats: (): Promise<UnknownRecord> => invoke('data:rebuildStats'),
    getAutoSyncStatus: (): Promise<{ lastSyncAt: string | null; nextSyncAt: string; syncing: boolean }> => invoke('data:getAutoSyncStatus'),
    getIndexKline: (code: string, startDate?: string, endDate?: string): Promise<UnknownRecord> => invoke('data:getIndexKline', code, startDate, endDate),
    getIndexMeta: (): Promise<UnknownRecord> => invoke('data:getIndexMeta'),
    getMarketDbConfig: (): Promise<UnknownRecord> => invoke('data:getMarketDbConfig'),
    setMarketDbConfig: (dbPath: string): Promise<UnknownRecord> => invoke('data:setMarketDbConfig', dbPath)
  },

  backtest: {
    listModels: (): Promise<UnknownRecord[]> => invoke('backtest:listModels'),
    run: (modelId: string, threshold: number, options?: { strategyType?: string; exitMode?: string; initialCapital?: number }): Promise<PlatformResult<BacktestRunData>> => invoke('backtest:run', modelId, threshold, options),
    getReport: (modelId: string): Promise<PlatformResult<BacktestReportData>> => invoke('backtest:getReport', modelId),
    optimizeThreshold: (modelId: string, objective: string): Promise<PlatformResult<ThresholdOptimizationData>> => invoke('backtest:optimizeThreshold', modelId, objective),
    runBenchmark: (
      modelId: string,
      options?: {
        startDate?: string
        endDate?: string
        codes?: string[]
        holdingDays?: number
        breakoutLookback?: number
        initialCapital?: number
      }
    ): Promise<UnknownRecord> => invoke('backtest:runBenchmark', modelId, options),
    runWalkForward: (params: {
      datasetId: string
      specVersion: string
      threshold?: number
      holdingDays?: number
      trainDays?: number
      testDays?: number
      stepDays?: number
      maxWindows?: number
    }): Promise<UnknownRecord> => invoke('backtest:runWalkForward', params)
  },

  research: {
    factorAnalyze: (params: { dataPath: string; targetCol?: string }): Promise<UnknownRecord> => invoke('research:factorAnalyze', params),
    listDatasets: (): Promise<UnknownRecord> => invoke('research:listDatasets'),
    listFeatureTasks: (datasetId: string): Promise<UnknownRecord> => invoke('research:listFeatureTasks', datasetId),
    labelQuality: (params?: { datasetId?: string; preset?: 'strict' | 'balanced' | 'lenient' }): Promise<UnknownRecord> => invoke('modeling:labelQuality', params)
  },

  onTrainingLog: (callback: (event: unknown, data: { stream: string; text: string }) => void) => {
    ipcRenderer.on('training:log', callback)
  },
  removeTrainingLogListener: (callback: (event: unknown, data: { stream: string; text: string }) => void) => {
    ipcRenderer.removeListener('training:log', callback)
  },

  log: (level: string, message: string, data?: unknown) => {
    ipcRenderer.invoke('app:log', level, message, data)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
