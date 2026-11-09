#!/usr/bin/env python3
"""Add one ticker to an owned Terminal watchlist, with bounded safe retries.

The API key is read only from MMX_API_KEY. Reuse --request-id with identical
arguments after an uncertain outcome; never generate a replacement ID to retry.
"""
import argparse
import datetime as dt
import email.utils
import http.client
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

RETRYABLE = {429, 502, 503, 504}
MAX_RESPONSE = 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a bearer credential to a redirect destination.


def retry_delay(value, fallback, now=None):
    if value:
        if re.fullmatch(r"[0-9]+", value.strip()):
            return float(value.strip())
        try:
            stamp = email.utils.parsedate_to_datetime(value)
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=dt.timezone.utc)
            return max(0, stamp.timestamp() - (time.time() if now is None else now))
        except (ValueError, TypeError, OverflowError):
            pass
    return fallback


def endpoint_url(endpoint, list_id):
    parsed = urllib.parse.urlsplit(endpoint)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("--endpoint must be an origin without credentials, path, query or fragment")
    if not parsed.hostname or parsed.scheme not in ("http", "https"):
        raise ValueError("--endpoint must be HTTPS (HTTP is allowed only on loopback for testing)")
    if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("HTTP is allowed only on loopback")
    return endpoint.rstrip("/") + "/api/v1/watchlists/" + str(uuid.UUID(list_id)) + "/symbols"


def import_symbol(endpoint, list_id, symbol, request_id, *, section=None, key=None,
                  attempts=4, deadline=120.0, timeout=15.0, opener=None, clock=time.monotonic, sleep=time.sleep):
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{16,128}", request_id):
        raise ValueError("request ID must be 16-128 letters, digits, underscore, dot, colon or hyphen")
    if not isinstance(symbol, str) or not symbol.strip() or len(symbol.strip().upper()) > 128 or re.search(r"[\x00-\x1f\x7f]", symbol):
        raise ValueError("symbol must be nonempty, at most 128 characters, without control characters")
    if section is not None and (not isinstance(section, str) or len(section.strip()) > 80 or re.search(r"[\x00-\x1f\x7f]", section)):
        raise ValueError("section must be at most 80 characters without control characters")
    if not 1 <= attempts <= 10 or not all(math.isfinite(x) and x > 0 for x in (deadline, timeout)) or deadline > 3600 or timeout > 120:
        raise ValueError("attempts must be 1-10, deadline 0-3600 seconds, timeout 0-120 seconds")
    key = key if key is not None else os.environ.get("MMX_API_KEY", "")
    if not re.fullmatch(r"mmx_[A-Za-z0-9_-]{40}", key):
        raise ValueError("MMX_API_KEY must contain a personal Terminal API key")
    url = endpoint_url(endpoint, list_id)
    payload = {"symbol": symbol.strip().upper()}
    if section is not None:
        payload["section"] = section.strip()
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf8")
    opener = opener or urllib.request.build_opener(NoRedirect())
    end = clock() + deadline
    last_status = None
    for attempt in range(attempts):
        remaining = end - clock()
        if remaining <= 0:
            break
        request = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": "Bearer " + key, "Idempotency-Key": request_id,
            "Content-Type": "application/json", "Accept": "application/json",
        })
        status, headers, response_body = None, {}, b""
        try:
            try:
                response = opener.open(request, timeout=min(timeout, remaining))
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status, headers = response.code, response.headers
                chunks = []
                size = 0
                while size <= MAX_RESPONSE:
                    if clock() >= end:
                        raise TimeoutError("response deadline")
                    chunk = response.read1(min(65536, MAX_RESPONSE + 1 - size))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                response_body = b"".join(chunks)
            if len(response_body) > MAX_RESPONSE:
                raise ValueError("API response exceeded the size limit; outcome may be unknown")
            if status in (200, 201):
                try:
                    data = json.loads(response_body)
                except (ValueError, UnicodeError):
                    raise ValueError("API returned malformed success; retry later with the same request ID") from None
                if not isinstance(data, dict) or data.get("schema") != "mm.api.v1.watchlist_symbol":
                    raise ValueError("API returned an unexpected success; retry later with the same request ID")
                return data
            if status not in RETRYABLE:
                # Do not echo arbitrary response bodies, URLs or request credentials.
                raise ValueError(f"API refused the request (HTTP {status}); no automatic retry")
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
            pass  # The operation may have committed. Preserve its identity and bytes.
        last_status = status
        delay = retry_delay(headers.get("Retry-After"), min(2 ** attempt, 8))
        if attempt + 1 >= attempts or delay >= end - clock():
            break
        sleep(delay)
    suffix = f" (last HTTP {last_status})" if last_status else ""
    raise ValueError("Retry budget exhausted" + suffix + "; outcome may be unknown. Reuse the SAME request ID and arguments.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="https://app.mastermind-x.com")
    parser.add_argument("--list-id", required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--section")
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--attempts", type=int, default=4)
    parser.add_argument("--deadline", type=float, default=120)
    parser.add_argument("--timeout", type=float, default=15)
    args = vars(parser.parse_args(argv))
    try:
        print(json.dumps(import_symbol(**args), ensure_ascii=False))
        return 0
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
