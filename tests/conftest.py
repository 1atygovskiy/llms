"""Pytest fixtures for branch tests."""

import asyncio
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("LLMS_SYNC", "1")


class MockCtx:
    debug = False

    def dbg(self, *args):
        pass

    def err(self, *args):
        pass

    def log(self, *args):
        pass

    def cache_message_inline_data(self, message, context=None):
        pass


@pytest.fixture
def mock_ctx():
    return MockCtx()


@pytest.fixture
def temp_db(mock_ctx):
    from llms.extensions.app.db import AppDB
    from llms.extensions.app.branches import BranchService

    td = tempfile.mkdtemp()
    db_path = os.path.join(td, "test.sqlite")
    db = AppDB(mock_ctx, db_path)
    branches = BranchService(db)
    yield db, branches
    db.close()


@pytest.fixture
def sample_thread(temp_db):
    db, _ = temp_db

    async def _create():
        return await db.create_thread_async(
            {
                "title": "Test",
                "messages": [
                    {"role": "user", "content": "hello", "timestamp": 1000},
                    {"role": "assistant", "content": "hi", "timestamp": 1001},
                    {"role": "user", "content": "branch point", "timestamp": 1002},
                ],
            }
        )

    thread_id = asyncio.run(_create())
    return thread_id


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def llms_server():
    """Optional live server for manual headed UI runs (LLMS_TEST_SERVER=1)."""
    if os.getenv("LLMS_TEST_SERVER", "0") != "1":
        pytest.skip("Set LLMS_TEST_SERVER=1 to run live server UI tests")
    port = _free_port()
    env = os.environ.copy()
    env["LLMS_PORT"] = str(port)
    proc = subprocess.Popen(
        [sys.executable, "-m", "llms", "--serve", str(port)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            import urllib.request

            urllib.request.urlopen(f"{base}/status", timeout=1)
            break
        except Exception:
            time.sleep(0.5)
    else:
        proc.kill()
        pytest.skip("llms server failed to start")
    yield base
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture
def llms_base_url(llms_server):
    return llms_server
