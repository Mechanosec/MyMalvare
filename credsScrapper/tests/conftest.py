import pytest

from app.state.db import init_db


@pytest.fixture
def conn(tmp_path):
    return init_db(str(tmp_path / "state.db"))
