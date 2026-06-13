import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import log from './logger'
import Database from 'better-sqlite3'

export const DB_PATH = process.env.STOCK_TRADING_DB_PATH || process.env.TRADING_DB_PATH || path.join(app.getPath('userData'), 'stock-trading.db')
let db: Database.Database | null = null

const ensureColumns = (
  database: Database.Database,
  table: string,
  expected: Array<{ col: string; type: string }>
) => {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>
  for (const entry of expected) {
    if (!columns.some((column) => column.name === entry.col)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${entry.col} ${entry.type}`)
    }
  }
}

const ensureModelMetricColumns = (database: Database.Database) => {
  ensureColumns(database, 'model_versions', [
    { col: 'test_auc', type: 'REAL' },
    { col: 'test_accuracy', type: 'REAL' },
    { col: 'test_f1', type: 'REAL' },
    { col: 'test_precision', type: 'REAL' },
    { col: 'test_recall', type: 'REAL' },
    { col: 'train_auc', type: 'REAL' },
  ])

  ensureColumns(database, 'model_training_tasks', [
    { col: 'test_auc', type: 'REAL' },
    { col: 'test_accuracy', type: 'REAL' },
    { col: 'test_f1', type: 'REAL' },
  ])
}

const ensureRetrainingMetricColumns = (database: Database.Database) => {
  ensureColumns(database, 'retraining_runs', [
    { col: 'train_samples', type: 'INTEGER' },
    { col: 'test_samples', type: 'INTEGER' },
    { col: 'test_accuracy', type: 'REAL' },
    { col: 'test_f1', type: 'REAL' },
    { col: 'feature_count', type: 'INTEGER' },
  ])
}

const initTables = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS training_sessions (
      id TEXT PRIMARY KEY,
      sample_id TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      interval_type TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      status TEXT DEFAULT 'active',
      initial_capital REAL NOT NULL,
      final_capital REAL,
      realized_pnl REAL,
      total_trades INTEGER DEFAULT 0,
      winning_trades INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS trade_actions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      bar_index INTEGER NOT NULL,
      action_type TEXT NOT NULL CHECK(action_type IN ('buy', 'sell', 'hold', 'skip')),
      price REAL,
      shares INTEGER,
      amount REAL,
      commission REAL,
      position_before TEXT,
      position_after TEXT,
      unrealized_pnl REAL,
      realized_pnl REAL,
      source TEXT DEFAULT 'manual',
      strategy_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES training_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS session_reviews (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      trade_win_rate REAL NOT NULL DEFAULT 0,
      realized_pnl REAL NOT NULL DEFAULT 0,
      realized_pnl_pct REAL NOT NULL DEFAULT 0,
      max_drawdown_pct REAL NOT NULL DEFAULT 0,
      buy_count INTEGER NOT NULL DEFAULT 0,
      sell_count INTEGER NOT NULL DEFAULT 0,
      hold_count INTEGER NOT NULL DEFAULT 0,
      avg_holding_bars REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES training_sessions(id)
    );
    
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      bar_index INTEGER NOT NULL,
      label_type TEXT NOT NULL CHECK(label_type IN ('buy', 'sell', 'hold', 'no_action')),
      source TEXT NOT NULL,
      strategy_id TEXT,
      confidence REAL DEFAULT 0.5,
      user_confidence REAL,
      status TEXT DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'rejected', 'modified')),
      reason TEXT,
      note TEXT,
      version INTEGER DEFAULT 1,
      parent_version_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES training_sessions(id)
    );

    CREATE TABLE IF NOT EXISTS signal_candidates (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      stock_name TEXT,
      period TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      trade_time TEXT,
      bar_timestamp INTEGER NOT NULL,
      signal_type TEXT NOT NULL CHECK(signal_type IN ('buy', 'sell')),
      factor_type TEXT NOT NULL,
      score REAL DEFAULT 0,
      reason TEXT,
      source_strategy TEXT,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed', 'accepted', 'rejected', 'edited')),
      payload TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidate_review_logs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('accept', 'reject', 'edit')),
      operator TEXT DEFAULT 'user',
      note TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES signal_candidates(id)
    );

    CREATE TABLE IF NOT EXISTS dataset_versions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'frozen')),
      description TEXT,
      source_filter TEXT,
      sample_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      frozen_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS dataset_items (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      candidate_id TEXT,
      code TEXT NOT NULL,
      period TEXT NOT NULL,
      bar_timestamp INTEGER NOT NULL,
      label_type TEXT NOT NULL CHECK(label_type IN ('buy', 'sell', 'hold', 'no_action')),
      factor_type TEXT,
      source TEXT NOT NULL DEFAULT 'candidate_review',
      created_at INTEGER NOT NULL,
      UNIQUE(dataset_id, code, period, bar_timestamp, label_type),
      FOREIGN KEY (dataset_id) REFERENCES dataset_versions(id),
      FOREIGN KEY (candidate_id) REFERENCES signal_candidates(id)
    );

    CREATE TABLE IF NOT EXISTS feature_build_tasks (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      spec_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
      command TEXT,
      output_manifest_path TEXT,
      stdout TEXT,
      stderr TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      FOREIGN KEY (dataset_id) REFERENCES dataset_versions(id)
    );

    CREATE TABLE IF NOT EXISTS model_training_tasks (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      spec_version TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
      feature_task_id TEXT,
      command TEXT,
      model_artifact_path TEXT,
      eval_report_path TEXT,
      metrics_json TEXT,
      stdout TEXT,
      stderr TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      FOREIGN KEY (dataset_id) REFERENCES dataset_versions(id),
      FOREIGN KEY (feature_task_id) REFERENCES feature_build_tasks(id)
    );

    CREATE TABLE IF NOT EXISTS model_versions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('inactive', 'active', 'archived')),
      task_type TEXT NOT NULL,
      dataset_id TEXT NOT NULL,
      spec_version TEXT NOT NULL,
      training_task_id TEXT NOT NULL,
      artifact_path TEXT NOT NULL,
      metrics_json TEXT,
      created_at INTEGER NOT NULL,
      activated_at INTEGER,
      FOREIGN KEY (dataset_id) REFERENCES dataset_versions(id),
      FOREIGN KEY (training_task_id) REFERENCES model_training_tasks(id)
    );

    CREATE TABLE IF NOT EXISTS model_evaluations (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      split TEXT NOT NULL,
      accuracy REAL,
      precision REAL,
      recall REAL,
      f1 REAL,
      sample_count INTEGER,
      report_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (model_id) REFERENCES model_versions(id)
    );

    CREATE TABLE IF NOT EXISTS signal_events (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      code TEXT NOT NULL,
      period TEXT NOT NULL,
      bar_timestamp INTEGER NOT NULL,
      signal_type TEXT NOT NULL CHECK(signal_type IN ('buy', 'sell', 'hold')),
      confidence REAL NOT NULL DEFAULT 0,
      score REAL,
      threshold REAL,
      payload_json TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'read', 'feedback', 'ignored')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (model_id) REFERENCES model_versions(id)
    );

    CREATE TABLE IF NOT EXISTS model_recommendations (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      model_name TEXT,
      code TEXT NOT NULL,
      stock_name TEXT,
      signal_date TEXT NOT NULL,
      period TEXT NOT NULL DEFAULT '1d',
      probability REAL,
      threshold REAL NOT NULL,
      signal_type TEXT NOT NULL DEFAULT 'buy',
      confidence REAL,
      trade_executed INTEGER NOT NULL DEFAULT 0,
      entry_price REAL,
      exit_close REAL,
      exit_high REAL,
      actual_return REAL,
      best_return REAL,
      skip_reason TEXT,
      source TEXT NOT NULL DEFAULT 'backtest',
      backtest_id TEXT,
      spec_version TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (model_id) REFERENCES model_versions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_rec_model_date ON model_recommendations(model_id, signal_date);
    CREATE INDEX IF NOT EXISTS idx_rec_date ON model_recommendations(signal_date);
    CREATE INDEX IF NOT EXISTS idx_rec_source ON model_recommendations(source);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rec_unique_signal
      ON model_recommendations(model_id, source, period, signal_date, code);

    CREATE TABLE IF NOT EXISTS signal_feedback (
      id TEXT PRIMARY KEY,
      signal_event_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('accept', 'ignore', 'modify')),
      note TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (signal_event_id) REFERENCES signal_events(id)
    );

    CREATE TABLE IF NOT EXISTS retraining_runs (
      id TEXT PRIMARY KEY,
      trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual', 'scheduled', 'sync_after')),
      status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
      source TEXT NOT NULL DEFAULT 'feedback',
      spec_version TEXT NOT NULL,
      task_type TEXT NOT NULL,
      sample_limit INTEGER NOT NULL DEFAULT 800,
      activated INTEGER NOT NULL DEFAULT 0,
      backfill_summary_json TEXT,
      summary_json TEXT,
      dataset_id TEXT,
      feature_task_id TEXT,
      model_task_id TEXT,
      model_id TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS dataset_policy_evaluations (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('draft_preview', 'dataset_compare', 'dataset_merge')),
      left_dataset_id TEXT,
      right_dataset_id TEXT,
      filters_json TEXT,
      summary_json TEXT,
      recommended_policy TEXT CHECK(recommended_policy IN ('keep_all', 'single_best')),
      selected_policy TEXT CHECK(selected_policy IN ('keep_all', 'single_best')),
      applied_dataset_id TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_preferences (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_labels_session ON labels(session_id);
    CREATE INDEX IF NOT EXISTS idx_labels_bar ON labels(bar_index);
    CREATE INDEX IF NOT EXISTS idx_labels_source ON labels(source);
    CREATE INDEX IF NOT EXISTS idx_training_sessions_started_at ON training_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_trade_session ON trade_actions(session_id);
    CREATE INDEX IF NOT EXISTS idx_review_session ON session_reviews(session_id);
    CREATE INDEX IF NOT EXISTS idx_candidate_code_period ON signal_candidates(code, period);
    CREATE INDEX IF NOT EXISTS idx_candidate_status ON signal_candidates(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_candidate_review ON candidate_review_logs(candidate_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_dataset_status ON dataset_versions(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_dataset_item_dataset ON dataset_items(dataset_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_feature_task_dataset ON feature_build_tasks(dataset_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_feature_task_status ON feature_build_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_train_dataset ON model_training_tasks(dataset_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_train_status ON model_training_tasks(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_version_status ON model_versions(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_model_eval_model ON model_evaluations(model_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_signal_event_model ON signal_events(model_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_signal_event_code_period ON signal_events(code, period, bar_timestamp);
    CREATE INDEX IF NOT EXISTS idx_signal_feedback_event ON signal_feedback(signal_event_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_retraining_runs_status ON retraining_runs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_retraining_runs_trigger ON retraining_runs(trigger_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_dataset_policy_mode ON dataset_policy_evaluations(mode, created_at);
    CREATE INDEX IF NOT EXISTS idx_dataset_policy_pair ON dataset_policy_evaluations(left_dataset_id, right_dataset_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_app_preferences_updated ON app_preferences(updated_at DESC);
    
    CREATE TABLE IF NOT EXISTS labeling_tasks (
      id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
      config_json TEXT,
      codes_json TEXT,
      date_range_start TEXT,
      date_range_end TEXT,
      total_signals INTEGER DEFAULT 0,
      buy_signals INTEGER DEFAULT 0,
      sell_signals INTEGER DEFAULT 0,
      buy_win_rate REAL,
      summary_json TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    
    CREATE INDEX IF NOT EXISTS idx_labeling_task_status ON labeling_tasks(status, created_at);
    
    CREATE TABLE IF NOT EXISTS samples (
      id TEXT PRIMARY KEY,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      interval_type TEXT NOT NULL,
      start_bar_index INTEGER,
      warmup_bars INTEGER DEFAULT 60,
      forward_bars INTEGER DEFAULT 50,
      regime_tag TEXT,
      difficulty_score REAL,
      anonymize_level TEXT DEFAULT 'strict',
      actual_date TEXT,
      data_hash TEXT,
      created_at INTEGER NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      type TEXT NOT NULL,
      params TEXT,
      is_active INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    
    INSERT OR IGNORE INTO strategies (id, name, description, type, params, priority, created_at) VALUES
      ('pullback_ma5', 'MA5回踩策略', '价格回踩MA5均线支撑位时买入', 'pullback', '{"ma_period": 5}', 10, strftime('%s','now')),
      ('pullback_ma10', 'MA10回踩策略', '价格回踩MA10均线支撑位时买入', 'pullback', '{"ma_period": 10}', 9, strftime('%s','now')),
      ('pullback_ma20', 'MA20回踩策略', '价格回踩MA20均线支撑位时买入', 'pullback', '{"ma_period": 20}', 8, strftime('%s','now')),
      ('breakout_resistance', '阻力突破策略', '价格突破前高阻力位时买入', 'breakout', '{"lookback": 20}', 7, strftime('%s','now')),
      ('breakout_ma', '均线突破策略', '价格突破长期均线时买入', 'breakout', '{"ma_long": 60}', 6, strftime('%s','now')),
      ('momentum_volume', '动量突破策略', '成交量突增配合价格突破', 'momentum', '{"volume_ratio": 2.5, "price_change_pct": 1.5}', 5, strftime('%s','now')),
      ('reversal_oversold', '超跌反转策略', '连续下跌后出现反转信号', 'reversal', '{"consecutive_down": 3, "lower_shadow_ratio": 0.3}', 4, strftime('%s','now'));
    
    CREATE TABLE IF NOT EXISTS stock_list (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT,
      industry TEXT,
      list_date TEXT,
      updated_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS kline_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      amount REAL,
      change_pct REAL,
      UNIQUE(code, trade_date)
    );
    
    CREATE TABLE IF NOT EXISTS kline_15m (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      trade_time TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      amount REAL,
      UNIQUE(code, trade_date, trade_time)
    );
    
    CREATE TABLE IF NOT EXISTS kline_5m (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      trade_time TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL,
      amount REAL,
      UNIQUE(code, trade_date, trade_time)
    );

    CREATE TABLE IF NOT EXISTS stock_kline_stats (
      code TEXT PRIMARY KEY,
      daily_count INTEGER NOT NULL DEFAULT 0,
      m15_count INTEGER NOT NULL DEFAULT 0,
      m5_count INTEGER NOT NULL DEFAULT 0,
      last_daily TEXT,
      last_m15 TEXT,
      last_m5 TEXT,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY (code) REFERENCES stock_list(code)
    );
    
    CREATE INDEX IF NOT EXISTS idx_daily_code_date ON kline_daily(code, trade_date);
    CREATE INDEX IF NOT EXISTS idx_15m_code_date ON kline_15m(code, trade_date);
    CREATE INDEX IF NOT EXISTS idx_5m_code_date ON kline_5m(code, trade_date);
    CREATE INDEX IF NOT EXISTS idx_stock_kline_stats_updated ON stock_kline_stats(updated_at DESC)
  `)
}

const CURRENT_SCHEMA_VERSION = 7

interface SchemaMigration {
  version: number
  description: string
  up: (database: Database.Database) => void
}

const schemaMigrations: SchemaMigration[] = [
  {
    version: 1,
    description: 'deduplicate signal events and enforce unique reminder key',
    up: (database) => {
      database.exec(`
        DELETE FROM signal_events
        WHERE rowid NOT IN (
          SELECT MIN(rowid)
          FROM signal_events
          GROUP BY model_id, code, period, bar_timestamp, signal_type
        );
      `)
      database.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_signal_event_dedup
        ON signal_events(model_id, code, period, bar_timestamp, signal_type);
      `)
    }
  },
  {
    version: 2,
    description: 'add training_profiles table and profile_id to sessions',
    up: (database) => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS training_profiles (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          initial_capital REAL NOT NULL DEFAULT 100000,
          current_capital REAL NOT NULL DEFAULT 100000,
          total_sessions INTEGER NOT NULL DEFAULT 0,
          total_pnl REAL NOT NULL DEFAULT 0,
          total_wins INTEGER NOT NULL DEFAULT 0,
          total_losses INTEGER NOT NULL DEFAULT 0,
          total_duration_seconds REAL NOT NULL DEFAULT 0,
          is_active INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_profiles_active ON training_profiles(is_active);

        INSERT OR IGNORE INTO training_profiles (id, name, initial_capital, current_capital, is_active, created_at, updated_at)
        VALUES ('default', '默认存档', 100000, 100000, 1, strftime('%s','now'), strftime('%s','now'));
      `)

      const columns = database.prepare("PRAGMA table_info(training_sessions)").all() as { name: string }[]
      if (!columns.some((c) => c.name === 'profile_id')) {
        database.exec(`ALTER TABLE training_sessions ADD COLUMN profile_id TEXT DEFAULT 'default' REFERENCES training_profiles(id)`)
      }
    }
  },
  {
    version: 3,
    description: 'add description column to model_versions',
    up: (database) => {
      const columns = database.prepare("PRAGMA table_info(model_versions)").all() as { name: string }[]
      if (!columns.some((c) => c.name === 'description')) {
        database.exec(`ALTER TABLE model_versions ADD COLUMN description TEXT DEFAULT ''`)
      }
    }
  },
  {
    version: 4,
    description: 'add efficiency metrics to session_reviews and profile cumulative stats',
    up: (database) => {
      const reviewColumns = database.prepare("PRAGMA table_info(session_reviews)").all() as { name: string }[]
      if (!reviewColumns.some((c) => c.name === 'avg_holding_days')) {
        database.exec(`ALTER TABLE session_reviews ADD COLUMN avg_holding_days REAL NOT NULL DEFAULT 0`)
      }
      if (!reviewColumns.some((c) => c.name === 'avg_daily_return_pct')) {
        database.exec(`ALTER TABLE session_reviews ADD COLUMN avg_daily_return_pct REAL NOT NULL DEFAULT 0`)
      }
      if (!reviewColumns.some((c) => c.name === 'win_hold_efficiency')) {
        database.exec(`ALTER TABLE session_reviews ADD COLUMN win_hold_efficiency REAL NOT NULL DEFAULT 0`)
      }
      if (!reviewColumns.some((c) => c.name === 'total_trades')) {
        database.exec(`ALTER TABLE session_reviews ADD COLUMN total_trades INTEGER NOT NULL DEFAULT 0`)
      }
      if (!reviewColumns.some((c) => c.name === 'winning_trades')) {
        database.exec(`ALTER TABLE session_reviews ADD COLUMN winning_trades INTEGER NOT NULL DEFAULT 0`)
      }

      const profileColumns = database.prepare("PRAGMA table_info(training_profiles)").all() as { name: string }[]
      if (!profileColumns.some((c) => c.name === 'total_holding_days')) {
        database.exec(`ALTER TABLE training_profiles ADD COLUMN total_holding_days REAL NOT NULL DEFAULT 0`)
      }
      if (!profileColumns.some((c) => c.name === 'total_trades_count')) {
        database.exec(`ALTER TABLE training_profiles ADD COLUMN total_trades_count INTEGER NOT NULL DEFAULT 0`)
      }
      if (!profileColumns.some((c) => c.name === 'total_winning_trades')) {
        database.exec(`ALTER TABLE training_profiles ADD COLUMN total_winning_trades INTEGER NOT NULL DEFAULT 0`)
      }
      if (!profileColumns.some((c) => c.name === 'avg_session_return_pct')) {
        database.exec(`ALTER TABLE training_profiles ADD COLUMN avg_session_return_pct REAL NOT NULL DEFAULT 0`)
      }
      if (!profileColumns.some((c) => c.name === 'best_session_return_pct')) {
        database.exec(`ALTER TABLE training_profiles ADD COLUMN best_session_return_pct REAL NOT NULL DEFAULT 0`)
      }
      if (!profileColumns.some((c) => c.name === 'worst_session_return_pct')) {
        database.exec(`ALTER TABLE training_profiles ADD COLUMN worst_session_return_pct REAL NOT NULL DEFAULT 0`)
      }
      if (!profileColumns.some((c) => c.name === 'max_drawdown_pct')) {
        database.exec(`ALTER TABLE training_profiles ADD COLUMN max_drawdown_pct REAL NOT NULL DEFAULT 0`)
      }
    }
  },
  {
    version: 5,
    description: 'add test metrics columns to model_versions and model_training_tasks',
    up: (database) => {
      ensureModelMetricColumns(database)
      ensureRetrainingMetricColumns(database)

      const rows = database.prepare(
        "SELECT id, metrics_json FROM model_versions WHERE metrics_json IS NOT NULL AND test_auc IS NULL"
      ).all() as Array<{ id: string; metrics_json: string }>
      const stmt = database.prepare(
        'UPDATE model_versions SET test_auc=?, test_accuracy=?, test_f1=?, test_precision=?, test_recall=?, train_auc=? WHERE id=?'
      )
      for (const row of rows) {
        try {
          const m = JSON.parse(row.metrics_json)
          const test = m?.test || {}
          const train = m?.train || {}
          stmt.run(
            typeof test.auc === 'number' ? test.auc : null,
            typeof test.accuracy === 'number' ? test.accuracy : null,
            typeof test.f1 === 'number' ? test.f1 : null,
            typeof test.precision === 'number' ? test.precision : null,
            typeof test.recall === 'number' ? test.recall : null,
            typeof train.auc === 'number' ? train.auc : null,
            row.id
          )
        } catch { /* skip unparseable rows */ }
      }

      const taskRows = database.prepare(
        "SELECT id, metrics_json FROM model_training_tasks WHERE metrics_json IS NOT NULL AND test_auc IS NULL"
      ).all() as Array<{ id: string; metrics_json: string }>
      const taskStmt = database.prepare(
        'UPDATE model_training_tasks SET test_auc=?, test_accuracy=?, test_f1=? WHERE id=?'
      )
      for (const row of taskRows) {
        try {
          const m = JSON.parse(row.metrics_json)
          const test = m?.test || {}
          taskStmt.run(
            typeof test.auc === 'number' ? test.auc : null,
            typeof test.accuracy === 'number' ? test.accuracy : null,
            typeof test.f1 === 'number' ? test.f1 : null,
            row.id
          )
        } catch { /* skip */ }
      }

      const rrRows = database.prepare(
        "SELECT id, summary_json FROM retraining_runs WHERE summary_json IS NOT NULL AND train_samples IS NULL"
      ).all() as Array<{ id: string; summary_json: string }>
      const rrStmt = database.prepare(
        'UPDATE retraining_runs SET train_samples=?, test_samples=?, test_accuracy=?, test_f1=?, feature_count=? WHERE id=?'
      )
      for (const row of rrRows) {
        try {
          const s = JSON.parse(row.summary_json)
          rrStmt.run(
            typeof s.trainSamples === 'number' ? s.trainSamples : null,
            typeof s.testSamples === 'number' ? s.testSamples : null,
            typeof s.testAccuracy === 'number' ? s.testAccuracy : null,
            typeof s.testF1 === 'number' ? s.testF1 : null,
            typeof s.featureCount === 'number' ? s.featureCount : null,
            row.id
          )
        } catch { /* skip */ }
      }
    }
  },
  {
    version: 6,
    description: 'ensure test_auc columns exist on model_versions and model_training_tasks',
    up: (database) => {
      ensureModelMetricColumns(database)
    }
  },
  {
    version: 7,
    description: 'add label_policy_json to dataset_versions and sample_role to dataset_items',
    up: (database) => {
      ensureColumns(database, 'dataset_versions', [
        { col: 'label_policy_json', type: 'TEXT' }
      ])
      ensureColumns(database, 'dataset_items', [
        { col: 'sample_role', type: "TEXT NOT NULL DEFAULT 'candidate_buy'" }
      ])
    }
  }
]

const applySchemaMigrations = (database: Database.Database) => {
  const currentVersion = Number(database.pragma('user_version', { simple: true }) || 0)
  if (currentVersion >= CURRENT_SCHEMA_VERSION) return

  const pending = schemaMigrations
    .filter((migration) => migration.version > currentVersion)
    .sort((left, right) => left.version - right.version)
  if (pending.length === 0) {
    database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`)
    return
  }

  const runMigrations = database.transaction(() => {
    for (const migration of pending) {
      migration.up(database)
      database.exec(`PRAGMA user_version = ${migration.version}`)
    }
  })
  runMigrations()
}

const ensurePostMigrationIndexes = (database: Database.Database) => {
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_training_sessions_profile_started ON training_sessions(profile_id, started_at DESC)')
  } catch {
    // profile_id may not exist in very old/partial schemas; ignore and let migrations fix it first.
  }
}

const ensureCriticalSchemaCompatibility = (database: Database.Database) => {
  ensureModelMetricColumns(database)
  ensureRetrainingMetricColumns(database)
  ensureColumns(database, 'dataset_versions', [
    { col: 'label_policy_json', type: 'TEXT' },
  ])
  ensureColumns(database, 'dataset_items', [
    { col: 'sample_role', type: "TEXT NOT NULL DEFAULT 'candidate_buy'" },
  ])
}

const isSqliteCorruption = (error: unknown): boolean => {
  const record = error as { code?: unknown; message?: unknown }
  const code = String(record?.code ?? '')
  const message = String(record?.message ?? error)
  return code === 'SQLITE_CORRUPT' || /database disk image is malformed|database is malformed|SQLITE_CORRUPT/i.test(message)
}

const quarantineCorruptDatabase = (): string => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  const targetDir = path.join(path.dirname(DB_PATH), `corrupt-db-${stamp}`)
  fs.mkdirSync(targetDir, { recursive: true })

  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${DB_PATH}${suffix}`
    if (!fs.existsSync(source)) continue
    fs.renameSync(source, path.join(targetDir, `${path.basename(DB_PATH)}${suffix}`))
  }

  return targetDir
}

const openAndInitializeDb = (): Database.Database => {
  const database = new Database(DB_PATH)
  try {
    database.pragma('foreign_keys = ON')
    database.pragma('journal_mode = WAL')
    initTables(database)
    applySchemaMigrations(database)
    ensureCriticalSchemaCompatibility(database)
    ensurePostMigrationIndexes(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

export const getDb = (): Database.Database => {
  if (!db) {
    try {
      db = openAndInitializeDb()
    } catch (error) {
      if (!isSqliteCorruption(error)) throw error

      const quarantineDir = quarantineCorruptDatabase()
      log.error(`[db] SQLite database is corrupt; moved it to ${quarantineDir} and rebuilt a fresh database.`)
      db = openAndInitializeDb()
    }
  }
  return db
}

export const closeDb = () => {
  if (!db) return
  db.close()
  db = null
}
