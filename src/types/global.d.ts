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
  SignalFeedbackSubmitData,
  SignalInferenceRunData,
  SessionActionRecord,
  SessionFinishData,
  SessionReview,
  SessionSummary,
  SaveTradeActionInput,
  SaveTradeActionResult,
  CandidateGenerationData,
  CandidateReviewData,
  LabelReviewData,
  LabelStatusUpdateData,
  LabelingTaskTriggerData,
  ModelActivationData,
  ModelDescriptionData,
  ModelMutationData,
  ModelRenameData,
  ProfileDeleteData,
  RetrainingTriggerData,
  ThresholdOptimizationData,
  BacktestRunData,
  BacktestReportData,
  PlatformResult,
  UnknownRecord
} from './ipc'

declare global {
  interface Window {
    electronAPI?: {
      quit?: () => void
      aichatGetDefaultConfig?: () => Promise<{ endpoint: string; apiKey: string; model: string }>
      aichatGetRecentSessions?: (limit?: number) => Promise<UnknownRecord[]>
      db?: {
        getStatistics: () => Promise<DbStatistics>
        saveSession: (session: SaveSessionInput) => Promise<SaveSessionResult>
        finishSession: (
          sessionId: string,
          finalCapital: number,
          realizedPnl: number,
          context?: FinishSessionContext
        ) => Promise<PlatformResult<SessionFinishData>>
        saveTradeAction: (action: SaveTradeActionInput) => Promise<SaveTradeActionResult>
        saveLabel: (label: SaveLabelInput) => Promise<SaveLabelResult>
        updateLabelStatus: (labelId: string, status: string, userConfidence?: number) => Promise<PlatformResult<LabelStatusUpdateData>>
        getSessionLabels: (sessionId: string) => Promise<UnknownRecord[]>
        getSessionActions: (sessionId: string) => Promise<SessionActionRecord[]>
        getSessionReview: (sessionId: string) => Promise<SessionReview | null>
        exportLabelsCSV: (sessionId: string) => Promise<string>
        listSessions: () => Promise<SessionSummary[]>
      }
      profile?: {
        list: () => Promise<UnknownRecord[]>
        getActive: () => Promise<UnknownRecord>
        create: (name: string, initialCapital: number) => Promise<UnknownRecord>
        load: (profileId: string) => Promise<UnknownRecord>
        delete: (profileId: string) => Promise<PlatformResult<ProfileDeleteData>>
        resetCapital: (profileId: string, newCapital: number) => Promise<UnknownRecord>
        getStats: (profileId?: string) => Promise<UnknownRecord | null>
      }
      listRetrainingRuns?: (limit?: number) => Promise<UnknownRecord[]>
      labeling?: {
        listLabels: () => Promise<UnknownRecord[]>
        createLabel: (label: SaveLabelInput) => Promise<SaveLabelResult>
        updateLabel: (label: UnknownRecord) => Promise<UnknownRecord>
        listReviewQueue: () => Promise<UnknownRecord[]>
        reviewCandidate: (labelId: string, decision: string) => Promise<PlatformResult<LabelReviewData>>
      }
      startSession?: (sampleId: string) => Promise<UnknownRecord>
      getSession?: (sessionId: string) => Promise<UnknownRecord>
      applyAction?: (action: SaveTradeActionInput) => Promise<SaveTradeActionResult>
      step?: (sessionId: string) => Promise<UnknownRecord>
      finish?: (sessionId: string) => Promise<UnknownRecord>
      getReview?: (sessionId: string) => Promise<UnknownRecord>
      listDatasets?: () => Promise<UnknownRecord[]>
      getDataset?: (datasetId: string) => Promise<UnknownRecord>
      getDatasetLabelDetails?: (datasetId: string, code: string, limit?: number) => Promise<DatasetLabelInspectResponse>
      createDatasetDraft?: (input?: {
        name?: string
        description?: string
        code?: string
        period?: string
        sourceStrategy?: string
        outcomeFilter?: 'all' | 'qualified_only'
        limit?: number
        conflictPolicy?: string
      }) => Promise<UnknownRecord>
      previewDatasetDraftPolicies?: (input?: {
        code?: string
        period?: string
        sourceStrategy?: string
        outcomeFilter?: 'all' | 'qualified_only'
        limit?: number
      }) => Promise<PlatformResult<DatasetPolicyPreviewData>>
      freezeDataset?: (datasetId: string) => Promise<PlatformResult<DatasetFreezeData>>
      deleteDraftDataset?: (datasetId: string) => Promise<PlatformResult<DatasetDeleteData>>
      compareDatasets?: (leftDatasetId: string, rightDatasetId: string) => Promise<PlatformResult<DatasetCompareData>>
      rollbackDatasetToDraft?: (sourceDatasetId: string, draftName?: string) => Promise<PlatformResult<DatasetRollbackData>>
      mergeDatasetsToDraft?: (
        leftDatasetId: string,
        rightDatasetId: string,
        input?: { name?: string; conflictPolicy?: string }
      ) => Promise<PlatformResult<DatasetMergeData>>
      listDatasetPolicyEvaluations?: (mode?: string, limit?: number) => Promise<UnknownRecord[]>
      getDatasetPolicyTrendReport?: (limit?: number) => Promise<UnknownRecord>
      getDatasetPolicyOutcomeReport?: (limit?: number) => Promise<UnknownRecord>
      getDatasetPolicyPnlAttributionReport?: (limit?: number) => Promise<UnknownRecord>
      getDatasetPolicySignalTradingOutcomeReport?: (limit?: number) => Promise<UnknownRecord>
      createFeatureBuildTask?: (datasetId: string, specVersion?: string, strictRealDataset?: boolean) => Promise<UnknownRecord>
      listFeatureBuildTasks?: (datasetId?: string, limit?: number) => Promise<UnknownRecord[]>
      getFeatureSampleAudit?: (featureTaskId: string) => Promise<UnknownRecord>
      createModelTrainingTask?: (
        datasetId: string,
        specVersion?: string,
        taskType?: string,
        engine?: string,
        trials?: number,
        trainingOptions?: { numBoostRound?: number; earlyStoppingRounds?: number; runName?: string }
      ) => Promise<UnknownRecord>
      listModelTrainingTasks?: (datasetId?: string, limit?: number) => Promise<UnknownRecord[]>
      deleteTrainingTask?: (taskId: string) => Promise<UnknownRecord>
      deleteFeatureTask?: (taskId: string) => Promise<UnknownRecord>
      deleteRetrainingRun?: (runId: string) => Promise<UnknownRecord>
      deleteLabelingTask?: (taskId: string) => Promise<UnknownRecord>
      clearOldRecords?: (table: string, days: number) => Promise<UnknownRecord>
      updateTrainingTaskStatus?: (taskId: string, status: string) => Promise<UnknownRecord>
      listModels?: () => Promise<UnknownRecord[]>
      getModel?: (modelId: string) => Promise<UnknownRecord>
      listModelEvaluations?: (modelId?: string, limit?: number) => Promise<UnknownRecord[]>
      getActiveModel?: () => Promise<UnknownRecord>
      getPredictionSettings?: () => Promise<UnknownRecord>
      updatePredictionSettings?: (input?: UnknownRecord) => Promise<UnknownRecord>
      getOutcomeGateSettings?: () => Promise<UnknownRecord>
      updateOutcomeGateSettings?: (input?: UnknownRecord) => Promise<UnknownRecord>
      syncModelArtifacts?: () => Promise<UnknownRecord>
      runSignalInference?: (code: string, period: string, minConfidence?: number) => Promise<PlatformResult<SignalInferenceRunData>>
      runSignalScan?: (periods?: string[], options?: { maxCodesPerPeriod?: number; minConfidence?: number }) => Promise<UnknownRecord>
      runHistoricalReplay?: (options?: { period?: string; startDate?: string; endDate?: string; minConfidence?: number }) => Promise<UnknownRecord>
      listSignalEvents?: (filters?: { code?: string; period?: string; modelId?: string; status?: string; limit?: number }) => Promise<UnknownRecord[]>
      listRecommendationReview?: (filters?: {
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
      }) => Promise<UnknownRecord>
      cleanupLegacyReplayRecommendations?: () => Promise<PlatformResult<{ deleted: number }>>
      submitSignalFeedback?: (signalEventId: string, action: 'accept' | 'ignore' | 'modify', note?: string) => Promise<PlatformResult<SignalFeedbackSubmitData>>
      backfillFeedbackCandidates?: (limit?: number, sinceCreatedAt?: number) => Promise<PlatformResult<FeedbackBackfillData>>
      createFeedbackRetrainingRun?: (input?: {
        triggerType?: string
        specVersion?: string
        taskType?: string
        sampleLimit?: number
        minSamples?: number
        activateOnSuccess?: boolean
        sinceCreatedAt?: number
      }) => Promise<PlatformResult<RetrainingTriggerData>>
      createIncrementalRetrainingRun?: (input?: {
        triggerType?: string
        specVersion?: string
        taskType?: string
        sampleLimit?: number
        minSamples?: number
        activateOnSuccess?: boolean
        sinceCreatedAt?: number
      }) => Promise<PlatformResult<RetrainingTriggerData>>
      activateModel?: (modelId: string) => Promise<PlatformResult<ModelActivationData>>
      deleteModel?: (modelId: string) => Promise<PlatformResult<ModelMutationData>>
      renameModel?: (modelId: string, newName: string) => Promise<PlatformResult<ModelRenameData>>
      deactivateModel?: (modelId: string) => Promise<PlatformResult<ModelMutationData>>
      updateModelDescription?: (modelId: string, description: string) => Promise<PlatformResult<ModelDescriptionData>>
      predictLive?: (modelId: string, code: string, period: string) => Promise<UnknownRecord>
      predictBatch?: (modelId: string, codes: string[], period: string) => Promise<UnknownRecord>
      predictSeries?: (modelId: string, code: string, period: string) => Promise<UnknownRecord>
      getModelArtifact?: (modelId: string) => Promise<UnknownRecord>
      getModelReport?: (modelId: string) => Promise<UnknownRecord>
      createEnsemble?: (trendModelId: string, reversalModelId: string, weightTrend?: number) => Promise<UnknownRecord>
      ensembleWalkforward?: (params: Record<string, unknown>) => Promise<UnknownRecord>
      runTask?: (taskType: string, params: Record<string, unknown>) => Promise<UnknownRecord>
      generateCandidates?: (code: string, period: string, limit?: number) => Promise<PlatformResult<CandidateGenerationData>>
      listCandidates?: (filters?: { status?: string; code?: string; period?: string; limit?: number }) => Promise<UnknownRecord[]>
      reviewSignalCandidate?: (candidateId: string, decision: string, note?: string) => Promise<PlatformResult<CandidateReviewData>>
      generateLabels?: (params: {
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
      }) => Promise<UnknownRecord>
      runLabelingTask: (params: { labeler: string; qualityPreset?: string; stockLimit?: number; saveDb?: boolean }) => Promise<PlatformResult<LabelingTaskTriggerData>>
      cancelLabelGeneration?: () => Promise<UnknownRecord>
      listLabelers?: () => Promise<UnknownRecord>
      onLabelProgress?: (callback: (msg: string) => void) => () => void
      getSwingReviewQueue?: (params?: {
        sampleSize?: number
        status?: string
        sourceStrategy?: string
        signalType?: string
        stratify?: boolean
        runId?: string
        latestRunOnly?: boolean
      }) => Promise<UnknownRecord>
      getSwingLabelDetails?: (params: {
        code: string
        signalType?: string
        sourceStrategy?: string
        status?: string
        pairOnly?: boolean
        limit?: number
        runId?: string
        latestRunOnly?: boolean
      }) => Promise<UnknownRecord>
      reviewSwingLabelRun?: (params?: {
        decision?: 'accept' | 'reject'
        runId?: string
        sourceStrategy?: string
        latestRunOnly?: boolean
        status?: string
      }) => Promise<UnknownRecord>
      listSwingLabelRuns?: (params?: {
        sourceStrategy?: string
        limit?: number
        includeRejected?: boolean
      }) => Promise<UnknownRecord>
      createDatasetDraftFromRuns?: (params?: {
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
      }) => Promise<UnknownRecord>
      data?: {
        init: () => Promise<PlatformResult<DataInitData>>
        sync: (count: number, periods: string[]) => Promise<PlatformResult<DataSyncData>>
        getRandomSamples: (
          regime: string,
          period: string,
          count: number,
          options?: { maxBarsPerSymbol?: number; excludeRecent?: number; profileId?: string; candidateCount?: number; minPrice?: number }
        ) => Promise<UnknownRecord[]>
        getStockList: (limit: number) => Promise<UnknownRecord[]>
        getStats: () => Promise<DataStats>
        syncKline5m: (code: string, startDate: string, endDate: string) => Promise<UnknownRecord>
        syncStockList: () => Promise<UnknownRecord>
        syncKline: (code: string, interval: string, limit: number) => Promise<UnknownRecord>
        batchSync: (codes: string[], interval: string, limit: number) => Promise<UnknownRecord[]>
        getCandles: (code: string, interval: string, startDate?: string, endDate?: string) => Promise<UnknownRecord[]>
        getKline: (code: string, period: string, limit: number) => Promise<UnknownRecord[]>
        checkSufficiency: (codes: string[]) => Promise<{ results: Record<string, { barCount: number; needsBackfill: boolean }>; needsBackfill: string[]; sufficientCount: number }>
        backfill15m: (codes: string[]) => Promise<PlatformResult<DataBackfillData>>
        inspectMissingCoverage: () => Promise<UnknownRecord>
        executeBackfillPlan: (plan: { dailyCodes?: string[]; m15Codes?: string[]; m5Codes?: string[] }) => Promise<UnknownRecord>
        triggerIncrementalSync: () => Promise<UnknownRecord>
        rebuildStats: () => Promise<UnknownRecord>
        getAutoSyncStatus: () => Promise<{ lastSyncAt: string | null; nextSyncAt: string; syncing: boolean }>
        getIndexKline?: (code: string, startDate?: string, endDate?: string) => Promise<UnknownRecord>
        getIndexMeta?: () => Promise<UnknownRecord>
        getMarketDbConfig: () => Promise<UnknownRecord>
        setMarketDbConfig: (dbPath: string) => Promise<UnknownRecord>
      }
      backtest?: {
        listModels: () => Promise<UnknownRecord[]>
        run: (modelId: string, threshold: number, options?: { strategyType?: string; exitMode?: string; initialCapital?: number }) => Promise<PlatformResult<BacktestRunData>>
        getReport: (modelId: string) => Promise<PlatformResult<BacktestReportData>>
        optimizeThreshold: (modelId: string, objective: string) => Promise<PlatformResult<ThresholdOptimizationData>>
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
        ) => Promise<UnknownRecord>
        runWalkForward: (params: {
          datasetId: string
          specVersion: string
          threshold?: number
          holdingDays?: number
          trainDays?: number
          testDays?: number
          stepDays?: number
          maxWindows?: number
        }) => Promise<UnknownRecord>
      }
      research?: {
        factorAnalyze: (params: { dataPath: string; targetCol?: string }) => Promise<UnknownRecord>
        listDatasets: () => Promise<UnknownRecord>
        listFeatureTasks: (datasetId: string) => Promise<UnknownRecord>
        labelQuality: (params?: { datasetId?: string; preset?: 'strict' | 'balanced' | 'lenient' }) => Promise<UnknownRecord>
      }

      onTrainingLog?: (callback: (event: unknown, data: { stream: string; text: string }) => void) => void
      removeTrainingLogListener?: (callback: (event: unknown, data: { stream: string; text: string }) => void) => void

      log?: (level: string, message: string, data?: unknown) => void
    }
  }
}

export {}
