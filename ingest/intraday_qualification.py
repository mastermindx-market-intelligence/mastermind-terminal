"""Read-only intraday source qualification; no signals, network, or replay authority.

The calendar is the existing Macro-derived projection. Legacy store timestamps are
ET display epochs. Their `asof` is NOT observation availability. Canonical event
revision resolution remains with Entry Radar; this module only selects a view.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import MappingProxyType
from typing import Mapping, Sequence
from zoneinfo import ZoneInfo

UTC = timezone.utc
ET = ZoneInfo('America/New_York')
GRAINS = {'1m': 1, '5m': 5, '15m': 15, '1h': 60}
PHASES = ('PRE', 'RTH', 'AH', 'POST_CLOSE_UNQUALIFIED', 'STRADDLE',
          'OUTSIDE_EXTENDED', 'CLOSED_DATE')
MAX_BYTES = 32 * 1024 * 1024
SOURCE_FILES = ('lib/__init__.py', 'lib/nyse_calendar.py',
                'engine/__init__.py', 'engine/session_digest.py')


def _integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _day(value: str) -> date:
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        raise ValueError('noncanonical_date')
    return parsed


@dataclass(frozen=True)
class CalendarProjection:
    start: str
    end: str
    sessions: Mapping[str, tuple[int, int]]
    sha256: str
    source_revision: str

    @classmethod
    def load(cls, path: Path) -> 'CalendarProjection':
        try:
            raw = path.read_bytes()
            d = json.loads(raw)
            source = d['source']; coverage = d['coverage']
            if (d['schema'] != 'mastermind.us_equity_session_projection.v1'
                    or d['timezone'] != 'America/New_York'
                    or source['repository'] != 'mastermindx-market-intelligence/macro'
                    or not re.fullmatch(r'[0-9a-f]{40}', source['revision'])
                    or _day(coverage['start']) > _day(coverage['end'])):
                raise ValueError('identity')
            for key in SOURCE_FILES:
                if not re.fullmatch(r'[0-9a-f]{64}', source['files'][key]):
                    raise ValueError('source_digest')
            rows = d['sessions']
            if not isinstance(rows, dict) or not 0 < len(rows) <= 6000:
                raise ValueError('sessions')
            windows = {}
            for key, pair in rows.items():
                if (not coverage['start'] <= _day(key).isoformat() <= coverage['end']
                        or not isinstance(pair, list) or len(pair) != 2
                        or not all(_integer(x) for x in pair)
                        or not 0 <= pair[0] < pair[1] <= 1440):
                    raise ValueError('session_window')
                windows[key] = tuple(pair)
            return cls(coverage['start'], coverage['end'], MappingProxyType(windows),
                       hashlib.sha256(raw).hexdigest(), source['revision'])
        except (OSError, KeyError, TypeError, ValueError) as error:
            raise ValueError('invalid_calendar_projection') from error

    def window(self, day: str) -> tuple[int, int] | None:
        _day(day)
        if not self.start <= day <= self.end:
            raise ValueError('calendar_coverage_unknown')
        return self.sessions.get(day)


def decode_display_epoch(seconds: int) -> int:
    """Invert the explicit ET-wall-clock-as-UTC encoding, never guess units."""
    if not _integer(seconds):
        raise ValueError('invalid_display_epoch')
    try:
        wall = datetime.fromtimestamp(seconds, UTC).replace(tzinfo=None)
        choices = set()
        for fold in (0, 1):
            instant = wall.replace(tzinfo=ET, fold=fold).astimezone(UTC)
            if instant.astimezone(ET).replace(tzinfo=None) == wall:
                choices.add(int(instant.timestamp()))
        if len(choices) != 1:
            raise ValueError('ambiguous_or_nonexistent_wall_time')
        return choices.pop()
    except (OverflowError, OSError) as error:
        raise ValueError('invalid_display_epoch') from error


def _valid_ohlcv(values: Sequence[object]) -> bool:
    try:
        if len(values) != 5 or any(isinstance(x, bool) or not isinstance(x, (int, float))
                                   or not math.isfinite(x) for x in values):
            return False
    except (OverflowError, TypeError):
        return False
    o, h, low, c, volume = values
    return min(o, h, low, c) > 0 and low <= min(o, c) <= max(o, c) <= h and volume >= 0


@dataclass(frozen=True)
class Observation:
    event_start_utc: int
    event_end_utc: int
    session: str
    ohlcv: tuple[float, float, float, float, float]
    available_at_utc: int | None = None


def cutoff_view(observations: Sequence[Observation], cutoff_utc: int,
                mode: str) -> tuple[Observation, ...]:
    """A closed-bar view, not a replay engine or an assertion of research rights."""
    if mode not in ('corrected_history', 'as_observed'):
        raise ValueError('invalid_mode')
    if not _integer(cutoff_utc):
        raise ValueError('invalid_cutoff')
    selected = []
    seen = set()
    for bar in observations:
        if (not _integer(bar.event_start_utc) or not _integer(bar.event_end_utc)
                or bar.event_end_utc <= bar.event_start_utc):
            raise ValueError('invalid_observation')
        if bar.event_end_utc > cutoff_utc:
            continue
        known = bar.available_at_utc
        if known is not None and (not _integer(known) or known < bar.event_end_utc):
            raise ValueError('invalid_completed_bar_availability')
        if mode == 'as_observed' and (known is None or known > cutoff_utc):
            continue
        if bar.session not in ('PRE', 'RTH', 'AH'):
            continue
        # Price content is inspected only after the observation is available to
        # this view. A later corrupt revision cannot affect an earlier result.
        if not isinstance(bar.ohlcv, tuple):
            raise ValueError('observation_requires_immutable_ohlcv')
        if not _valid_ohlcv(bar.ohlcv):
            raise ValueError('invalid_observation')
        if bar.event_start_utc in seen:
            raise ValueError('duplicate_event_requires_upstream_revision_resolution')
        seen.add(bar.event_start_utc)
        selected.append(bar)
    return tuple(sorted(selected, key=lambda bar: bar.event_start_utc))


def _phase(minute: int, grain: int, window: tuple[int, int] | None) -> str:
    if window is None:
        return 'CLOSED_DATE'
    if minute < 240 or minute >= 1200:
        return 'OUTSIDE_EXTENDED'
    if minute + grain > 1200:
        return 'STRADDLE'
    opening, closing = window
    if minute < opening:
        return 'PRE' if minute + grain <= opening else 'STRADDLE'
    if minute < closing:
        return 'RTH' if minute + grain <= closing else 'STRADDLE'
    return 'AH' if closing == 960 else 'POST_CLOSE_UNQUALIFIED'


def _day_grid(day: str, grain: int, window: tuple[int, int] | None) -> dict:
    nominal = Counter(_phase(minute, grain, window) for minute in range(240, 1200, grain))
    result = {'date': day, 'calendar_status': 'session' if window else 'closed',
              'regular_window_minutes': list(window) if window else None}
    for phase in PHASES:
        # These classes are deliberately not completeness denominators.
        n = nominal[phase] if phase in ('PRE', 'RTH', 'AH') else None
        if phase == 'AH' and window and window[1] != 960:
            n = None
        result[phase] = {'nominal_slots': n, 'observed_slots': 0,
                         'absent_slots': n, 'grid_occupancy': None}
    return result



def _coverage(grids: Mapping[str, dict]) -> dict:
    expected = [day for day, item in grids.items() if item['calendar_status'] == 'session']
    observed = [day for day in expected if grids[day]['RTH']['observed_slots'] > 0]
    return {
        'expected_regular_sessions': len(expected),
        'observed_regular_sessions': len(observed),
        'latest_observed_regular_date': observed[-1] if observed else None,
        'missing_regular_dates': [day for day in expected if day not in observed],
        'window_complete_grid': bool(expected) and all(
            grids[day]['RTH']['absent_slots'] == 0 for day in expected),
        'meaning': 'nominal_interval_occupancy_not_feed_completeness',
    }



def session_chain_inventory(observations: Sequence[Observation], calendar: CalendarProjection,
                            start_date: str, end_date: str, timeframe: str,
                            mode: str, input_status: str = 'available') -> list[dict]:
    """Pre-open three-leg occupancy using only existing calendar and cutoff owners.

    These rows qualify archived input windows, not forecasts or trading episodes.
    Previous means scheduled, never last observed. No missing bar is filled.
    """
    from bisect import bisect_left, bisect_right

    first, last = _day(start_date), _day(end_date)
    if first > last or (last - first).days > 4000 or timeframe not in GRAINS:
        raise ValueError('invalid_chain_window_or_grain')
    if input_status not in ('available', 'missing', 'invalid', 'empty', 'malformed', 'unreadable'):
        raise ValueError('invalid_chain_source_status')
    calendar.window(start_date); calendar.window(end_date)
    cutoff_view((), 0, mode)
    days = sorted(calendar.sessions)
    by_day: dict[str, list[Observation]] = {}
    if input_status == 'available':
        for bar in observations:
            if not _integer(bar.event_start_utc):
                raise ValueError('invalid_observation')
            day = datetime.fromtimestamp(bar.event_start_utc, UTC).astimezone(ET).date().isoformat()
            if start_date <= day <= end_date:
                by_day.setdefault(day, []).append(bar)
    step = GRAINS[timeframe] * 60

    def instant(day: str, minute: int) -> int:
        midnight = int(datetime.fromisoformat(day).replace(tzinfo=UTC).timestamp())
        return decode_display_epoch(midnight + minute * 60)

    result = []
    for day in days[bisect_left(days, start_date):bisect_right(days, end_date)]:
        opening, _ = calendar.window(day)
        position = bisect_left(days, day)
        previous = days[position - 1] if position else None
        cutoff = instant(day, opening)
        row = {'decision_date': day, 'previous_session': previous, 'cutoff_utc': cutoff,
               'mode': mode, 'input_status': input_status, 'state': 'incomplete_or_unknown',
               'meaning': 'archival_preopen_nominal_grid_not_signal_or_feed_completeness',
               'historical_availability_proven': False, 'trading_authority': False, 'legs': {}}
        if input_status != 'available':
            row['state'] = 'source_unavailable'; result.append(row); continue
        if timeframe == '1h':
            row['state'] = 'unsupported_chain_grain'; result.append(row); continue
        previous_window = calendar.window(previous) if previous else None
        bounds = (
            ('prior_regular', previous, 'RTH', previous_window),
            ('prior_after_hours', previous, 'AH',
             (960, 1200) if previous_window and previous_window[1] == 960 else None),
            ('premarket', day, 'PRE', (240, opening)),
        )
        for name, leg_day, phase, window in bounds:
            leg = {'date': leg_day, 'phase': phase, 'state': 'no_available_observations',
                   'nominal_slots': None, 'observed_slots': 0, 'absent_slots': None}
            row['legs'][name] = leg
            if leg_day is None:
                leg['state'] = 'previous_session_unknown'; continue
            if leg_day < start_date:
                leg['state'] = 'outside_requested_window'; continue
            if window is None or window[0] >= window[1]:
                leg['state'] = 'schedule_unqualified'; continue
            start, end = instant(leg_day, window[0]), instant(leg_day, window[1])
            expected = set(range(start, end, step))
            # A phase label alone is insufficient: the exact interval must fit
            # the canonical leg. Closed-bar and knowledge-time rules stay shared.
            eligible = cutoff_view(tuple(b for b in by_day.get(leg_day, ())
                                         if b.session == phase), cutoff, mode)
            observed = {b.event_start_utc for b in eligible
                        if b.event_start_utc in expected and b.event_end_utc <= end
                        and b.event_end_utc - b.event_start_utc == step}
            leg.update(nominal_slots=len(expected), observed_slots=len(observed),
                       absent_slots=len(expected - observed))
            if observed:
                leg['state'] = 'full_nominal_grid' if observed == expected else 'partial_nominal_grid'
        if all(leg['state'] == 'full_nominal_grid' for leg in row['legs'].values()):
            row['state'] = 'full_nominal_grid'
        result.append(row)
    return result


def qualify_store(path: Path, symbol: str, timeframe: str, calendar: CalendarProjection,
                  start_date: str, end_date: str, cutoff_utc: int | None = None,
                  mode: str = 'corrected_history') -> dict:
    """Inspect one existing file without mutating, filling or repairing its bytes."""
    if not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}', symbol) or timeframe not in GRAINS:
        raise ValueError('invalid_symbol_or_timeframe')
    first, last = _day(start_date), _day(end_date)
    if first > last or (last - first).days > 4000:
        raise ValueError('invalid_date_window')
    calendar.window(start_date); calendar.window(end_date)
    cutoff_view((), 0 if cutoff_utc is None else cutoff_utc, mode)
    grain = GRAINS[timeframe]
    grids = {}
    for offset in range((last - first).days + 1):
        day = (first + timedelta(days=offset)).isoformat()
        grids[day] = _day_grid(day, grain, calendar.window(day))
    observations: list[Observation] = []
    out = {
        'symbol': symbol, 'timeframe': timeframe, 'status': 'missing', 'errors': {},
        'sha256': None, 'rows_total': 0, 'valid_rows': 0, 'window_rows': 0,
        'zero_volume_rows': 0, 'first_event_start_utc': None, 'last_event_end_utc': None,
        'epoch_basis': 'ET_DISPLAY_SECONDS', 'knowledge_time': 'not_recorded',
        'asof_semantics': 'last_display_bar_start_not_availability',
        'price_adjustment': 'not_recorded', 'volume_adjustment': 'not_recorded',
        'research_admission': 'not_assessed', 'rights': 'not_assessed',
        'missing_bar_cause': 'unknown_without_trade_or_quote_evidence',
        'days': list(grids.values()), 'coverage': _coverage(grids),
        'cutoff': {'mode': mode, 'utc': cutoff_utc, 'count': None if cutoff_utc is None else 0,
                   'last_event_end_utc': None, 'pit_proven': False},
    }
    def finish() -> dict:
        out['session_chains'] = session_chain_inventory(
            observations, calendar, start_date, end_date, timeframe, mode, out['status'])
        return out

    try:
        with path.open('rb') as stream:
            raw = stream.read(MAX_BYTES + 1)
    except FileNotFoundError:
        return finish()
    except OSError:
        out['status'] = 'unreadable'; return finish()
    if len(raw) > MAX_BYTES:
        out['status'] = 'invalid'; out['errors'] = {'file_too_large': 1}; return finish()
    out['sha256'] = hashlib.sha256(raw).hexdigest()
    try:
        d = json.loads(raw)
    except (ValueError, UnicodeError):
        out['status'] = 'malformed'; return finish()
    if not isinstance(d, dict) or not isinstance(d.get('bars'), list):
        out['status'] = 'malformed'; return finish()
    errors = Counter()
    for key, wanted, reason in (('t', symbol, 'symbol_identity'),
                                ('tf', timeframe, 'timeframe_identity')):
        if d.get(key) != wanted:
            errors[reason] += 1
    if d.get('src') not in ('polygon', 'massive'):
        errors['source_identity'] += 1
    if d.get('epoch_basis', 'ET_DISPLAY_SECONDS') != 'ET_DISPLAY_SECONDS':
        errors['conflicting_epoch_basis'] += 1
    if isinstance(d.get('adjusted'), bool):
        out['price_adjustment'] = 'split_adjusted_declared' if d['adjusted'] else 'unadjusted_declared'
    bars = d['bars']; out['rows_total'] = len(bars)
    seen = set(); previous = None; occupied = {}
    for row in bars:
        if (not isinstance(row, list) or len(row) != 6 or not _integer(row[0])
                or row[0] % (grain * 60) != 0 or not _valid_ohlcv(row[1:])):
            errors['invalid_bar'] += 1; continue
        stamp = row[0]
        if stamp in seen:
            errors['duplicate_epoch'] += 1
        if previous is not None and stamp < previous:
            errors['unordered_epoch'] += 1
        previous = stamp; seen.add(stamp)
        try:
            utc = decode_display_epoch(stamp)
            day = datetime.fromtimestamp(stamp, UTC).date().isoformat()
        except (ValueError, OverflowError, OSError):
            errors['invalid_clock'] += 1; continue
        out['valid_rows'] += 1
        out['zero_volume_rows'] += int(row[5] == 0)
        if day not in grids:
            continue
        minute = (stamp // 60) % 1440
        phase = _phase(minute, grain, calendar.window(day))
        out['window_rows'] += 1
        occupied.setdefault((day, phase), set()).add(stamp)
        observations.append(Observation(utc, utc + grain * 60, phase, tuple(row[1:])))
    for (day, phase), slots in occupied.items():
        item = grids[day][phase]; item['observed_slots'] = len(slots)
    for grid in grids.values():
        for phase in PHASES:
            item = grid[phase]; n = item['nominal_slots']
            if n is not None:
                item['absent_slots'] = max(0, n - item['observed_slots'])
                item['grid_occupancy'] = item['observed_slots'] / n if n else None
    out['coverage'] = _coverage(grids)
    if observations:
        out['first_event_start_utc'] = min(x.event_start_utc for x in observations)
        out['last_event_end_utc'] = max(x.event_end_utc for x in observations)
    out['errors'] = dict(sorted(errors.items()))
    out['status'] = 'invalid' if errors else 'available' if bars else 'empty'
    if cutoff_utc is not None and out['status'] == 'available':
        selected = cutoff_view(observations, cutoff_utc, mode)
        out['cutoff']['count'] = len(selected)
        out['cutoff']['last_event_end_utc'] = selected[-1].event_end_utc if selected else None
    return finish()
