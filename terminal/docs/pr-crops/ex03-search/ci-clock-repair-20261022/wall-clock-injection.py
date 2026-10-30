"""Validation-only wall-clock injection, loaded only by the explicit test command.

Rebind the regional driver's module-local dt once, immediately after its import.
A test fixture or sandbox launcher can then override that injected wall clock.
No datetime class in the standard library is modified.
"""
import datetime as _real_dt
import sys as _sys
import importlib.machinery as _machinery
import importlib.util as _util
from pathlib import Path as _Path

# Preserve the host's normal sitecustomize (Homebrew repairs its site-packages
# path there). The injection must alter time, not dependency discovery.
_own_directory = str(_Path(__file__).resolve().parent)
_other_paths = [p for p in _sys.path if str(_Path(p or '.').resolve()) != _own_directory]
_original_site = _machinery.PathFinder.find_spec('sitecustomize', _other_paths)
if _original_site is not None and _original_site.origin != __file__:
    _original_module = _util.module_from_spec(_original_site)
    _original_site.loader.exec_module(_original_module)

_INSTANT = _real_dt.datetime(2026, 10, 22, 21, 30, tzinfo=_real_dt.timezone.utc)

class _BlockedClock(_real_dt.datetime):
    @classmethod
    def now(cls, tz=None):
        return _INSTANT.astimezone(tz) if tz is not None else _INSTANT.replace(tzinfo=None)

class _ClockModule:
    datetime = _BlockedClock
    def __getattr__(self, name):
        return getattr(_real_dt, name)

_seen = set()

def _module_trace(frame, event, arg):
    if event == 'line' and id(frame.f_globals) not in _seen:
        if frame.f_globals.get('dt') is _real_dt:
            frame.f_globals['dt'] = _ClockModule()
            _seen.add(id(frame.f_globals))
            frame.f_trace = None
            return None
    return _module_trace

def _trace(frame, event, arg):
    if event == 'call' and frame.f_code.co_name == '<module>' and frame.f_code.co_filename.endswith('/ingest/regional_refresh.py'):
        return _module_trace
    return None

_sys.settrace(_trace)
