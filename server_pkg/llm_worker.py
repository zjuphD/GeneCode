"""Minimal frozen-sidecar HTTP worker; request secrets arrive only on stdin."""
import json
import ssl
import sys
import urllib.request
from urllib.error import HTTPError, URLError


def main():
    try:
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        context = ssl.create_default_context(cafile=payload.get("cafile") or None)
        request = urllib.request.Request(
            sys.argv[2], data=payload["body"].encode("utf-8"),
            headers=payload["headers"], method="POST",
        )
        with urllib.request.urlopen(request, context=context, timeout=payload["timeout"]) as response:
            data = response.read()
        sys.stdout.write("\x01" + data.decode("utf-8", "replace"))
    except HTTPError as error:
        sys.stdout.write("\x02" + str(error.code) + "\x00" + error.read().decode("utf-8", "replace")[:400])
    except URLError as error:
        sys.stdout.write("\x03" + str(getattr(error, "reason", error)))
    except TimeoutError:
        sys.stdout.write("\x04")
    except Exception as error:
        sys.stdout.write("\x03" + type(error).__name__ + ": " + str(error))
