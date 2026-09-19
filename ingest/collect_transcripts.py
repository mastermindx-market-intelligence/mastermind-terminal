"""Collect earnings-call transcripts for Terminal equity symbols via defeatbeta-api.

MANDATORY pattern (BUILD-SPEC §2 D5):
  Download defeatbeta's full stock_earning_call_transcripts.parquet ONCE per run to a
  local cache dir, then filter LOCALLY — never issue per-symbol remote queries in a loop
  (429s observed after ~5-6 remote DuckDB queries).

Output per symbol × fiscal quarter:
  terminal/public/data/tx/<SYM>/<YYYYQn>.json.gz  — gzipped JSON per §1.3 schema
  terminal/public/data/tx/<SYM>/index.json         — browser-facing ticker discovery
  Macro Dashboard/data/us_fund/_tx_index.json      — legacy emitter join during migration

ID format: defeatbeta's fiscal year + quarter labels, e.g. "2026Q3"
Incremental: existing .gz files are skipped.

Venv: /tmp/dbeta-venv (defeatbeta-api 0.0.60 + duckdb 1.5.3)
      Falls back to creating ~/.mm-dbeta-venv if /tmp/dbeta-venv is absent.

Usage:
  /tmp/dbeta-venv/bin/python ingest/collect_transcripts.py --only ZS,AAPL,NVDA,NIO --quarters 4
  /tmp/dbeta-venv/bin/python ingest/collect_transcripts.py --limit 50 --quarters 8
  /tmp/dbeta-venv/bin/python ingest/collect_transcripts.py  # full backfill, 8 quarters

Flags:
  --only SYM[,SYM,...]  comma-separated symbols to process (overrides full universe)
  --quarters N          number of most-recent quarters per symbol (default 8)
  --limit N             cap the symbol universe (for testing)
  --defer-index-publish write bodies only; the nightly lane validates/publishes later
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Optional

try:  # direct execution: python ingest/collect_transcripts.py
    from build_transcript_index import _read_body
except ImportError:  # module execution: python -m ingest.collect_transcripts
    from ingest.build_transcript_index import _read_body

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
CA_ROOT   = Path(__file__).resolve().parents[1]
MACRO_DIR = Path(os.environ.get(
    "MACRO_ROOT",
    "/Users/chriswong/Documents/Cluade/Macro Dashboard",
))
DATA_DIR  = MACRO_DIR / "data"
TX_CACHE  = DATA_DIR / "transcripts"
US_FUND   = DATA_DIR / "us_fund"
TX_OUT    = CA_ROOT / "terminal" / "public" / "data" / "tx"
TX_INDEX  = US_FUND / "_tx_index.json"
MANIFEST  = CA_ROOT / "terminal" / "public" / "data" / "manifest.json"

# DefeatBeta split the compacted dataset by market on 2026-09-18.  The US
# transcript corpus moved from data/<file> to data/US/<file>; the retired root
# path returns Hugging Face EntryNotFound even though the dataset is healthy.
# Keep this lane US-scoped: HK transcript ownership is separate.
PARQUET_URL   = "https://huggingface.co/datasets/defeatbeta/yahoo-finance-data/resolve/main/data/US/stock_earning_call_transcripts.parquet"
LOCAL_PARQUET = TX_CACHE / "stock_earning_call_transcripts.parquet"
PARQUET_REVISION_MARKER = TX_CACHE / ".stock_earning_call_transcripts.applied_revision"
PARQUET_CACHE_REVISION_MARKER = TX_CACHE / ".stock_earning_call_transcripts.cache_revision"

# Minimum parquet size sanity check (2 GB download is expected ~2.1 GB)
MIN_PARQUET_BYTES = 1_000_000_000  # 1 GB — clearly incomplete if below this

# Re-download the parquet if it is older than this (new quarters land in defeatbeta periodically;
# without an age check a first download is reused forever and new transcripts are never picked up).
PARQUET_STALE_DAYS = 14
PARQUET_PROBE_TIMEOUT = 20

REVISION_UNCHANGED = 0
REVISION_CHANGED = 10
REVISION_PROBE_FAILED = 11
_REVISION_TOKEN_RE = re.compile(r"^[A-Za-z0-9._:+/-]{8,256}$")

# ---------------------------------------------------------------------------
# Ctrl-C safety
# ---------------------------------------------------------------------------
_stop = False

def _handle_sigint(sig, frame):
    global _stop
    print("\n[interrupt] finishing current symbol then exiting …", flush=True)
    _stop = True

# ---------------------------------------------------------------------------
# Venv bootstrap
# ---------------------------------------------------------------------------
DBETA_VENV = Path("/tmp/dbeta-venv")
FALLBACK_VENV = Path.home() / ".mm-dbeta-venv"

def _ensure_venv() -> Path:
    """Return path to a venv that has defeatbeta-api installed; create if needed."""
    for v in (DBETA_VENV, FALLBACK_VENV):
        py = v / "bin" / "python"
        if py.exists():
            try:
                subprocess.run([str(py), "-c", "import defeatbeta_api"], check=True,
                               capture_output=True)
                return v
            except subprocess.CalledProcessError:
                pass

    print(f"[bootstrap] creating venv at {FALLBACK_VENV} …", flush=True)
    subprocess.run([sys.executable, "-m", "venv", str(FALLBACK_VENV)], check=True)
    pip = FALLBACK_VENV / "bin" / "pip"
    subprocess.run([str(pip), "install", "defeatbeta-api", "duckdb"], check=True)
    return FALLBACK_VENV


def _is_running_in_dbeta_venv() -> bool:
    for v in (DBETA_VENV, FALLBACK_VENV):
        if sys.executable.startswith(str(v)):
            return True
    return False


# ---------------------------------------------------------------------------
# Download helper
# ---------------------------------------------------------------------------
def _normalize_revision_token(raw: object) -> str | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if value.startswith("W/"):
        value = value[2:].strip()
    value = value.strip('"')
    return value if _REVISION_TOKEN_RE.fullmatch(value) else None


def _revision_from_headers(headers: object) -> str | None:
    getter = getattr(headers, "get", None)
    if not callable(getter):
        return None
    for header, prefix in (
        ("X-Linked-ETag", "linked-etag"),
        ("ETag", "etag"),
        ("X-Xet-Hash", "xet"),
        ("X-Repo-Commit", "repo"),
    ):
        value = _normalize_revision_token(getter(header))
        if value:
            return f"{prefix}:{value}"
    return None


def _read_revision_marker(path: Path | None = None) -> str | None:
    target = Path(path) if path is not None else PARQUET_REVISION_MARKER
    try:
        return _normalize_revision_token(target.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError):
        return None


def _write_revision_marker(path: Path, revision: str) -> None:
    value = _normalize_revision_token(revision)
    if value is None:
        raise ValueError(f"invalid parquet revision token: {revision!r}")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(value + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _probe_parquet_revision() -> str:
    """Return the file-specific Hugging Face ETag without downloading its body."""
    try:
        req = urllib.request.Request(
            PARQUET_URL,
            method="HEAD",
            headers={
                "Accept-Encoding": "identity",
                "User-Agent": "Mozilla/5.0 collect_transcripts/2.0",
            },
        )
        with urllib.request.urlopen(req, timeout=PARQUET_PROBE_TIMEOUT) as resp:
            revision = _revision_from_headers(resp.headers)
    except Exception as exc:
        raise RuntimeError(f"upstream parquet revision probe failed: {exc}") from exc
    if revision is None:
        raise RuntimeError("upstream parquet revision probe returned no stable ETag")
    return revision


def _parquet_revision_probe_status() -> tuple[int, str | None, str | None]:
    """Return ``(status, remote_revision, error)`` for the nightly cheap probe."""
    try:
        remote = _probe_parquet_revision()
    except RuntimeError as exc:
        return REVISION_PROBE_FAILED, None, str(exc)
    local = _read_revision_marker()
    status = REVISION_UNCHANGED if local == remote else REVISION_CHANGED
    return status, remote, None


def _need_download(
    refresh: bool = False,
    *,
    upstream_revision: str | None = None,
) -> bool:
    if not LOCAL_PARQUET.exists():
        return True
    if LOCAL_PARQUET.stat().st_size < MIN_PARQUET_BYTES:
        print(f"[warn] parquet too small ({LOCAL_PARQUET.stat().st_size} B) — re-downloading", flush=True)
        return True
    if refresh:
        print("[info] parquet refresh forced (--refresh-parquet)", flush=True)
        return True
    if upstream_revision is not None:
        cached_revision = _read_revision_marker(PARQUET_CACHE_REVISION_MARKER)
        if cached_revision != upstream_revision:
            print(
                f"[info] upstream parquet changed ({cached_revision or 'unknown'} → "
                f"{upstream_revision}) — refreshing cache",
                flush=True,
            )
            return True
        return False
    age_days = (time.time() - LOCAL_PARQUET.stat().st_mtime) / 86400
    if age_days >= PARQUET_STALE_DAYS:
        why = f"{age_days:.0f}d old ≥ {PARQUET_STALE_DAYS}d"
        print(f"[info] parquet stale ({why}) — re-downloading for new quarters", flush=True)
        return True
    return False


def _download_parquet(*, expected_revision: str | None = None) -> str | None:
    TX_CACHE.mkdir(parents=True, exist_ok=True)
    tmp = LOCAL_PARQUET.with_suffix(".parquet.tmp")
    tmp.unlink(missing_ok=True)
    print(f"[download] {PARQUET_URL}", flush=True)
    print(f"  → {LOCAL_PARQUET} (~2.1 GB, may take 3–5 min)", flush=True)

    downloaded_revision: str | None = None
    try:
        req = urllib.request.Request(
            PARQUET_URL,
            headers={
                "Accept-Encoding": "identity",
                "User-Agent": "Mozilla/5.0 collect_transcripts/2.0",
            },
        )
        with urllib.request.urlopen(req, timeout=600) as resp, open(tmp, "wb") as fout:
            downloaded_revision = _revision_from_headers(resp.headers)
            total = int(resp.headers.get("Content-Length", 0))
            done  = 0
            chunk = 1 << 20  # 1 MB
            t0 = time.time()
            while True:
                buf = resp.read(chunk)
                if not buf:
                    break
                fout.write(buf)
                done += len(buf)
                if total:
                    pct = done / total * 100
                    mb  = done / 1e6
                    el  = time.time() - t0
                    eta = (total - done) / (done / el) if done else 0
                    print(f"\r  {pct:5.1f}%  {mb:6.0f} MB  ETA {eta:.0f}s   ", end="", flush=True)
        print()
    except Exception as exc:
        if tmp.exists():
            tmp.unlink()
        raise RuntimeError(f"download failed: {exc}") from exc

    downloaded = tmp.stat().st_size
    if downloaded < MIN_PARQUET_BYTES:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(
            f"download incomplete: {downloaded} bytes is below the "
            f"{MIN_PARQUET_BYTES}-byte safety floor"
        )
    os.replace(tmp, LOCAL_PARQUET)
    cached_revision = downloaded_revision or _normalize_revision_token(expected_revision)
    if cached_revision is not None:
        _write_revision_marker(PARQUET_CACHE_REVISION_MARKER, cached_revision)
    else:
        PARQUET_CACHE_REVISION_MARKER.unlink(missing_ok=True)
    print(f"[download] done: {LOCAL_PARQUET.stat().st_size // 1_000_000} MB", flush=True)
    return cached_revision


# ---------------------------------------------------------------------------
# Universe
# ---------------------------------------------------------------------------
_SAFE_CORPUS_SYMBOL_RE = re.compile(r"^[A-Z0-9.^-]+$")
_EXCLUDED_MARKET_SUFFIXES = (".SS", ".SZ", ".HK", ".TO")


def _eligible_corpus_symbol(raw: object) -> str | None:
    """Normalize a path/query-safe corpus symbol outside separately owned lanes."""
    if not isinstance(raw, str):
        return None
    sym = raw.strip().upper()
    if (
        not sym
        or not _SAFE_CORPUS_SYMBOL_RE.fullmatch(sym)
        or sym.endswith(_EXCLUDED_MARKET_SUFFIXES)
        or "-USD" in sym
    ):
        return None
    return sym


def _load_universe() -> list[str]:
    """Return the durable transcript corpus universe across all local sources.

    The Terminal watchlist manifest is intentionally small (roughly 30 names in
    the ops clone), so it cannot own corpus coverage.  Union it with the legacy
    ``us_fund`` cache (which may also hold other supported global exchanges) and
    the last-good transcript index: cache-only issuers need new calls, and
    index-only issuers must remain eligible even before fundamentals heal.
    """
    candidates: set[object] = set()

    if MANIFEST.exists():
        try:
            with open(MANIFEST) as handle:
                manifest = json.load(handle)
            rows = manifest if isinstance(manifest, list) else manifest.get("symbols", {})
            items = (
                rows.items()
                if isinstance(rows, dict)
                else ((row.get("sym", ""), row) for row in rows if isinstance(row, dict))
            )
            candidates.update(sym for sym, _row in items)
        except Exception as exc:
            print(f"[warn] could not read manifest universe: {exc}", flush=True)

    if US_FUND.is_dir():
        candidates.update(
            path.stem
            for path in US_FUND.glob("*.json")
            if not path.name.startswith("_")
        )

    if TX_INDEX.exists():
        try:
            index = json.loads(TX_INDEX.read_text())
            if not isinstance(index, dict):
                raise ValueError("index must be an object")
            candidates.update(index)
        except Exception as exc:
            print(f"[warn] could not read transcript-index universe: {exc}", flush=True)

    return sorted({sym for raw in candidates if (sym := _eligible_corpus_symbol(raw))})


# ---------------------------------------------------------------------------
# Role inference from first-paragraph text
# ---------------------------------------------------------------------------
_ROLE_PATTERNS = [
    (r"(?i)\bchief executive\b",            "CEO"),
    (r"(?i)\bpresident and ceo\b",          "CEO"),
    (r"(?i)\bceo\b",                        "CEO"),
    (r"(?i)\bchief financial\b",            "CFO"),
    (r"(?i)\bcfo\b",                        "CFO"),
    (r"(?i)\bchief operating\b",            "COO"),
    (r"(?i)\bcoo\b",                        "COO"),
    (r"(?i)\bchief revenue\b",              "CRO"),
    (r"(?i)\bcro\b",                        "CRO"),
    (r"(?i)\bchief technology\b",           "CTO"),
    (r"(?i)\bcto\b",                        "CTO"),
    (r"(?i)\bchief product\b",              "CPO"),
    (r"(?i)\bcpo\b",                        "CPO"),
    (r"(?i)\binvestor relations\b",         "IR"),
    (r"(?i)\bvice president.*investor\b",   "IR"),
    (r"(?i)\banalyst\b",                    "Analyst"),
    (r"(?i)\boperator\b",                   "Operator"),
    (r"(?i)\bmanaging director\b",          "Managing Director"),
]

_SELF_ROLE_CONTEXT_PATTERN = re.compile(
    r"""(?ix)
    (?:
        \b(?:i\s+am|i'm)\s+(?:the\s+|an?\s+)?(?:acting\s+|interim\s+)?
            (?:chief|ceo|cfo|coo|cro|cto|cpo|investor\s+relations|analyst|managing\s+director)\b
      | \bi\s+(?:serve|served|have\s+served|will\s+serve|joined|am\s+joining)\s+as\b
      | \bi\s+(?:will\s+be|am)\s+stepping\s+down\s+as\b
      | \bi(?:'ll|\s+will)\s+be\s+(?:your|the)\b
      | \bas\s+i\s+(?:take\s+on|step\s+into|transition\s+into)\b
      | \bmy\s+(?:new\s+)?role\s+as\b
      | ^\s*(?:serving|stepping|taking)\b(?=[^.!?]*\b(?:i|i'm|i've|me|my)\b)
    )
    """
)


def _matched_role(value: str) -> str:
    for pattern, role in _ROLE_PATTERNS:
        if re.search(pattern, value):
            return role
    return ""


def _role_occurrences(value: str) -> list[tuple[int, int, str]]:
    matches: set[tuple[int, int, str]] = set()
    for pattern, role in _ROLE_PATTERNS:
        for match in re.finditer(pattern, value):
            matches.add((match.start(), match.end(), role))
    return sorted(matches)


def _role_near_exact_name(speaker: str, sentence: str) -> str:
    """Return only a title locally bound to the speaker's full label.

    Introductory rosters frequently contain several executives.  The closest
    role wins, but an intervening person/joining clause rejects the match.
    """
    normalized = " ".join(speaker.split())
    if not normalized:
        return ""
    folded = sentence.casefold()
    name_matches = list(re.finditer(
        rf"(?<!\w){re.escape(normalized.casefold())}(?!\w)",
        folded,
    ))
    if not name_matches:
        return ""

    candidates: list[tuple[int, int, str]] = []
    for name_match in name_matches:
        for role_start, role_end, role in _role_occurrences(sentence):
            if role_end <= name_match.start():
                gap = name_match.start() - role_end
                between = sentence[role_end:name_match.start()]
            elif role_start >= name_match.end():
                gap = role_start - name_match.end()
                between = sentence[name_match.end():role_start]
            else:
                gap = 0
                between = ""
            if gap > 64:
                continue
            if re.search(r"(?i)\b(?:joined|joining|with\s+me|followed|hand(?:ing)?\s+(?:it\s+)?to)\b", between):
                continue
            if ";" in between:
                continue
            proper_names = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", between)
            title_or_company_words = {
                "chief", "executive", "financial", "officer", "senior", "vice",
                "president", "director", "investor", "relations", "managing",
                "interim", "company", "corporation", "corp", "inc", "limited", "group",
            }
            if any(
                not ({token.casefold() for token in phrase.split()} & title_or_company_words)
                for phrase in proper_names
            ):
                continue
            candidates.append((gap, role_start, role))
    return min(candidates)[2] if candidates else ""


def _self_declared_role(sentence: str) -> str:
    """Return a role captured by a direct first-person title statement."""
    occurrences = _role_occurrences(sentence)
    for anchor in _SELF_ROLE_CONTEXT_PATTERN.finditer(sentence):
        candidates = [
            (max(0, start - anchor.end()), start, role)
            for start, end, role in occurrences
            if end >= anchor.start() and start - anchor.end() <= 72
        ]
        if candidates:
            return min(candidates)[2]
    return ""

def _infer_role(speaker: str, text: str) -> str:
    """Conservative role inference from speaker-local evidence only.

    Earnings-call introductions often name several other executives.  Searching
    the whole paragraph therefore assigns those executives' titles to the person
    currently speaking.  Accept a title only when it is embedded in the speaker
    label or appears in a sentence that identifies the current speaker.
    """
    if re.search(r"(?i)^operator$", speaker.strip()):
        return "Operator"

    role = _matched_role(speaker)
    if role:
        return role

    # Cap work without cutting the usual introductory sentence.  A role found
    # later in a long paragraph is much more likely to describe someone else.
    for sentence in re.split(r"(?<=[.!?])\s+|[\r\n]+", text[:1000]):
        candidate = sentence.strip()
        if not candidate:
            continue
        role = _role_near_exact_name(speaker, candidate)
        if not role:
            role = _self_declared_role(candidate)
        if role:
            return role
    return ""


def _infer_transcript_roles(segments: list[dict[str, str]]) -> list[str]:
    """Infer one stable role per speaker from transcript-wide evidence.

    A roster may name the CEO before that person speaks.  Resolve that adjacent
    evidence once, then propagate it across the participant's turns so the UI
    never oscillates between CEO, Operator, and blank for the same speaker.
    """
    roles_by_speaker: dict[str, str] = {}
    speakers: dict[str, str] = {}
    for segment in segments:
        speaker = " ".join(segment.get("speaker", "").split())
        if speaker:
            speakers.setdefault(speaker.casefold(), speaker)

    # Highest-confidence evidence: the label itself.
    for key, speaker in speakers.items():
        label_role = "Operator" if re.search(r"(?i)^operator$", speaker) else _matched_role(speaker)
        if label_role:
            roles_by_speaker[key] = label_role

    # A participant almost always identifies a title on their first turn.  A
    # single pass avoids repeatedly walking the transcript for every speaker.
    first_turn_seen: set[str] = set()
    for segment in segments:
        key = " ".join(segment.get("speaker", "").split()).casefold()
        if not key or key in roles_by_speaker or key in first_turn_seen:
            continue
        first_turn_seen.add(key)
        role = _infer_role(speakers[key], segment.get("text", ""))
        if role:
            roles_by_speaker[key] = role

    # Introductory rosters and handoffs: exact full name plus adjacent title.
    # Search by sentence first so title regexes run only for participant names
    # actually present, rather than for every speaker × sentence combination.
    unresolved = set(speakers) - set(roles_by_speaker)
    for segment in segments[:5]:
        if not unresolved:
            break
        for sentence in re.split(r"(?<=[.!?])\s+|[\r\n]+", segment.get("text", "")[:2000]):
            folded = sentence.casefold()
            for key in tuple(unresolved):
                if key not in folded:
                    continue
                role = _role_near_exact_name(speakers[key], sentence)
                if role:
                    roles_by_speaker[key] = role
                    unresolved.remove(key)

    return [
        roles_by_speaker.get(" ".join(segment.get("speaker", "").split()).casefold(), "")
        for segment in segments
    ]


# ---------------------------------------------------------------------------
# Main processing
# ---------------------------------------------------------------------------
def _canonical_body_bytes(payload: object) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def process_symbol(sym: str, parquet: str, quarters: int, duckdb_mod) -> tuple[int, list[str]]:
    """Fetch rows for sym from local parquet, write .json.gz files.

    Returns (n_written, ids_written).
    """
    con = duckdb_mod.connect(":memory:")
    try:
        rows = con.execute(f"""
            SELECT symbol, fiscal_year, fiscal_quarter, report_date, transcripts
            FROM read_parquet('{parquet}')
            WHERE symbol = '{sym}'
            ORDER BY fiscal_year DESC, fiscal_quarter DESC
            LIMIT {quarters}
        """).fetchall()
    finally:
        con.close()

    if not rows:
        return 0, []

    out_dir = TX_OUT / sym
    out_dir.mkdir(parents=True, exist_ok=True)

    written   = 0
    ids_out   = []

    for row in rows:
        _, fy, fq, report_date, segments_raw = row
        tx_id = f"{fy}Q{fq}"
        ids_out.append(tx_id)

        gz_path = out_dir / f"{tx_id}.json.gz"

        # Build segments list
        segs = []
        if segments_raw:
            for seg in segments_raw:
                # DuckDB struct → dict-like; attributes differ by version
                if hasattr(seg, "_asdict"):
                    d = seg._asdict()
                elif isinstance(seg, dict):
                    d = seg
                else:
                    # tuple: (paragraph_number, speaker, content)
                    try:
                        d = {"paragraph_number": seg[0], "speaker": seg[1], "content": seg[2]}
                    except Exception:
                        d = {}

                speaker = (d.get("speaker") or "").strip()
                text    = (d.get("content") or "").strip()
                if not text:
                    continue

                segs.append({
                    "speaker": speaker,
                    "role":    "",
                    "text":    text,
                })

        for segment, role in zip(segs, _infer_transcript_roles(segs)):
            segment["role"] = role

        payload = {
            "schema":   "mastermind.tx/v1",
            "ticker":   sym,
            "id":       tx_id,
            "period":   f"Q{fq} FY{fy}",
            "date":     str(report_date) if report_date else None,
            "title":    f"{sym} Earnings Call Q{fq} FY{fy}",
            "segments": segs,
        }

        raw = _canonical_body_bytes(payload)
        if gz_path.exists():
            try:
                existing = _read_body(gz_path, sym, tx_id)
            except ValueError as exc:
                print(f"[warn] repairing invalid transcript body {gz_path}: {exc}", flush=True)
            else:
                if _canonical_body_bytes(existing) == raw:
                    continue

        # Atomic replacement prevents a kill mid-write from leaving a truncated
        # body, whether this is a new call, an upstream correction, or a repair.
        tmp_path = gz_path.with_name(gz_path.name + ".tmp")
        try:
            with gzip.open(tmp_path, "wb", compresslevel=6) as f:
                f.write(raw)
            os.replace(tmp_path, gz_path)
        finally:
            tmp_path.unlink(missing_ok=True)
        written += 1

    return written, ids_out


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main() -> int:
    signal.signal(signal.SIGINT, _handle_sigint)
    ap = argparse.ArgumentParser(description="Collect earnings-call transcripts (defeatbeta-api)")
    ap.add_argument("--only",     default="",  help="comma-separated symbols (ZS,AAPL,…)")
    ap.add_argument("--quarters", type=int, default=8, help="most-recent quarters per symbol (default 8)")
    ap.add_argument("--limit",    type=int, default=0, help="cap symbol count (0 = no limit)")
    ap.add_argument("--refresh-parquet", action="store_true",
                    help="force re-download of the transcripts parquet (else re-downloads when "
                         f"absent, undersized, or ≥{PARQUET_STALE_DAYS} days old)")
    ap.add_argument(
        "--probe-parquet-revision",
        action="store_true",
        help=(
            "HEAD-probe the upstream parquet and exit 0 if already applied, "
            f"{REVISION_CHANGED} if changed, or {REVISION_PROBE_FAILED} if unavailable"
        ),
    )
    ap.add_argument(
        "--upstream-revision",
        default="",
        help="revision returned by --probe-parquet-revision; suppresses age-only redownloads",
    )
    ap.add_argument(
        "--revision-candidate-out",
        type=Path,
        default=None,
        help="write a successfully processed revision here for a later atomic promotion",
    )
    ap.add_argument(
        "--defer-index-publish",
        action="store_true",
        help="write transcript bodies only; validate and publish indexes in a later step",
    )
    args = ap.parse_args()

    # The nightly freshness check must stay metadata-only and must not bootstrap
    # the defeatbeta venv, load DuckDB, or touch the 2.2 GB parquet.
    if args.probe_parquet_revision:
        status, revision, error = _parquet_revision_probe_status()
        if revision is not None:
            print(revision)
        if error:
            print(f"[warn] {error}", file=sys.stderr, flush=True)
        return status

    upstream_revision = None
    if args.upstream_revision:
        upstream_revision = _normalize_revision_token(args.upstream_revision)
        if upstream_revision is None:
            print(f"[error] invalid --upstream-revision: {args.upstream_revision!r}", flush=True)
            return 2

    # Re-exec in the defeatbeta venv if not already there
    if not _is_running_in_dbeta_venv():
        venv = _ensure_venv()
        py   = str(venv / "bin" / "python")
        print(f"[re-exec] using {py}", flush=True)
        os.execv(py, [py] + sys.argv)
        # unreachable

    # Now import duckdb (available in the dbeta venv)
    import duckdb  # noqa: F811

    # Build universe
    if args.only:
        requested = [value for value in args.only.split(",") if value.strip()]
        invalid = [value for value in requested if _eligible_corpus_symbol(value) is None]
        if invalid:
            print(f"[error] unsafe or unsupported --only symbol(s): {invalid}", flush=True)
            return 2
        universe = sorted({_eligible_corpus_symbol(value) for value in requested})
    else:
        universe = _load_universe()
        if not universe:
            print("[warn] empty universe from local sources; use --only SYM,…", flush=True)
            return 1

    if args.limit and args.limit < len(universe):
        universe = universe[:args.limit]

    print(f"[info] {len(universe)} symbols | {args.quarters} quarters each", flush=True)

    # Ensure parquet is available
    downloaded_revision: str | None = None
    if _need_download(
        refresh=args.refresh_parquet,
        upstream_revision=upstream_revision,
    ):
        downloaded_revision = _download_parquet(expected_revision=upstream_revision)
    else:
        sz_mb = LOCAL_PARQUET.stat().st_size // 1_000_000
        print(f"[info] using cached parquet: {LOCAL_PARQUET} ({sz_mb} MB)", flush=True)
    processed_revision = (
        downloaded_revision
        or upstream_revision
        or _read_revision_marker(PARQUET_CACHE_REVISION_MARKER)
    )

    parquet_str = str(LOCAL_PARQUET)
    TX_OUT.mkdir(parents=True, exist_ok=True)

    total_written = 0
    total_skipped = 0
    missing_syms  = []

    for i, sym in enumerate(universe, 1):
        if _stop:
            break

        n_written, ids = process_symbol(sym, parquet_str, args.quarters, duckdb)

        if not ids:
            missing_syms.append(sym)
        else:
            if n_written > 0:
                total_written += n_written
            else:
                total_skipped += len(ids)

        if i % 50 == 0 or i == len(universe):
            print(f"  [{i}/{len(universe)}] written={total_written} skipped={total_skipped} "
                  f"missing={len(missing_syms)}", flush=True)

    print(f"\n[done] written={total_written} skipped={total_skipped} "
          f"missing={len(missing_syms)}", flush=True)
    if missing_syms and len(missing_syms) <= 20:
        print(f"  missing syms: {missing_syms}", flush=True)

    if _stop:
        print("[interrupt] indexes were not changed; retry the collection run", flush=True)
        return 130

    if args.defer_index_publish:
        if processed_revision is not None:
            target = args.revision_candidate_out or PARQUET_REVISION_MARKER
            _write_revision_marker(target, processed_revision)
            print(f"[revision] processed {processed_revision}", flush=True)
        print("[index] deferred; bodies await validated publication", flush=True)
        return 0

    # Rebuild from the bodies that actually exist.  One atomic final write is
    # faster and safer than rewriting a growing JSON map once per symbol, and a
    # killed run leaves the prior last-good indexes intact.
    try:
        from build_transcript_index import write_transcript_indexes
    except ImportError:  # module execution: python -m ingest.collect_transcripts
        from ingest.build_transcript_index import write_transcript_indexes
    US_FUND.mkdir(parents=True, exist_ok=True)
    global_index, _legacy = write_transcript_indexes(
        TX_OUT,
        write_public=True,
        legacy_out=TX_INDEX,
    )
    print(
        f"[index] {global_index['body_count']} bodies across "
        f"{global_index['symbol_count']} symbols",
        flush=True,
    )
    if processed_revision is not None:
        target = args.revision_candidate_out or PARQUET_REVISION_MARKER
        _write_revision_marker(target, processed_revision)
        print(f"[revision] processed {processed_revision}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
