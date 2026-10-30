"""Explicit host-owned assembly only; no reads or activation on import.

The caller supplies its deployment environment, never an alert/condition. Opt-in
attests no principal, source or lifecycle: the incumbent readers still qualify
each invocation independently. An incomplete opt-in is an error, not a fallback.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

from ingest.options_frozen_service import FrozenNodeServiceReader

_PREFIX = 'OPTIONS_FROZEN_'
_PATHS = ('MACRO_PYTHON', 'MACRO_ACCOUNT_SCRIPT', 'NODE', 'SOURCE_BUNDLE', 'MACRO_ENV_FILE')


def _origin(value):
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.netloc or parsed.username is not None
            or parsed.password is not None or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment):
        return None
    return value.rstrip('/')


def assemble_frozen_node_services(supa, deployment, *, load_env, fingerprint, instant_micros):
    """Return explicit (reader, protected lifecycle adapter), or disabled (None,None).

    Host deployment owns all paths and the Macro environment file. No credential
    is a grant; exact account/source and protected runtime checks remain required.
    No RPC, subprocess or source request occurs while constructing this pair.
    """
    config = dict(deployment)
    enabled = config.get(_PREFIX + 'READER_ENABLED')
    if enabled in (None, '', '0'):
        return None, None
    if enabled != '1':
        raise ValueError('invalid frozen-node deployment opt-in')
    paths = {}
    for name in _PATHS:
        value = config.get(_PREFIX + name)
        if not isinstance(value, str) or not value or '\x00' in value or '\n' in value:
            raise ValueError('incomplete frozen-node host paths')
        path = Path(value)
        if not path.is_absolute() or not path.is_file():
            raise ValueError('unavailable frozen-node host path')
        paths[name] = str(path)
    env_path = Path(paths['MACRO_ENV_FILE'])
    if env_path.stat().st_size > 65536:
        raise ValueError('oversized frozen-node account environment')
    account_env = dict(load_env(str(env_path)))
    lifecycle = supa.frozen_lifecycle_adapter()
    origin = _origin(lifecycle.source_origin)
    if (origin is None or _origin(account_env.get('SUPABASE_URL')) != origin
            or not isinstance(account_env.get('SUPABASE_SERVICE_ROLE_KEY'), str)
            or not account_env['SUPABASE_SERVICE_ROLE_KEY'].strip()):
        raise ValueError('mismatched frozen-node account environment')
    host_env = dict(os.environ)
    reader = FrozenNodeServiceReader(
        macro_python=paths['MACRO_PYTHON'], macro_account_script=paths['MACRO_ACCOUNT_SCRIPT'],
        node=paths['NODE'], source_bundle=paths['SOURCE_BUNDLE'],
        macro_env={**host_env, **account_env}, source_env=host_env,
        fingerprint=fingerprint, instant_micros=instant_micros)
    return reader, lifecycle
