#!/usr/bin/env python3
"""Small stdin/stdout bridge for browser-fingerprinted HTTP requests."""

import base64
import json
import sys

from curl_cffi import requests


def main() -> None:
    request = json.load(sys.stdin)
    response = requests.request(
        method=request["method"],
        url=request["url"],
        headers=dict(request.get("headers", [])),
        data=base64.b64decode(request["bodyBase64"]) if request.get("bodyBase64") else None,
        timeout=request["timeoutSeconds"],
        allow_redirects=False,
        impersonate=request.get("impersonate", "chrome"),
        proxy=request.get("proxy"),
    )

    headers = response.headers
    if hasattr(headers, "multi_items"):
        header_items = list(headers.multi_items())
    else:
        header_items = list(headers.items())

    json.dump(
        {
            "status": response.status_code,
            "headers": header_items,
            "bodyBase64": base64.b64encode(response.content).decode("ascii"),
        },
        sys.stdout,
        separators=(",", ":"),
    )


if __name__ == "__main__":
    main()
