"""
数据精简脚本（PWA 迁移 · 阶段 1）

从 data/blind-seed.db 导出符合筛选规则的股票，生成分层数据包：
  - builtin-100:  100 只最活跃股（随 App 打包）
  - starter-500:  500 只精选（首次启动下载）
  - full-ALL:     筛选后全量（可选下载）

用法：
  python3 scripts/shrink_seed_for_web.py [--src PATH] [--out DIR]

无第三方依赖，仅用 Python 标准库（与 generate_seed.py 风格一致）。
"""

import argparse
import json
import os
import sqlite3
import sys
import time

DEFAULT_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'blind-seed.db')
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'web-packs')

# 筛选规则（来自 design §6.6）
# 排除：ST、低价(<3元最新收盘)、银行/券商/保险/红利
# 注意：list_date 字段为空，新股用 K 线最早日期 > 2023-01-01 识别（见 detect_new_stocks）
FILTER_SQL = """
name NOT LIKE '%ST%'
AND name NOT LIKE '%*ST%'
AND name NOT LIKE '%银行%'
AND name NOT LIKE '%证券%'
AND name NOT LIKE '%保险%'
AND name NOT LIKE '%红利%'
"""

# 新股判定：K 线最早日期晚于此阈值视为新股，排除
NEW_STOCK_DATE_THRESHOLD = '20230101'

# 分层包配置
PACKS = [
    {'name': 'builtin-100', 'size': 100, 'sort': 'activity', 'desc': '内置包·最活跃100只'},
    {'name': 'starter-500', 'size': 500, 'sort': 'activity', 'desc': '首启包·精选500只'},
    {'name': 'full-ALL', 'size': None, 'sort': None, 'desc': '全量包·筛选后全部'},
]


def main():
    parser = argparse.ArgumentParser(description='为 PWA 生成精简数据包')
    parser.add_argument('--src', default=DEFAULT_SRC, help='源数据库路径')
    parser.add_argument('--out', default=DEFAULT_OUT, help='输出目录')
    args = parser.parse_args()

    if not os.path.exists(args.src):
        print(f'错误：源数据库不存在：{args.src}', file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)
    print(f'源库：{args.src}')
    print(f'输出：{args.out}')
    print('（骨架已就绪，筛选与导出逻辑在后续 task 实现）')


if __name__ == '__main__':
    main()
