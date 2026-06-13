import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

const checks = [
  {
    file: 'src/preload/index.ts',
    patterns: [
      /init:\s*\(\): Promise<PlatformResult<DataInitData>>/,
      /sync:\s*\(count: number, periods: string\[\]\): Promise<PlatformResult<DataSyncData>>/,
      /backfill15m:\s*\(codes: string\[\]\): Promise<PlatformResult<DataBackfillData>>/,
      /finishSession:[\s\S]*?\): Promise<PlatformResult<SessionFinishData>>/,
      /updateLabelStatus:\s*\(labelId: string, status: string, userConfidence\?: number\): Promise<PlatformResult<LabelStatusUpdateData>>/,
      /delete:\s*\(profileId: string\): Promise<PlatformResult<ProfileDeleteData>>/,
      /reviewCandidate\??:\s*\(labelId: string, decision: string\): Promise<PlatformResult<LabelReviewData>>/,
      /previewDatasetDraftPolicies\??:[\s\S]*?\): Promise<PlatformResult<DatasetPolicyPreviewData>>/,
      /freezeDataset\??:\s*\(datasetId: string\): Promise<PlatformResult<DatasetFreezeData>>/,
      /compareDatasets\??:\s*\(leftDatasetId: string, rightDatasetId: string\): Promise<PlatformResult<DatasetCompareData>>/,
      /rollbackDatasetToDraft\??:\s*\(sourceDatasetId: string, draftName\?: string\): Promise<PlatformResult<DatasetRollbackData>>/,
      /mergeDatasetsToDraft\??:[\s\S]*?\): Promise<PlatformResult<DatasetMergeData>>/,
      /runLabelingTask:[\s\S]*?\): Promise<PlatformResult<LabelingTaskTriggerData>>/,
      /runSignalInference\??:\s*\(code: string, period: string, minConfidence\?: number\): Promise<PlatformResult<SignalInferenceRunData>>/,
      /submitSignalFeedback\??:\s*\(signalEventId: string, action: SignalFeedbackAction, note\?: string\): Promise<PlatformResult<SignalFeedbackSubmitData>>/,
      /backfillFeedbackCandidates\??:\s*\(limit\?: number, sinceCreatedAt\?: number\): Promise<PlatformResult<FeedbackBackfillData>>/,
      /createFeedbackRetrainingRun\??:[\s\S]*?\): Promise<PlatformResult<RetrainingTriggerData>>/,
      /createIncrementalRetrainingRun\??:[\s\S]*?\): Promise<PlatformResult<RetrainingTriggerData>>/,
      /activateModel\??:\s*\(modelId: string\): Promise<PlatformResult<ModelActivationData>>/,
      /deleteModel\??:\s*\(modelId: string\): Promise<PlatformResult<ModelMutationData>>/,
      /renameModel\??:\s*\(modelId: string, newName: string\): Promise<PlatformResult<ModelRenameData>>/,
      /deactivateModel\??:\s*\(modelId: string\): Promise<PlatformResult<ModelMutationData>>/,
      /updateModelDescription\??:\s*\(modelId: string, description: string\): Promise<PlatformResult<ModelDescriptionData>>/,
      /generateCandidates\??:\s*\(code: string, period: string, limit\?: number\): Promise<PlatformResult<CandidateGenerationData>>/,
      /reviewSignalCandidate\??:[\s\S]*?\): Promise<PlatformResult<CandidateReviewData>>/,
      /run:\s*\(modelId: string, threshold: number, options\?: \{ strategyType\?: string; exitMode\?: string; initialCapital\?: number \}\): Promise<PlatformResult<BacktestRunData>>/,
      /getReport:\s*\(modelId: string\): Promise<PlatformResult<BacktestReportData>>/,
      /optimizeThreshold:\s*\(modelId: string, objective: string\): Promise<PlatformResult<ThresholdOptimizationData>>/,
    ],
  },
  {
    file: 'src/types/global.d.ts',
    patterns: [
      /init:\s*\(\) => Promise<PlatformResult<DataInitData>>/,
      /sync:\s*\(count: number, periods: string\[\]\) => Promise<PlatformResult<DataSyncData>>/,
      /backfill15m:\s*\(codes: string\[\]\) => Promise<PlatformResult<DataBackfillData>>/,
      /finishSession:[\s\S]*?\) => Promise<PlatformResult<SessionFinishData>>/,
      /updateLabelStatus:\s*\(labelId: string, status: string, userConfidence\?: number\) => Promise<PlatformResult<LabelStatusUpdateData>>/,
      /delete:\s*\(profileId: string\) => Promise<PlatformResult<ProfileDeleteData>>/,
      /reviewCandidate\??:\s*\(labelId: string, decision: string\) => Promise<PlatformResult<LabelReviewData>>/,
      /previewDatasetDraftPolicies\??:[\s\S]*?\) => Promise<PlatformResult<DatasetPolicyPreviewData>>/,
      /freezeDataset\??:\s*\(datasetId: string\) => Promise<PlatformResult<DatasetFreezeData>>/,
      /compareDatasets\??:\s*\(leftDatasetId: string, rightDatasetId: string\) => Promise<PlatformResult<DatasetCompareData>>/,
      /rollbackDatasetToDraft\??:\s*\(sourceDatasetId: string, draftName\?: string\) => Promise<PlatformResult<DatasetRollbackData>>/,
      /mergeDatasetsToDraft\??:[\s\S]*?\) => Promise<PlatformResult<DatasetMergeData>>/,
      /runLabelingTask:[\s\S]*?\) => Promise<PlatformResult<LabelingTaskTriggerData>>/,
      /runSignalInference\??:\s*\(code: string, period: string, minConfidence\?: number\) => Promise<PlatformResult<SignalInferenceRunData>>/,
      /submitSignalFeedback\??:\s*\(signalEventId: string, action: 'accept' \| 'ignore' \| 'modify', note\?: string\) => Promise<PlatformResult<SignalFeedbackSubmitData>>/,
      /backfillFeedbackCandidates\??:\s*\(limit\?: number, sinceCreatedAt\?: number\) => Promise<PlatformResult<FeedbackBackfillData>>/,
      /createFeedbackRetrainingRun\??:[\s\S]*?\) => Promise<PlatformResult<RetrainingTriggerData>>/,
      /createIncrementalRetrainingRun\??:[\s\S]*?\) => Promise<PlatformResult<RetrainingTriggerData>>/,
      /activateModel\??:\s*\(modelId: string\) => Promise<PlatformResult<ModelActivationData>>/,
      /deleteModel\??:\s*\(modelId: string\) => Promise<PlatformResult<ModelMutationData>>/,
      /renameModel\??:\s*\(modelId: string, newName: string\) => Promise<PlatformResult<ModelRenameData>>/,
      /deactivateModel\??:\s*\(modelId: string\) => Promise<PlatformResult<ModelMutationData>>/,
      /updateModelDescription\??:\s*\(modelId: string, description: string\) => Promise<PlatformResult<ModelDescriptionData>>/,
      /generateCandidates\??:\s*\(code: string, period: string, limit\?: number\) => Promise<PlatformResult<CandidateGenerationData>>/,
      /reviewSignalCandidate\??:[\s\S]*?\) => Promise<PlatformResult<CandidateReviewData>>/,
      /run:\s*\(modelId: string, threshold: number, options\?: \{ strategyType\?: string; exitMode\?: string; initialCapital\?: number \}\) => Promise<PlatformResult<BacktestRunData>>/,
      /getReport:\s*\(modelId: string\) => Promise<PlatformResult<BacktestReportData>>/,
      /optimizeThreshold:\s*\(modelId: string, objective: string\) => Promise<PlatformResult<ThresholdOptimizationData>>/,
    ],
  },
]

let failed = false

for (const check of checks) {
  const absPath = path.join(root, check.file)
  const source = fs.readFileSync(absPath, 'utf8')
  for (const pattern of check.patterns) {
    if (!pattern.test(source)) {
      failed = true
      console.error(`[contract-check] Missing pattern in ${check.file}: ${pattern}`)
    }
  }
}

if (failed) {
  process.exitCode = 1
} else {
  console.log('[contract-check] PlatformResult contract signatures look aligned.')
}
