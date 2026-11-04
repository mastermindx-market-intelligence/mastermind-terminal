"""Pre-open archival coverage, never strategy/outcome tests."""
import dataclasses
from datetime import datetime, timezone
from pathlib import Path

import pytest
from ingest import intraday_qualification as q

ROOT = Path(__file__).resolve().parents[1]


def calendar():
    return q.CalendarProjection.load(ROOT / 'terminal/lib/usEquitySessionProjection.json')


def observations(day, start, end, phase, known=True):
    midnight = int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp())
    result = []
    for minute in range(start, end, 5):
        at = q.decode_display_epoch(midnight + minute * 60)
        result.append(q.Observation(at, at + 300, phase, (100., 101., 99., 100., 10.),
                                    at + 300 if known else None))
    return result


def complete(previous='2026-09-11', current='2026-09-14', known=True):
    return tuple(observations(previous, 570, 960, 'RTH', known)
                 + observations(previous, 960, 1200, 'AH', known)
                 + observations(current, 240, 570, 'PRE', known))


def inventory(rows=(), start='2026-09-11', end='2026-09-14', tf='5m', mode='corrected_history', status='available'):
    return q.session_chain_inventory(rows, calendar(), start, end, tf, mode, status)


def test_monday_uses_previous_scheduled_friday():
    result=inventory(complete())
    assert [r['decision_date'] for r in result]==['2026-09-11','2026-09-14']
    last=result[-1]
    assert last['previous_session']=='2026-09-11'
    assert last['state']=='full_nominal_grid'
    assert last['legs']['prior_regular']['observed_slots']==78
    assert last['legs']['prior_after_hours']['observed_slots']==48
    assert last['legs']['premarket']['observed_slots']==66
    assert last['trading_authority'] is False


def test_holiday_is_not_a_missing_trading_session():
    result=inventory(complete('2026-09-04','2026-09-08'),start='2026-09-04',end='2026-09-08')
    assert len(result)==2
    assert result[-1]['previous_session']=='2026-09-04'
    assert result[-1]['state']=='full_nominal_grid'


def test_dst_session_chain_has_true_utc_cutoff():
    result=inventory(complete('2026-03-06','2026-03-09'),start='2026-03-06',end='2026-03-09')
    assert datetime.fromtimestamp(result[0]['cutoff_utc'],timezone.utc).hour==14
    assert datetime.fromtimestamp(result[-1]['cutoff_utc'],timezone.utc).hour==13
    assert result[-1]['state']=='full_nominal_grid'


def test_prior_date_outside_request_is_not_provider_absence():
    first=inventory(complete())[0]
    assert first['previous_session']=='2026-09-10'
    assert first['legs']['prior_regular']['state']=='outside_requested_window'
    assert first['state']=='incomplete_or_unknown'


def test_early_close_after_hours_is_not_guessed():
    rows=tuple(observations('2026-11-27',570,780,'RTH')
               +observations('2026-11-27',780,1200,'POST_CLOSE_UNQUALIFIED')
               +observations('2026-11-30',240,570,'PRE'))
    last=inventory(rows,start='2026-11-27',end='2026-11-30')[-1]
    assert last['legs']['prior_regular']['nominal_slots']==42
    assert last['legs']['prior_after_hours']['state']=='schedule_unqualified'
    assert last['legs']['prior_after_hours']['nominal_slots'] is None
    assert last['state']=='incomplete_or_unknown'


def test_hourly_file_is_not_an_extended_session_chain():
    last=inventory((),tf='1h')[-1]
    assert last['state']=='unsupported_chain_grain'
    assert last['legs']=={}


def test_current_regular_bars_cannot_change_the_preopen_chain():
    base=complete()
    future=observations('2026-09-14',570,960,'RTH')
    future=[dataclasses.replace(r,ohlcv=(float('nan'),1,1,1,1)) for r in future]
    assert inventory(base)==inventory(base+tuple(future))


def test_premarket_bar_crossing_cutoff_is_not_available():
    base=complete()
    last=base[-1]
    assert last.session=='PRE'
    broken=dataclasses.replace(last,event_end_utc=last.event_end_utc+1)
    result=inventory(base[:-1]+(broken,))[-1]
    assert result['legs']['premarket']['observed_slots']==65
    assert result['state']=='incomplete_or_unknown'


def test_missing_leg_cannot_be_replaced_by_next_available_session():
    result=inventory(tuple(observations('2026-09-14',240,570,'PRE')))[-1]
    assert result['previous_session']=='2026-09-11'
    assert result['legs']['prior_regular']['state']=='no_available_observations'
    assert result['state']=='incomplete_or_unknown'


def test_legacy_knowledge_times_never_gain_as_observed_admission():
    result=inventory(complete(known=False),mode='as_observed')[-1]
    assert result['state']=='incomplete_or_unknown'
    assert all(leg['observed_slots']==0 for leg in result['legs'].values())
    assert result['historical_availability_proven'] is False


def test_delayed_prior_revision_is_excluded_at_the_current_cutoff():
    base=complete()
    cutoff=q.decode_display_epoch(int(datetime(2026,9,14,9,30,tzinfo=timezone.utc).timestamp()))
    delayed=tuple(dataclasses.replace(r,available_at_utc=cutoff+1) for r in base if r.session=='AH')
    kept=tuple(r for r in base if r.session!='AH')
    result=inventory(kept+delayed,mode='as_observed')[-1]
    assert result['legs']['prior_after_hours']['observed_slots']==0


@pytest.mark.parametrize('status',['missing','invalid','malformed','empty','unreadable'])
def test_source_failure_preserves_dates_without_usable_chain(status):
    result=inventory((),status=status)
    assert len(result)==2
    assert all(row['state']=='source_unavailable' for row in result)
    assert all(row['input_status']==status for row in result)


def test_partial_leg_is_not_full_nominal_grid():
    last=inventory(complete()[:-1])[-1]
    assert last['legs']['premarket']['state']=='partial_nominal_grid'
    assert last['legs']['premarket']['absent_slots']==1


def test_calendar_beginning_has_unknown_previous_session():
    rows=q.session_chain_inventory((),calendar(),'2016-01-04','2016-01-04','5m','corrected_history','available')
    assert rows[0]['previous_session'] is None
    assert rows[0]['legs']['prior_regular']['state']=='previous_session_unknown'
