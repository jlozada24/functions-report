#!/usr/bin/env python3
"""Serve a generated functions-report preview with a mandatory timeout."""

from __future__ import annotations

import argparse
import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


DEFAULT_TIMEOUT_SECONDS = 7_200
MAX_TIMEOUT_SECONDS = 14_400


def bounded_timeout(value: str) -> int:
    try:
        seconds = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("timeout must be an integer number of seconds") from error
    if not 1 <= seconds <= MAX_TIMEOUT_SECONDS:
        raise argparse.ArgumentTypeError(
            f"timeout must be between 1 and {MAX_TIMEOUT_SECONDS} seconds"
        )
    return seconds


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve a generated functions-report preview over loopback HTTP."
    )
    parser.add_argument(
        "--directory",
        required=True,
        type=Path,
        help="Directory containing the generated standalone preview.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="Loopback port; 0 selects an available port.",
    )
    parser.add_argument(
        "--timeout-seconds",
        type=bounded_timeout,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=(
            f"Mandatory shutdown timeout (default {DEFAULT_TIMEOUT_SECONDS}; "
            f"maximum {MAX_TIMEOUT_SECONDS})."
        ),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    directory = args.directory.expanduser().resolve(strict=True)
    if not directory.is_dir():
        raise SystemExit(f"Preview directory is not a directory: {directory}")
    if not 0 <= args.port <= 65_535:
        raise SystemExit("Port must be between 0 and 65535")

    handler = functools.partial(SimpleHTTPRequestHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    timer = threading.Timer(args.timeout_seconds, server.shutdown)
    timer.daemon = True
    timer.start()

    host, port = server.server_address
    print(
        f"Serving preview on http://{host}:{port}/ "
        f"(automatic shutdown in {args.timeout_seconds} seconds)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        timer.cancel()
        server.server_close()


if __name__ == "__main__":
    main()
