import pytest
from botocore.exceptions import ClientError

from db.base import Err, Ok, safe


class TestResultType:
    def test_ok_is_ok(self):
        assert Ok(42).is_ok()
        assert not Ok(42).is_err()

    def test_ok_unwrap(self):
        assert Ok("hello").unwrap() == "hello"

    def test_ok_none(self):
        r = Ok(None)
        assert r.is_ok()
        assert r.unwrap() is None

    def test_err_is_err(self):
        r = Err(ValueError("boom"))
        assert r.is_err()
        assert not r.is_ok()

    def test_err_unwrap_raises(self):
        with pytest.raises(ValueError):
            Err(ValueError("bad input")).unwrap()

    def test_ok_value(self):
        assert Ok(99).value == 99

    def test_err_stores_exception(self):
        e = RuntimeError("x")
        assert Err(e).error is e


class TestSafeDecorator:
    def test_passes_through_ok(self):
        @safe
        def fn():
            return Ok(1)
        assert fn().unwrap() == 1

    def test_catches_client_error(self):
        @safe
        def fn():
            raise ClientError({"Error": {"Code": "ValidationException", "Message": "x"}}, "Op")
        assert fn().is_err()

    def test_catches_generic_exception(self):
        @safe
        def fn():
            raise RuntimeError("unexpected")
        assert fn().is_err()

    def test_catches_connection_error(self):
        @safe
        def fn():
            raise ConnectionError("no route")
        assert fn().is_err()

    def test_preserves_function_name(self):
        @safe
        def my_function():
            return Ok(None)
        assert my_function.__name__ == "my_function"

    def test_err_unwrap_raises_original(self):
        @safe
        def fn():
            raise RuntimeError("boom")
        with pytest.raises(RuntimeError):
            fn().unwrap()


class TestUpdateIf:
    def test_empty_updates_raises(self, db):
        with pytest.raises(ValueError):
            db.mandate._update_if("USER#x@y.z", "TICKET#T#MANDATE", {}, "attribute_exists(pk)")
