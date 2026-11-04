#!/usr/bin/env python3
"""Qualify existing intraday files offline. Never fetch, fill, or update inputs."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from ingest.intraday_qualification import CalendarProjection, GRAINS, qualify_store  # noqa: E402


def load_pilot(path: Path) -> tuple[dict, str]:
    raw = path.read_bytes()
    data = json.loads(raw)
    if (not isinstance(data, dict)
            or data.get('schema') != 'mastermind.tactical_research_pilot.v1'
            or data.get('membership_basis') != 'fixed_current_development_only'
            or data.get('not_a_trade_recommendation') is not True
            or not isinstance(data.get('cohort_id'), str)
            or not re.fullmatch(r'[A-Z0-9-]{1,64}', data['cohort_id'])):
        raise ValueError('invalid_pilot_identity')
    symbols = data.get('symbols'); grains = data.get('timeframes')
    if (not isinstance(symbols, list) or not 1 <= len(symbols) <= 100
            or any(not isinstance(x, str) or not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}', x)
                   for x in symbols) or len(set(symbols)) != len(symbols)):
        raise ValueError('invalid_pilot_symbols')
    if (not isinstance(grains, list) or not grains
            or any(not isinstance(x, str) or x not in GRAINS for x in grains)
            or len(set(grains)) != len(grains)):
        raise ValueError('invalid_pilot_timeframes')
    return data, hashlib.sha256(raw).hexdigest()


def parse_cutoff(value: str) -> int:
    try:
        instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if instant.utcoffset() is None or instant.microsecond:
            raise ValueError('explicit timezone and whole seconds required')
        return int(instant.astimezone(timezone.utc).timestamp())
    except (ValueError, OverflowError) as error:
        raise argparse.ArgumentTypeError('cutoff requires timezone-aware ISO date/time') from error


def markdown(report: dict) -> str:
    lines = [
        '# Intraday history qualification', '',
        '**This report is not a signal, a backtest, or evidence of a trading edge.**', '',
        f"Cohort: `{report['cohort_id']}`; membership: `{report['membership_basis']}`.",
        f"Requested cells: **{len(report['files'])}**; statuses: `{json.dumps(report['status_counts'], sort_keys=True)}`.",
        'File presence describes this explicit local input set, not a vendor inventory or entitlement census.',
        f"Window: {report['window']['start']} through {report['window']['end']} (ET session dates).",
        f"Cutoff mode: `{report['cutoff_mode']}`; true UTC cutoff: `{report['cutoff_utc']}`.", '',
        'The inventory below covers the full requested window, not merely the cutoff. '
        'The cutoff column uses the requested instant; session chains use each date\'s pre-open cutoff. Full-file diagnostics and hashes are not model features.', '',
        '| Symbol | Grain | Status | Window rows | PRE | RTH | AH | Cutoff rows |',
        '|---|---|---|---:|---:|---:|---:|---:|',
    ]
    for cell in report['files']:
        counts = [sum(day[phase]['observed_slots'] for day in cell['days'])
                  for phase in ('PRE', 'RTH', 'AH')]
        cutoff = cell['cutoff']['count']
        lines.append(f"| {cell['symbol']} | {cell['timeframe']} | {cell['status']} | "
                     f"{cell['window_rows']} | {counts[0]} | {counts[1]} | {counts[2]} | "
                     f"{'not requested' if cutoff is None else cutoff} |")
    lines += ['', '## Pre-open session-chain inventory', '',
              'Each decision date uses the previous scheduled regular session, its after-hours '
              'window, and current premarket ending at the regular open. This is archived input '
              'qualification, not a signal or a count of profitable opportunities. Full nominal '
              'grid does not prove liquidity, feed completeness, or historical availability.', '',
              '| Symbol | Grain | Decision dates | Full nominal chains | Incomplete/unknown | Unsupported | Source unavailable |',
              '|---|---|---:|---:|---:|---:|---:|']
    for cell in report['files']:
        chains = cell['session_chains']
        states = Counter(chain['state'] for chain in chains)
        lines.append(f"| {cell['symbol']} | {cell['timeframe']} | {len(chains)} | "
                     f"{states['full_nominal_grid']} | {states['incomplete_or_unknown']} | "
                     f"{states['unsupported_chain_grain']} | {states['source_unavailable']} |")
    lines += ['', '## Evidence boundaries', '',
              'Nominal grid occupancy is not feed completeness. Missing aggregate cause is unknown '
              'without trade/quote evidence. Early-close post-market observations and boundary-straddling '
              'bars are unqualified, not silently split or filled.', '',
              'Legacy stores do not establish per-bar availability. `as_observed` therefore emits no '
              'legacy-store observations. `corrected_history` can support event-time slicing only; it '
              'does not establish historical information availability. Adjustment declarations, when '
              'present, are not independent receipts. Rights, historical membership, live latency, '
              'research admission and trading authority remain unassessed.', '',
              f"Calendar bytes: `{report['calendar']['sha256']}`.",
              f"Calendar owner revision: `{report['calendar']['source_revision']}`.",
              f"Pilot bytes: `{report['pilot_sha256']}`.", '',
              '## Input diagnostics', '']
    for cell in report['files']:
        if cell['status'] == 'available':
            coverage = cell['coverage']
            lines.append(f"- `{cell['symbol']}.{cell['timeframe']}`: latest observed regular session "
                         f"`{coverage['latest_observed_regular_date']}`; no regular observations on "
                         f"`{', '.join(coverage['missing_regular_dates']) or 'none'}`.")
        if cell['errors']:
            lines.append(f"- `{cell['symbol']}.{cell['timeframe']}`: "
                         f"`{json.dumps(cell['errors'], sort_keys=True)}`.")
    return '\n'.join(lines) + '\n'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--pilot', type=Path, default=ROOT / 'config/tactical_research_pilot.json')
    parser.add_argument('--calendar', type=Path, default=ROOT / 'terminal/lib/usEquitySessionProjection.json')
    parser.add_argument('--start', required=True)
    parser.add_argument('--end', required=True)
    parser.add_argument('--cutoff', type=parse_cutoff)
    parser.add_argument('--mode', choices=('corrected_history', 'as_observed'), default='corrected_history')
    parser.add_argument('--json-out', type=Path)
    parser.add_argument('--markdown-out', type=Path)
    args = parser.parse_args(argv)
    try:
        input_dir = args.input_dir.resolve()
        if not input_dir.is_dir():
            raise ValueError('input_directory_missing')
        outputs = [p.resolve() for p in (args.json_out, args.markdown_out) if p is not None]
        if len(set(outputs)) != len(outputs):
            raise ValueError('output_paths_must_differ')
        for output in outputs:
            if output.exists() or output == input_dir or input_dir in output.parents:
                raise ValueError('output_must_be_new_and_outside_input_directory')
            if not output.parent.is_dir():
                raise ValueError('output_parent_missing')
        pilot, digest = load_pilot(args.pilot)
        calendar = CalendarProjection.load(args.calendar)
        cells = [qualify_store(input_dir / f'{symbol}.{tf}.json', symbol, tf, calendar,
                               args.start, args.end, args.cutoff, args.mode)
                 for symbol in pilot['symbols'] for tf in pilot['timeframes']]
        report = {
            'schema': 'mastermind.intraday_qualification_report.v1',
            'cohort_id': pilot['cohort_id'], 'pilot_sha256': digest,
            'membership_basis': pilot['membership_basis'],
            'window': {'start': args.start, 'end': args.end},
            'cutoff_mode': args.mode, 'cutoff_utc': args.cutoff,
            'calendar': {'sha256': calendar.sha256, 'source_revision': calendar.source_revision,
                         'coverage': {'start': calendar.start, 'end': calendar.end}},
            'status_counts': dict(sorted(Counter(cell['status'] for cell in cells).items())),
            'research_admission': 'not_assessed',
            'input_scope': 'explicit_local_files_not_vendor_inventory', 'files': cells,
        }
        encoded = json.dumps(report, indent=2, allow_nan=False) + '\n'
        if args.json_out:
            with args.json_out.open('x', encoding='utf-8') as stream:
                stream.write(encoded)
        if args.markdown_out:
            with args.markdown_out.open('x', encoding='utf-8') as stream:
                stream.write(markdown(report))
        if not args.json_out:
            print(encoded, end='')
        return 0
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.error(str(error))
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
