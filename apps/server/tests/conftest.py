"""Test isolation: nothing in the test run may read or write the learner's real data.

`syllabus_server.app` builds an app at import time (`app = create_app()`), which opens the
learner database and may copy the legacy ~/.forge-ml database. This file is imported by pytest
before any test module, so the environment below is in place before that import happens.
"""
import os
import tempfile
from pathlib import Path

_SANDBOX = Path(tempfile.mkdtemp(prefix="syllabus-tests-"))
os.environ["SYLLABUS_DATA_DIR"] = str(_SANDBOX / "data")   # an explicit data dir also disables the legacy copy
os.environ["SYLLABUS_NO_LIMITS_PROBE"] = "1"                # no background `claude` calls from tests
os.environ.pop("FORGE_DATA_DIR", None)
# Path.home() for code that ignores the data dir (e.g. LEGACY_DB is computed from it at import).
os.environ["HOME"] = os.environ["USERPROFILE"] = str(_SANDBOX / "home")
