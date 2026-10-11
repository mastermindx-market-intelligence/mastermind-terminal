from copy import deepcopy

import pytest

from scripts import merge_on_green as mog
from tests.test_merge_on_green import FakeApi, checks, pull


class ChangingApi(FakeApi):
    def __init__(self, first, later=None, *, errors=None):
        super().__init__(first, merge_errors=errors)
        self.later = {p['number']: p for p in (later or first)}
        self.reads = {}

    def pull(self, number):
        self.reads[number] = self.reads.get(number, 0) + 1
        if self.reads[number] > 1:
            self.pulls[number] = deepcopy(self.later[number])
        return super().pull(number)


def pending(number=7):
    return pull(number, mergeable=None, mergeable_state='unknown')


def run(api):
    waits = []
    # The old-source causal replay uses its original call signature, so its
    # failure reflects missed recovery rather than an unsupported test option.
    import inspect
    if 'wait' in inspect.signature(mog.sweep).parameters:
        result = mog.sweep(api, wait=waits.append)
    else:
        result = mog.sweep(api)
    return result, waits


def test_transient_calculation_requalifies_and_refreshes_once():
    api = ChangingApi([pending()], [pull(7, mergeable_state='behind')])
    result, waits = run(api)
    assert ('update', 7, 'head-7') in api.actions
    assert api.dispatched == [('claude/pr-7', 7)]
    assert api.reads == {7: 2}
    assert waits == [2]
    assert 'awaiting fresh CI' in result[0]


def test_transient_calculation_requalifies_and_merges_exact_head():
    api = ChangingApi([pending()], [pull()])
    _, waits = run(api)
    assert ('merge', 7, 'head-7') in api.actions
    assert waits == [2]


def test_persistent_unknown_many_candidates_has_one_wait_and_two_reads_each():
    api = ChangingApi([pending(i) for i in range(1, 26)])
    result, waits = run(api)
    assert len(result) == 25
    assert all('mergeability pending' in x for x in result)
    assert api.actions == []
    assert set(api.reads.values()) == {2}
    assert sum(api.reads.values()) == 50
    assert waits == [2]


@pytest.mark.parametrize('kind', ['draft', 'hold', 'do-not-merge', 'fork', 'conflict', 'new-red-head'])
def test_current_refusal_or_changed_red_head_never_merges_old_proof(kind):
    current = pull()
    if kind == 'draft':
        current['draft'] = True
    elif kind in ('hold', 'do-not-merge'):
        current['labels'].append({'name': kind})
    elif kind == 'fork':
        current['head']['repo']['full_name'] = 'foreign/repo'
    elif kind == 'conflict':
        current['mergeable'], current['mergeable_state'] = False, 'dirty'
    else:
        current['head']['sha'] = 'new-head'
    api = ChangingApi([pending()], [current])
    if kind == 'new-red-head':
        api.runs['new-head'] = checks(conclusion='failure')
    run(api)
    assert not any(x[0] in ('merge', 'update', 'dispatch_ci') for x in api.actions)


def test_changed_green_head_is_fully_requalified_and_only_new_head_is_pinned():
    current = pull()
    current['head']['sha'] = 'new-head'
    api = ChangingApi([pending()], [current])
    api.runs['new-head'] = checks()
    run(api)
    assert ('merge', 7, 'new-head') in api.actions
    assert ('merge', 7, 'head-7') not in api.actions


def test_first_refresh_stops_before_pending_second_pass():
    api = ChangingApi([pending(1), pull(2, mergeable_state='behind')], [pull(1), pull(2)])
    _, waits = run(api)
    assert api.reads == {1: 1, 2: 1}
    assert waits == []
    assert [x for x in api.actions if x[0] == 'update'] == [('update', 2, 'head-2')]


def test_second_pass_refresh_stops_before_other_pending_candidates():
    api = ChangingApi([pending(1), pending(2)], [pull(1, mergeable_state='behind'), pull(2)])
    run(api)
    assert api.reads == {1: 2, 2: 1}
    assert [x for x in api.actions if x[0] == 'update'] == [('update', 1, 'head-1')]


@pytest.mark.parametrize('status', [403, 405])
def test_refused_mutation_not_retried(status):
    api = ChangingApi([pull(1), pending(2)], [pull(1), pull(2)], errors={1: (status, 'refused')})
    run(api)
    assert [x for x in api.actions if x[:2] == ('merge', 1)] == [('merge', 1, 'head-1')]
    assert api.reads[1] == 1


def test_uncertain_mutation_aborts_without_retry_or_second_pass():
    api = ChangingApi([pending(1), pull(2)], [pull(1), pull(2)], errors={2: (503, 'uncertain')})
    waits = []
    with pytest.raises(mog.ApiError):
        mog.sweep(api, wait=waits.append)
    assert api.reads == {1: 1, 2: 1}
    assert waits == []
    assert [x for x in api.actions if x[0] == 'merge'] == [('merge', 2, 'head-2')]


def test_refused_read_aborts_without_wait_or_retry():
    api = ChangingApi([pending()])
    def refused(number):
        api.reads[number] = api.reads.get(number, 0) + 1
        raise mog.ApiError(403, 'denied')
    api.pull = refused
    waits = []
    with pytest.raises(mog.ApiError):
        mog.sweep(api, wait=waits.append)
    assert api.reads == {7: 1}
    assert waits == []
