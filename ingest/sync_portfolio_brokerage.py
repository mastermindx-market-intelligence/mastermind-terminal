"""Consume the existing nightly timer. Only the private server talks to institutions."""
import json
import os
import sys
import urllib.request


def main():
    if os.environ.get("PORTFOLIO_BROKERAGE_ENABLED") != "1":
        return 0
    key = os.environ.get("PORTFOLIO_BROKERAGE_CRON_SECRET", "")
    if len(key) < 32:
        print("Brokerage sync unavailable: server configuration incomplete")
        return 1
    cursor, failed, total = None, 0, 0
    while True:
        request = urllib.request.Request(
            "http://127.0.0.1:3000/api/portfolio/brokerage/daily",
            data=json.dumps({"cursor": cursor}).encode(),
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
        with urllib.request.urlopen(request, timeout=90) as response:
            page = json.load(response)
        total += page["attempted"]
        failed += page["failed"]
        following = page["next"]
        if following is None:
            break
        if not isinstance(following, str) or (cursor and following <= cursor):
            raise ValueError("Brokerage cursor did not advance")
        cursor = following
    print(f"Brokerage refresh attempted {total} connections, {failed} unconfirmed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
