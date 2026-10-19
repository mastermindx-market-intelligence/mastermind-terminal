"""Synthetic contract tests; none of these observations establish a trading edge."""
import dataclasses
import hashlib
import importlib
import json
from datetime import datetime
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def api():
    return importlib.import_module('ingest.intraday_qualification')


def epoch(text):
    return int(datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp())


def row(text, volume=100):
    return [epoch(text), 100.0, 101.0, 99.0, 100.5, volume]


def calendar():
    return api().CalendarProjection.load(ROOT / 'terminal/lib/usEquitySessionProjection.json')


def report(tmp_path, rows, day='2026-09-16', **changes):
    data = {'t': 'INTC', 'tf': '5m', 'src': 'polygon', 'bars': rows}
    data.update(changes)
    p = tmp_path / 'INTC.5m.json'
    p.write_text(json.dumps(data))
    return api().qualify_store(p, 'INTC', '5m', calendar(), day, day,
                              epoch(day + 'T23:59:59Z'), 'corrected_history')


def observation(start='2026-09-16T13:30:00Z', available=None, price=100):
    a = api()
    return a.Observation(epoch(start), epoch(start) + 300, 'RTH',
                         (price, price + 1, price - 1, price, 100.25), available)


def test_display_epoch_inverts_winter_and_summer_not_utc():
    a = api()
    assert a.decode_display_epoch(epoch('2026-03-06T09:30:00Z')) == epoch('2026-03-06T14:30:00Z')
    assert a.decode_display_epoch(epoch('2026-03-09T09:30:00Z')) == epoch('2026-03-09T13:30:00Z')


@pytest.mark.parametrize('text', ['2026-03-08T02:30:00Z', '2026-11-01T01:30:00Z'])
def test_dst_nonexistent_or_ambiguous_wall_time_is_refused(text):
    with pytest.raises(ValueError, match='wall_time'):
        api().decode_display_epoch(epoch(text))


def test_projection_uses_existing_early_close_and_closure():
    c = calendar()
    assert c.window('2026-11-27') == (570, 780)
    assert c.window('2026-12-25') is None
    with pytest.raises(ValueError, match='coverage'):
        c.window('2029-01-02')


def test_projection_provenance_cannot_be_missing(tmp_path):
    d = json.loads((ROOT / 'terminal/lib/usEquitySessionProjection.json').read_text())
    del d['source']['files']['engine/session_digest.py']
    p = tmp_path / 'calendar.json'; p.write_text(json.dumps(d))
    with pytest.raises(ValueError, match='calendar'):
        api().CalendarProjection.load(p)


def test_completed_bar_required_at_true_utc_cutoff():
    a = api(); bar = observation()
    assert a.cutoff_view((bar,), bar.event_end_utc - 1, 'corrected_history') == ()
    assert a.cutoff_view((bar,), bar.event_end_utc, 'corrected_history') == (bar,)


def test_unknown_or_delayed_availability_is_not_as_observed():
    a = api(); bar = observation(); end = bar.event_end_utc
    assert a.cutoff_view((bar,), end + 600, 'as_observed') == ()
    late = dataclasses.replace(bar, available_at_utc=end + 61)
    assert a.cutoff_view((late,), end + 60, 'as_observed') == ()
    assert a.cutoff_view((late,), end + 61, 'as_observed') == (late,)


def test_availability_before_completed_bar_is_invalid():
    a = api(); bar = observation()
    with pytest.raises(ValueError, match='availability'):
        a.cutoff_view((dataclasses.replace(bar, available_at_utc=bar.event_start_utc),),
                      bar.event_end_utc, 'as_observed')


def test_future_mutation_cannot_change_prior_cutoff_view():
    a = api(); old = observation(); future = observation('2026-09-16T13:35:00Z')
    changed = dataclasses.replace(future, ohlcv=(900, 950, 800, 910, 1e6))
    assert a.cutoff_view((old, future), old.event_end_utc, 'corrected_history') == (old,)
    assert a.cutoff_view((old, changed), old.event_end_utc, 'corrected_history') == (old,)


def test_duplicate_event_revisions_require_upstream_resolution():
    a = api(); bar = observation()
    with pytest.raises(ValueError, match='duplicate'):
        a.cutoff_view((bar, dataclasses.replace(bar, ohlcv=(110, 111, 109, 110, 10))),
                      bar.event_end_utc, 'corrected_history')


def test_unqualified_session_never_enters_cutoff_view():
    a = api(); bar = dataclasses.replace(observation(), session='STRADDLE')
    assert a.cutoff_view((bar,), bar.event_end_utc, 'corrected_history') == ()


def test_mode_typo_fails_closed():
    with pytest.raises(ValueError, match='mode'):
        api().cutoff_view((), epoch('2026-09-16T14:00:00Z'), 'live')


def test_missing_empty_and_malformed_are_different(tmp_path):
    a = api(); c = calendar(); p = tmp_path / 'INTC.5m.json'
    args = (p, 'INTC', '5m', c, '2026-09-16', '2026-09-16', None, 'corrected_history')
    assert a.qualify_store(*args)['status'] == 'missing'
    p.write_text('{')
    assert a.qualify_store(*args)['status'] == 'malformed'
    p.write_text(json.dumps({'t':'INTC','tf':'5m','src':'polygon','bars':[]}))
    assert a.qualify_store(*args)['status'] == 'empty'


def test_curated_bars_without_identity_are_not_a_qualified_store(tmp_path):
    p = tmp_path / 'INTC.5m.json'; p.write_text(json.dumps({'bars':[row('2026-09-16T09:30:00Z')]}))
    r = api().qualify_store(p,'INTC','5m',calendar(),'2026-09-16','2026-09-16',None,'corrected_history')
    assert r['status'] == 'invalid'
    assert {'symbol_identity', 'timeframe_identity', 'source_identity'} <= set(r['errors'])


def test_grid_occupancy_does_not_become_feed_completeness(tmp_path):
    r = report(tmp_path,[row('2026-09-16T04:00:00Z'),row('2026-09-16T09:30:00Z'),row('2026-09-16T09:40:00Z')])
    d = r['days'][0]
    assert d['RTH']['nominal_slots'] == 78
    assert d['RTH']['observed_slots'] == 2
    assert d['RTH']['absent_slots'] == 76
    assert d['PRE']['nominal_slots'] == 66
    assert r['missing_bar_cause'] == 'unknown_without_trade_or_quote_evidence'
    assert r['research_admission'] == 'not_assessed'
    assert r['knowledge_time'] == 'not_recorded'


def test_early_close_has_42_regular_slots_and_unqualified_post_close(tmp_path):
    r = report(tmp_path,[row('2026-11-27T12:55:00Z'),row('2026-11-27T13:00:00Z')],day='2026-11-27')
    d = r['days'][0]
    assert d['RTH']['nominal_slots'] == 42
    assert d['RTH']['observed_slots'] == 1
    assert d['POST_CLOSE_UNQUALIFIED']['observed_slots'] == 1
    assert d['POST_CLOSE_UNQUALIFIED']['nominal_slots'] is None
    assert r['cutoff']['count'] == 1


def test_missing_entire_requested_session_stays_in_denominator(tmp_path):
    p = tmp_path / 'INTC.5m.json'
    p.write_text(json.dumps({'t':'INTC','tf':'5m','src':'polygon','bars':[row('2026-09-15T09:30:00Z')]}))
    r=api().qualify_store(p,'INTC','5m',calendar(),'2026-09-15','2026-09-16',None,'corrected_history')
    assert len(r['days']) == 2
    assert r['days'][1]['RTH']['observed_slots'] == 0
    assert r['days'][1]['RTH']['absent_slots'] == 78


def test_provider_hour_crossing_open_is_not_fake_half_hour(tmp_path):
    p=tmp_path/'INTC.1h.json'; p.write_text(json.dumps({'t':'INTC','tf':'1h','src':'polygon',
        'bars':[row('2026-09-16T09:00:00Z'),row('2026-09-16T10:00:00Z')]}))
    r=api().qualify_store(p,'INTC','1h',calendar(),'2026-09-16','2026-09-16',epoch('2026-09-16T23:00:00Z'),'corrected_history')
    assert r['days'][0]['STRADDLE']['observed_slots'] == 1
    assert r['cutoff']['count'] == 1


@pytest.mark.parametrize('bad', [
    [epoch('2026-09-16T09:30:00Z'),100,101,99,102,10],
    [epoch('2026-09-16T09:30:00Z'),100,101,99,100,-1],
    [epoch('2026-09-16T09:30:00Z'),100,float('nan'),99,100,10],
    [True,100,101,99,100,10],
])
def test_invalid_rows_fail_structural_readiness(tmp_path,bad):
    r=report(tmp_path,[bad]); assert r['status']=='invalid'; assert r['cutoff']['count']==0


def test_fractional_and_zero_volume_are_preserved_as_observations(tmp_path):
    r=report(tmp_path,[row('2026-09-16T09:30:00Z',0),row('2026-09-16T09:35:00Z',0.25)])
    assert r['status']=='available'; assert r['valid_rows']==2; assert r['zero_volume_rows']==1
    assert r['cutoff']['count']==2


def test_duplicate_and_unsorted_stores_are_not_silently_repaired(tmp_path):
    first=row('2026-09-16T09:30:00Z'); second=row('2026-09-16T09:35:00Z')
    duplicate=report(tmp_path,[first,first]); assert 'duplicate_epoch' in duplicate['errors']
    reversed_=report(tmp_path,[second,first]); assert 'unordered_epoch' in reversed_['errors']


def test_source_bytes_digest_and_no_store_mutation(tmp_path):
    p=tmp_path/'INTC.5m.json'; raw=json.dumps({'t':'INTC','tf':'5m','src':'polygon','asof':123,'bars':[row('2026-09-16T09:30:00Z')]}).encode()
    p.write_bytes(raw)
    r=api().qualify_store(p,'INTC','5m',calendar(),'2026-09-16','2026-09-16',epoch('2026-09-16T23:00:00Z'),'as_observed')
    assert r['sha256']==hashlib.sha256(raw).hexdigest(); assert p.read_bytes()==raw
    assert r['cutoff']['count']==0; assert r['knowledge_time']=='not_recorded'
    assert r['price_adjustment']=='not_recorded'


def test_future_corrupt_price_is_not_inspected_by_an_earlier_cutoff():
    a=api(); old=observation()
    future=dataclasses.replace(observation('2026-09-16T13:35:00Z'), ohlcv=(float('nan'),1,1,1,1))
    assert a.cutoff_view((old,future),old.event_end_utc,'corrected_history')==(old,)


def test_unavailable_corrupt_revision_is_not_seen_in_as_observed_view():
    a=api(); old=dataclasses.replace(observation(),available_at_utc=epoch('2026-09-16T13:35:00Z'))
    delayed=dataclasses.replace(old,available_at_utc=old.event_end_utc+61,ohlcv=(float('nan'),1,1,1,1))
    assert a.cutoff_view((old,delayed),old.event_end_utc,'as_observed')==(old,)


def test_ohlcv_container_must_be_immutable_in_a_frozen_observation():
    a=api(); bar=dataclasses.replace(observation(),ohlcv=[100,101,99,100,10])
    with pytest.raises(ValueError,match='immutable'):
        a.cutoff_view((bar,),bar.event_end_utc,'corrected_history')


def test_extreme_integer_ohlcv_is_reported_invalid_not_a_crash(tmp_path):
    bad=[epoch('2026-09-16T09:30:00Z'),100,10**1000,99,100,10]
    r=report(tmp_path,[bad])
    assert r['status']=='invalid'
    assert 'invalid_bar' in r['errors']


def test_error_field_has_one_machine_type_for_all_file_states(tmp_path):
    a=api(); p=tmp_path/'missing.json'
    args=(p,'INTC','5m',calendar(),'2026-09-16','2026-09-16')
    assert isinstance(a.qualify_store(*args)['errors'],dict)
    p.write_text('{')
    assert isinstance(a.qualify_store(*args)['errors'],dict)


def test_closed_day_bars_are_quarantined_not_counted_as_premarket(tmp_path):
    r=report(tmp_path,[row('2026-12-25T08:00:00Z')],day='2026-12-25')
    assert r['days'][0]['calendar_status']=='closed'
    assert r['days'][0]['CLOSED_DATE']['observed_slots']==1
    assert r['cutoff']['count']==0


def test_missing_session_summary_cannot_hide_a_stale_tail(tmp_path):
    p=tmp_path/'INTC.5m.json'
    p.write_text(json.dumps({'t':'INTC','tf':'5m','src':'polygon','bars':[row('2026-09-11T09:30:00Z')]}))
    r=api().qualify_store(p,'INTC','5m',calendar(),'2026-09-11','2026-09-16',None,'corrected_history')
    assert r['coverage']['expected_regular_sessions']==4
    assert r['coverage']['observed_regular_sessions']==1
    assert r['coverage']['latest_observed_regular_date']=='2026-09-11'
    assert r['coverage']['missing_regular_dates']==['2026-09-14','2026-09-15','2026-09-16']
    assert r['coverage']['window_complete_grid'] is False
