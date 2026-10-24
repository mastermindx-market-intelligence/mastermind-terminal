"""Explicit same-host frozen-node service reader; no default activation or IO on import.

Host deployment supplies fixed executable/script paths. Alert JSON supplies none.
Macro's existing service account owner reads observations; the local Node worker
reuses the native account policy and exact dated resolver. Only the separate
protected lifecycle RPC may attest generation/epoch/prior-state. No fire/write.
"""
from __future__ import annotations

import json
from dataclasses import asdict
import os
from pathlib import Path
import selectors
import subprocess
import time

from ingest.options_frozen_lifecycle import FrozenRuntime, stable_predicate, _json_equal

_MAX_INPUT = 1024 * 1024
_MAX_OUTPUT = 256 * 1024
_TIMEOUT = 15.0


def _command(executable, script, basename):
    exe, path = Path(executable), Path(script)
    if not exe.is_absolute() or not exe.is_file() or not os.access(exe, os.X_OK):
        raise ValueError('unqualified local executable')
    if not path.is_absolute() or path.name != basename or not path.is_file():
        raise ValueError('unqualified local worker')
    return (str(exe), str(path))


def _invoke(command, payload, env=None):
    """One bounded private pipe, no shell, stderr/protocol error text never exposed."""
    encoded = json.dumps(payload, allow_nan=False, ensure_ascii=True).encode('utf-8')
    if len(encoded) > _MAX_INPUT:
        return None
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, shell=False, env=env)
    selector = selectors.DefaultSelector()
    output = bytearray()
    sent = 0
    deadline = time.monotonic() + _TIMEOUT
    try:
        os.set_blocking(process.stdin.fileno(), False)
        os.set_blocking(process.stdout.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE)
        selector.register(process.stdout, selectors.EVENT_READ)
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            for key, _ in selector.select(min(remaining, 0.2)):
                if key.fileobj is process.stdin:
                    count = os.write(process.stdin.fileno(), encoded[sent:sent + 65536])
                    sent += count
                    if sent == len(encoded):
                        selector.unregister(process.stdin)
                        process.stdin.close()
                else:
                    part = os.read(process.stdout.fileno(), 65536)
                    if not part:
                        selector.unregister(process.stdout)
                    else:
                        output.extend(part)
                        if len(output) > _MAX_OUTPUT:
                            return None
        process.wait(timeout=max(0.001, deadline - time.monotonic()))
        if process.returncode != 0:
            return None
        value = json.loads(output.decode('utf-8', 'strict'),
                           parse_constant=lambda _: (_ for _ in ()).throw(ValueError('non-finite JSON')))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None
    finally:
        selector.close()
        # These are this call's bounded read-only local children, never Fabric
        # controllers/leases. A timeout cannot leak an unbounded child process.
        if process.poll() is None:
            process.kill()
        process.wait()
        if not process.stdin.closed:
            process.stdin.close()
        process.stdout.close()


class FrozenNodeServiceReader:
    """Construct only from trusted service deployment config, never alert/request JSON.

    Does not create an auth principal from a row. Engine must supply the exact
    FrozenRuntime it independently obtained via its protected lifecycle adapter.
    """
    def __init__(self, *, macro_python, macro_account_script, node, source_bundle,
                 fingerprint, instant_micros, macro_env=None):
        self._account = _command(macro_python, macro_account_script, 'frozen_options_account.py')
        self._source = _command(node, source_bundle, 'frozen_node_source.mjs')
        self._macro_env = dict(macro_env) if macro_env is not None else dict(os.environ)
        self._fingerprint = fingerprint
        self._instant = instant_micros

    def read(self, runtime, alert, evaluation_at, *, source_origin=None):
        try:
            # Bind both service owners to the SAME configured Supabase origin.
            # UUID equality across independently configured projects is not authority.
            account_origin = self._macro_env.get('SUPABASE_URL')
            if (not isinstance(source_origin, str) or not source_origin
                    or not isinstance(account_origin, str)
                    or source_origin.rstrip('/') != account_origin.rstrip('/')):
                return None
            if not isinstance(runtime, FrozenRuntime) or runtime.evaluation_at != evaluation_at:
                return None
            # Snapshot the FULL protected generation/state envelope before calls,
            # including clocks, prior state and threshold (not only the target).
            runtime = FrozenRuntime(**json.loads(json.dumps(asdict(runtime), allow_nan=False)))
            pin = json.loads(json.dumps({
                'id': runtime.alert_id, 'principal': runtime.principal,
                'generation': runtime.generation, 'revision': runtime.revision,
                'predicate': runtime.predicate, 'targetFingerprint': runtime.target_fingerprint,
                'evaluationAt': evaluation_at,
            }, allow_nan=False))
            if (pin['id'] != alert.get('id') or pin['principal'] != alert.get('user_id')
                    or not _json_equal(pin['predicate'], stable_predicate(alert.get('condition')))
                    or self._instant(evaluation_at) is None):
                return None
            target = pin['predicate'].get('target')
            if self._fingerprint(target) != pin['targetFingerprint']:
                return None
            # ScopeKey is a native ordered [kind,expiry] tuple; no replacement lens.
            scope = json.loads(target['scopeKey'])
            if not isinstance(scope, list) or len(scope) != 2:
                return None
            lens = {'kind': scope[0]}
            if scope[0] == 'one':
                lens['exp'] = scope[1]
            elif scope[1] is not None:
                return None
            account = _invoke(self._account, {'principal': pin['principal'], 'evaluationAt': evaluation_at}, self._macro_env)
            if (not account or set(account) != {'kind', 'principal', 'evaluationAt', 'account'}
                    or account['kind'] != 'observed' or account['principal'] != pin['principal']
                    or account['evaluationAt'] != evaluation_at):
                return None
            result = _invoke(self._source, {'principal': pin['principal'], 'evaluationAt': evaluation_at,
                'expected': target, 'lens': lens, 'account': account['account']})
            if not result or set(result) != {'kind', 'context'} or result['kind'] != 'admitted':
                return None
            context = result['context']
            expected_keys = {'principal', 'action', 'evaluationAt', 'target', 'rights', 'rights_decision_ref'}
            if (not isinstance(context, dict) or set(context) != expected_keys
                    or context['principal'] != pin['principal'] or context['action'] != 'frozen_node_proximity'
                    or context['evaluationAt'] != evaluation_at
                    or self._fingerprint(context['target']) != pin['targetFingerprint']
                    or context['rights_decision_ref'] != 'DEC:COMMERCIAL-DATA-RIGHTS-CHAIRMAN-ATTESTATION-20261023'
                    or not _json_equal(context['rights'], {'allowed': True, 'policy_version': 'options.frozen_node_proximity/account/v1', 'checked_at': evaluation_at})):
                return None
            return context
        except (TypeError, ValueError, KeyError, OverflowError, OSError):
            return None
