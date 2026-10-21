"""Contract tests for broker-independent JSON decoding and lossless envelopes."""

import base64
import copy
import json
import logging
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import UUID

import pytest
from pydantic import ValidationError
from referencing.exceptions import NoSuchResource

from syntara.core.config.base import Settings
from syntara.core.constants import EventStreamLimits
from syntara.eventstreams.adapters.kafka_metadata import KafkaSourceMetadata, KafkaTimestampType
from syntara.eventstreams.adapters.source_metadata import SourceMetadata
from syntara.eventstreams.core.envelope import (
    OriginalEvent,
    OriginalEventHeader,
    RawEvent,
    RawEventHeader,
    WorkflowEventEnvelope,
)
from syntara.eventstreams.core.results import EventDecodeFailure, EventFailureCode
from syntara.eventstreams.core.serialization import (
    EventDecodeSuccess,
    JsonEventDecoder,
    encode_envelope,
    encoded_envelope_size,
    validate_payload,
)
from syntara.workflows.json_schema_validation import NO_REF_REGISTRY


def _metadata() -> KafkaSourceMetadata:
    return KafkaSourceMetadata(
        integration_id=UUID(int=1),
        subscription_id=UUID(int=2),
        source_generation=1,
        received_at=datetime(2026, 10, 17, tzinfo=UTC),
        topic="events",
        partition=2,
        offset="9223372036854775807",
        timestamp_ms=1792195200000,
        timestamp_type=KafkaTimestampType.create_time,
    )


def _event(
    value: bytes | None,
    *,
    key: bytes | None = None,
    headers: list[tuple[str, bytes | None]] | None = None,
    metadata: SourceMetadata | None = None,
) -> RawEvent:
    return RawEvent(
        value=value,
        key=key,
        headers=tuple(RawEventHeader(name=name, value=data) for name, data in headers or []),
        source_metadata=metadata or _metadata(),
    )


@pytest.mark.parametrize(
    ("value", "payload"),
    [
        (b'{ "a": [1, true, null] }', {"a": [1, True, None]}),
        (b'[1, "two", null]', [1, "two", None]),
        (b'"hello"', "hello"),
        ('"snowman: ☃"'.encode(), "snowman: ☃"),
        (b"42", 42),
        (b"-1.25e2", -125.0),
        (b"true", True),
        (b"false", False),
        (b"null", None),
    ],
)
def test_supported_json_values(value: bytes, payload: object) -> None:
    """Every supported JSON root retains the decoded value and exact source."""
    result = JsonEventDecoder().decode(_event(value))
    assert isinstance(result, EventDecodeSuccess)
    assert result.envelope.envelope_version == 1
    assert result.envelope.payload == payload
    assert result.envelope.cloudevents is None
    assert base64.b64decode(result.envelope.original.value_base64) == value


@pytest.mark.parametrize("key", [None, b"", b"\x00\xffkey"])
def test_byte_fidelity_and_metadata(key: bytes | None) -> None:
    """Binary, null, empty, and repeated headers retain their order and bytes."""
    headers = [("repeat", b"\x00\xff"), ("repeat", b""), ("repeat", None)]
    event = _event(b' {"unicode":"\\u2603"} \n', key=key, headers=headers)
    before = event.model_copy(deep=True)
    result = JsonEventDecoder().decode(event)
    assert isinstance(result, EventDecodeSuccess)
    original = result.envelope.original
    assert (None if original.key_base64 is None else base64.b64decode(original.key_base64)) == key
    restored_headers = [
        (h.name, None if h.value_base64 is None else base64.b64decode(h.value_base64)) for h in original.headers
    ]
    assert restored_headers == headers
    encoded = json.loads(encode_envelope(result.envelope))
    assert encoded["metadata"] == {
        "integration_id": str(UUID(int=1)),
        "subscription_id": str(UUID(int=2)),
        "source_generation": 1,
        "received_at": "2026-10-17T00:00:00Z",
        "transport": "kafka",
        "topic": "events",
        "partition": 2,
        "offset": "9223372036854775807",
        "timestamp_ms": 1792195200000,
        "timestamp_type": "create_time",
    }
    assert event == before


@pytest.mark.parametrize("value", [b'{"z":[1,true,null],"a":"\\u2603"}', b"[1,null]", b'"text"', b"42", b"null"])
@pytest.mark.parametrize("key", [None, b"", b"\x00\xff"])
def test_envelope_round_trips_its_own_output(value: bytes, key: bytes | None) -> None:
    """Both model and encoded JSON outputs restore the concrete metadata type."""
    result = JsonEventDecoder().decode(
        _event(value, key=key, headers=[("repeat", b"\xff"), ("repeat", b""), ("repeat", None)])
    )
    assert isinstance(result, EventDecodeSuccess)
    envelope = result.envelope
    restored = [
        WorkflowEventEnvelope.model_validate_json(encode_envelope(envelope)),
        WorkflowEventEnvelope.model_validate_json(envelope.model_dump_json()),
        WorkflowEventEnvelope.model_validate(envelope.model_dump()),
    ]
    for actual in restored:
        assert actual == envelope
        assert isinstance(actual.source_metadata, KafkaSourceMetadata)
        assert actual.source_metadata.offset == "9223372036854775807"


@pytest.mark.parametrize("field_name", ["metadata", "source_metadata"])
def test_envelope_accepts_alias_and_field_name(field_name: str) -> None:
    """Construction accepts either spelling and emits the documented alias."""
    result = JsonEventDecoder().decode(_event(b"null"))
    assert isinstance(result, EventDecodeSuccess)
    data = result.envelope.model_dump(by_alias=False)
    metadata = data.pop("source_metadata")
    data[field_name] = metadata
    envelope = WorkflowEventEnvelope(**data)
    assert envelope == result.envelope
    assert "metadata" in envelope.model_dump()
    assert "source_metadata" not in envelope.model_dump()
    assert envelope.dict() == envelope.model_dump(mode="json")


@pytest.mark.parametrize(
    ("transport", "error_type"),
    [(None, "union_tag_not_found"), ("queue", "union_tag_invalid")],
)
def test_envelope_rejects_missing_or_unknown_transport(transport: str | None, error_type: str) -> None:
    """Loading never silently treats an unknown source as the common base."""
    result = JsonEventDecoder().decode(_event(b"null"))
    assert isinstance(result, EventDecodeSuccess)
    data = result.envelope.model_dump(mode="json")
    if transport is None:
        data["metadata"].pop("transport")
    else:
        data["metadata"]["transport"] = transport
    with pytest.raises(ValidationError) as exc_info:
        WorkflowEventEnvelope.model_validate(data)
    assert exc_info.value.errors()[0]["type"] == error_type


def test_envelope_rejects_extra_metadata_fields() -> None:
    """Concrete metadata remains strict after selecting the transport variant."""
    result = JsonEventDecoder().decode(_event(b"null"))
    assert isinstance(result, EventDecodeSuccess)
    data = result.envelope.model_dump(mode="json")
    data["metadata"]["unexpected"] = "private"
    with pytest.raises(ValidationError) as exc_info:
        WorkflowEventEnvelope.model_validate(data)
    assert exc_info.value.errors()[0]["type"] == "extra_forbidden"


def test_raw_event_restores_typed_metadata() -> None:
    """Raw Python model output retains bytes and reloads the source variant."""
    event = _event(b"null", key=b"\xff", headers=[("binary", b"\xff")])
    actual = RawEvent.model_validate(event.model_dump())
    assert actual == event
    assert isinstance(actual.source_metadata, KafkaSourceMetadata)


def test_original_models_are_strict_and_immutable() -> None:
    """Preserved source fields and ordered headers cannot be changed in place."""
    header = OriginalEventHeader(name="repeat", value_base64=None)
    original = OriginalEvent(value_base64="bnVsbA==", key_base64=None, headers=(header,))
    assert isinstance(original.headers, tuple)
    assert isinstance(_event(b"null", headers=[("repeat", None)]).headers, tuple)
    with pytest.raises(ValidationError, match="frozen_instance"):
        header.value_base64 = "changed"
    with pytest.raises(ValidationError, match="frozen_instance"):
        original.headers = ()
    with pytest.raises(ValidationError, match="extra_forbidden"):
        OriginalEventHeader.model_validate({**header.model_dump(), "unexpected": True})
    with pytest.raises(ValidationError, match="extra_forbidden"):
        OriginalEvent.model_validate({**original.model_dump(), "unexpected": True})


@pytest.mark.parametrize("offset", [42, "-1", "01", "1.5"])
def test_offset_requires_canonical_decimal_string(offset: object) -> None:
    """Offset construction cannot silently round, coerce, or truncate values."""
    data = _metadata().model_dump()
    data["offset"] = offset
    with pytest.raises(ValidationError):
        KafkaSourceMetadata.model_validate(data)


@pytest.mark.parametrize(
    ("value", "code"),
    [
        (None, EventFailureCode.tombstone),
        (b"", EventFailureCode.invalid_json),
        (b"\xff", EventFailureCode.invalid_utf8),
        (b'"\\ud800"', EventFailureCode.invalid_utf8),
        (b'{"\\ud800":1}', EventFailureCode.invalid_utf8),
        (b"\xef\xbb\xbf{}", EventFailureCode.invalid_json),
        (b"{'a':1}", EventFailureCode.invalid_json),
        (b"{} trailing", EventFailureCode.invalid_json),
        (b'{"a":1,"a":2}', EventFailureCode.duplicate_member),
        (b'{"nested":{"a":1,"\\u0061":2}}', EventFailureCode.duplicate_member),
        (b"NaN", EventFailureCode.non_finite_number),
        (b"[Infinity]", EventFailureCode.non_finite_number),
        (b"-Infinity", EventFailureCode.non_finite_number),
        (b"1e999", EventFailureCode.non_finite_number),
        (b"\x00\x00\x00\x00\x01data", EventFailureCode.registry_framing),
    ],
)
def test_invalid_values_are_typed_failures(value: bytes | None, code: EventFailureCode) -> None:
    """Content errors return per-message results, not application exceptions."""
    result = JsonEventDecoder().decode(_event(value))
    assert isinstance(result, EventDecodeFailure)
    assert result.code == code


def test_utf8_surrogate_pair_is_accepted() -> None:
    """A valid escaped pair is a Unicode scalar and remains supported JSON."""
    result = JsonEventDecoder().decode(_event(b'"\\ud800\\udc00"'))
    assert isinstance(result, EventDecodeSuccess)
    assert result.envelope.payload == "\U00010000"


@pytest.mark.parametrize(
    "content_type",
    [
        None,
        b"application/json",
        b'Application/JSON; charset="UTF-8"',
        b"application/vnd.acme+json",
        b"text/custom+json",
    ],
)
def test_supported_or_null_content_types(content_type: bytes | None) -> None:
    """Missing/null headers fall back to JSON; custom JSON suffixes work."""
    result = JsonEventDecoder().decode(_event(b"[1]", headers=[("Content-Type", content_type)]))
    assert isinstance(result, EventDecodeSuccess)


@pytest.mark.parametrize(
    ("headers", "code"),
    [
        ([("content-type", b"")], EventFailureCode.malformed_content_type),
        ([("content-type", b"not-a-media-type")], EventFailureCode.malformed_content_type),
        ([("content-type", b"application/json; broken")], EventFailureCode.malformed_content_type),
        ([("content-type", b"\xff")], EventFailureCode.malformed_content_type),
        ([("content-type", b"application/json\r\ninjected:x")], EventFailureCode.malformed_content_type),
        ([("content-type", b"application/json; charset=latin1")], EventFailureCode.unsupported_content_type),
        ([("content-type", b"application/avro")], EventFailureCode.unsupported_content_type),
        (
            [("content-type", b"application/json"), ("Content-Type", b"application/json")],
            EventFailureCode.duplicate_content_type,
        ),
        (
            [("content-type", b"application/json"), ("content-type", b"text/plain")],
            EventFailureCode.duplicate_content_type,
        ),
        ([("content-type", None), ("content-type", None)], EventFailureCode.duplicate_content_type),
    ],
)
def test_header_failures_stop_only_this_message(
    headers: list[tuple[str, bytes | None]], code: EventFailureCode
) -> None:
    """The same decoder remains usable after malformed or ambiguous headers."""
    decoder = JsonEventDecoder()
    result = decoder.decode(_event(b"{}", headers=headers))
    assert isinstance(result, EventDecodeFailure)
    assert result.code == code
    assert isinstance(decoder.decode(_event(b"{}")), EventDecodeSuccess)


def test_schema_validates_payload_without_defaults_or_mutation() -> None:
    """Defaults cannot change the original event or satisfy a missing field."""
    event = _event(b'{"count":2}')
    result = JsonEventDecoder().decode(event)
    assert isinstance(result, EventDecodeSuccess)
    before = encode_envelope(result.envelope)
    schema: dict[str, Any] = {
        "type": "object",
        "required": ["count"],
        "properties": {"count": {"type": "integer"}, "extra": {"default": "never inserted"}},
    }
    schema_before = copy.deepcopy(schema)
    assert validate_payload(result.envelope, schema) is None
    assert encode_envelope(result.envelope) == before
    assert schema == schema_before
    schema["required"] = ["extra"]
    failure = validate_payload(result.envelope, schema)
    assert failure is not None
    assert failure.code == EventFailureCode.schema_mismatch
    assert encode_envelope(result.envelope) == before


@pytest.mark.parametrize(
    ("schema", "code"),
    [
        ({"type": "integer"}, EventFailureCode.schema_mismatch),
        ({"type": "invalid"}, EventFailureCode.invalid_schema),
        ({"$ref": "https://example.com/schema"}, EventFailureCode.invalid_schema),
        ({"$ref": "#/definitions/local"}, EventFailureCode.invalid_schema),
        ({"type": "string", "pattern": "(a+)+$"}, EventFailureCode.invalid_schema),
        ({"patternProperties": {"(a+)+$": {}}}, EventFailureCode.invalid_schema),
    ],
)
def test_schema_failures_are_safe(schema: dict[str, Any], code: EventFailureCode) -> None:
    """Existing definition guards apply without default-filling validation."""
    result = JsonEventDecoder().decode(_event(b'"secret"'), schema=schema)
    assert isinstance(result, EventDecodeFailure)
    assert result.code == code
    assert "secret" not in result.message


def test_public_registry_denies_resource_retrieval() -> None:
    """The shared registry cannot fetch untrusted schema resources."""
    with pytest.raises(NoSuchResource):
        NO_REF_REGISTRY.get_or_retrieve("urn:syntara:blocked")


def test_runtime_registry_blocks_refs_without_definition_guard() -> None:
    """Runtime validation stays closed even if a caller bypasses schema checks."""
    with patch("syntara.eventstreams.core.serialization.validate_json_schema_definition", return_value=None):
        result = JsonEventDecoder().decode(_event(b"{}"), schema={"$ref": "urn:syntara:blocked"})
    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.invalid_schema


@pytest.mark.parametrize("multiple_of", [0.1, 0.01])
@pytest.mark.parametrize("digits", [309, 400])
def test_float_multiple_of_overflow_returns_schema_mismatch(multiple_of: float, digits: int) -> None:
    """Large valid integers cannot escape payload validation as overflow errors."""
    decoder = JsonEventDecoder()
    event = _event(b"9" * digits)
    before = event.model_copy(deep=True)
    decoded = decoder.decode(event)
    assert isinstance(decoded, EventDecodeSuccess)
    schema = {"multipleOf": multiple_of}

    failure = validate_payload(decoded.envelope, schema)
    assert isinstance(failure, EventDecodeFailure)
    assert failure.code == EventFailureCode.schema_mismatch

    result = decoder.decode(event, schema=schema)
    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.schema_mismatch
    assert (event.value or b"").decode() not in result.message
    assert event == before
    assert isinstance(decoder.decode(_event(b"1"), schema=schema), EventDecodeSuccess)


@pytest.mark.parametrize("error_type", [OverflowError, ZeroDivisionError])
def test_decoder_arithmetic_errors_return_invalid_json(error_type: type[ArithmeticError]) -> None:
    """Arithmetic failures outside schema validation stay safe and per-message."""
    decoder = JsonEventDecoder()
    event = _event(b"123")
    private_marker = "CUSTOMER_PRIVATE_MARKER"
    with patch("syntara.eventstreams.core.serialization.json.loads", side_effect=error_type(private_marker)):
        result = decoder.decode(event)

    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.invalid_json
    assert private_marker not in result.message
    assert private_marker not in repr(result)
    assert isinstance(decoder.decode(event), EventDecodeSuccess)


@pytest.mark.parametrize(
    ("value", "unique"),
    [
        (b"[]", True),
        (b'[1,"1",true,false,null,{},[]]', True),
        (b"[1,1.0]", False),
        (b"[-0.0,0]", False),
        (b"[true,1]", True),
        (b"[false,0]", True),
        (b"[true,true]", False),
        (b"[null,null]", False),
        (b'["a","\\u0061"]', False),
        (b"[{},{}]", False),
        (b'[{"a":1,"b":[true]},{"b":[true],"a":1.0}]', False),
        (b"[[1,true],[1.0,true]]", False),
        (b"[[1,true],[true,1]]", True),
        (b"[[true],[1]]", True),
        (b'[{"x":[false]},{"x":[0]}]', True),
        (b"[9007199254740993,9007199254740992.0]", True),
        (b"[9007199254740992,9007199254740992.0]", False),
        (b"[0.1,0.10000000000000001]", False),
        (b"[5e-324,4.9406564584124654e-324]", False),
        (b'["number",["number","1","1"],1]', True),
        (b"[" + b"9" * 400 + b"," + b"9" * 400 + b"]", False),
    ],
)
def test_unique_items_preserves_json_equality(value: bytes, *, unique: bool) -> None:
    """Canonical sorting preserves Draft-07 numeric and structural equality."""
    event = _event(value)
    before = event.model_copy(deep=True)
    result = JsonEventDecoder().decode(event, schema={"uniqueItems": True})
    if unique:
        assert isinstance(result, EventDecodeSuccess)
        assert result.envelope.payload == json.loads(value)
    else:
        assert isinstance(result, EventDecodeFailure)
        assert result.code == EventFailureCode.schema_mismatch
    assert event == before


@pytest.mark.parametrize("value", [b"null", b"1", b'"text"', b"{}"])
def test_unique_items_ignores_non_arrays(value: bytes) -> None:
    """The keyword only constrains arrays, matching Draft-07 behavior."""
    assert isinstance(JsonEventDecoder().decode(_event(value), schema={"uniqueItems": True}), EventDecodeSuccess)


def test_unique_items_false_permits_duplicates() -> None:
    """An explicitly disabled uniqueness constraint does not reject duplicates."""
    assert isinstance(JsonEventDecoder().decode(_event(b"[1,1]"), schema={"uniqueItems": False}), EventDecodeSuccess)


def test_unique_items_applies_inside_nested_schemas() -> None:
    """Nested arrays also use the event validator's uniqueness rule."""
    schema = {"properties": {"values": {"uniqueItems": True}}}
    result = JsonEventDecoder().decode(_event(b'{"values":[{"x":1},{"x":1.0}]}'), schema=schema)
    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.schema_mismatch


@pytest.mark.parametrize("duplicate", [False, True])
def test_large_mixed_unique_items_finishes_within_deadline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, duplicate: bool
) -> None:
    """A subprocess deadline contains regressions to quadratic pairwise checks."""
    script = """
import json
import sys
from datetime import UTC, datetime
from uuid import UUID

from syntara.eventstreams.adapters.kafka_metadata import KafkaSourceMetadata
from syntara.eventstreams.core.envelope import RawEvent
from syntara.eventstreams.core.results import EventDecodeFailure, EventFailureCode
from syntara.eventstreams.core.serialization import EventDecodeSuccess, JsonEventDecoder

payload = [item for number in range(10000) for item in (number, str(number))]
duplicate = sys.argv[1] == "duplicate"
if duplicate:
    payload.append(0)
value = json.dumps(payload, separators=(",", ":")).encode()
assert len(value) < 256 * 1024
event = RawEvent(
    value=value,
    source_metadata=KafkaSourceMetadata(
        integration_id=UUID(int=1), subscription_id=UUID(int=2),
        source_generation=1, received_at=datetime(2026, 10, 17, tzinfo=UTC),
        topic="events", partition=0, offset="0",
    ),
)
result = JsonEventDecoder().decode(event, schema={"uniqueItems": True})
if duplicate:
    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.schema_mismatch
else:
    assert isinstance(result, EventDecodeSuccess)
"""
    backend_root = Path(__file__).resolve().parents[3]
    monkeypatch.chdir(tmp_path)
    try:
        completed = subprocess.run(  # noqa: S603 - fixed test code and interpreter, without a shell
            [sys.executable, "-c", script, "duplicate" if duplicate else "unique"],
            cwd=backend_root,
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except subprocess.TimeoutExpired as exc:
        stderr = exc.stderr or ""
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", errors="replace")
        pytest.fail(f"Uniqueness subprocess exceeded its deadline. stderr: {stderr}")
    assert completed.returncode == 0, completed.stderr


@pytest.mark.parametrize("value", [b"null", b"12", b"[1,2]", b'"str"'])
def test_optional_schema_accepts_supported_scalar_and_array_values(value: bytes) -> None:
    """An empty schema permits every root type, not just object wrappers."""
    assert isinstance(JsonEventDecoder().decode(_event(value), schema={}), EventDecodeSuccess)


def test_candidate_raw_value_boundary() -> None:
    """The candidate 256 KiB raw limit is inclusive and configurable."""
    limit = EventStreamLimits.DEFAULT_MAX_VALUE_BYTES
    decoder = JsonEventDecoder()
    assert isinstance(decoder.decode(_event(b'"' + b"x" * (limit - 2) + b'"')), EventDecodeSuccess)
    result = decoder.decode(_event(b'"' + b"x" * (limit - 1) + b'"'))
    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.value_too_large
    assert isinstance(JsonEventDecoder(max_value_bytes=3).decode(_event(b"123")), EventDecodeSuccess)
    assert isinstance(JsonEventDecoder(max_value_bytes=2).decode(_event(b"123")), EventDecodeFailure)


def test_complete_encoded_envelope_boundary() -> None:
    """Sizing includes metadata, binary key, repeated headers, and both payload copies."""
    event = _event(b'{"text":"\\u2603"}', key=b"\xff" * 18, headers=[("x", b"one"), ("x", b"two"), ("x", None)])
    result = JsonEventDecoder().decode(event)
    assert isinstance(result, EventDecodeSuccess)
    size = len(encode_envelope(result.envelope))
    assert result.encoded_envelope_bytes == size == encoded_envelope_size(result.envelope)
    assert isinstance(JsonEventDecoder(max_envelope_bytes=size).decode(event), EventDecodeSuccess)
    failure = JsonEventDecoder(max_envelope_bytes=size - 1).decode(event)
    assert isinstance(failure, EventDecodeFailure)
    assert failure.code == EventFailureCode.envelope_too_large
    assert size > len(event.value or b"")


@pytest.mark.parametrize(
    ("key", "headers"),
    [
        (b"x" * 64, []),
        (None, [("x" * 128, b"")]),
        (None, [("\u2603" * 16, b"")]),
        (None, [("", None)] * 16),
    ],
)
def test_size_precheck_runs_before_json_parsing(key: bytes | None, headers: list[tuple[str, bytes | None]]) -> None:
    """Keys, UTF-8 names, and per-header overhead can reject before decoding."""
    event = _event(b"0", key=key, headers=headers)
    with patch("syntara.eventstreams.core.serialization.json.loads", side_effect=AssertionError("Precheck missed")):
        result = JsonEventDecoder(max_envelope_bytes=64).decode(event)
    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.envelope_too_large


def test_header_count_limit_is_inclusive_and_configurable() -> None:
    """Count repeated/null headers and reject excess before parsing payloads."""
    headers: list[tuple[str, bytes | None]] = [("repeat", None)] * EventStreamLimits.DEFAULT_MAX_HEADERS
    decoder = JsonEventDecoder()
    assert isinstance(decoder.decode(_event(b"null", headers=headers)), EventDecodeSuccess)
    event = _event(b"null", headers=[*headers, ("repeat", b"")])
    with patch("syntara.eventstreams.core.serialization.json.loads", side_effect=AssertionError("Count check missed")):
        failure = decoder.decode(event)
    assert isinstance(failure, EventDecodeFailure)
    assert failure.code == EventFailureCode.too_many_headers
    assert isinstance(JsonEventDecoder(max_headers=2).decode(_event(b"0", headers=headers[:2])), EventDecodeSuccess)
    failure = JsonEventDecoder(max_headers=2).decode(_event(b"0", headers=headers[:3]))
    assert isinstance(failure, EventDecodeFailure)
    assert failure.code == EventFailureCode.too_many_headers


def test_candidate_one_mib_envelope_boundary_with_large_key() -> None:
    """Large keys count even when the value is tiny; exactly 1 MiB is permitted."""
    limit = EventStreamLimits.DEFAULT_MAX_ENVELOPE_BYTES
    metadata = _metadata()
    baseline = JsonEventDecoder().decode(_event(b"0", key=b"", metadata=metadata))
    assert isinstance(baseline, EventDecodeSuccess)
    padding = (limit - baseline.encoded_envelope_bytes) % 4
    metadata = metadata.model_copy(update={"topic": metadata.topic + "x" * padding})
    key = b"\xff" * ((limit - baseline.encoded_envelope_bytes - padding) // 4 * 3)
    event = _event(b"0", key=key, metadata=metadata)
    result = JsonEventDecoder().decode(event)
    assert isinstance(result, EventDecodeSuccess)
    assert result.encoded_envelope_bytes == limit
    failure = JsonEventDecoder().decode(_event(b"0", key=key + b"x", metadata=metadata))
    assert isinstance(failure, EventDecodeFailure)
    assert failure.code == EventFailureCode.envelope_too_large


def test_parser_capacity_failure_is_sanitized() -> None:
    """No numeric product nesting limit is claimed; parser exhaustion is safe."""
    depth = sys.getrecursionlimit() + 1
    result = JsonEventDecoder().decode(_event(b"[" * depth + b"0" + b"]" * depth))
    assert isinstance(result, EventDecodeFailure)
    assert result.code == EventFailureCode.excessive_nesting


@pytest.mark.parametrize("depth", [254, 255, 256, 10000])
def test_requested_nesting_boundaries(depth: int) -> None:
    """Exercise supported depth and library capacity failures without new tuning."""
    result = JsonEventDecoder().decode(_event(b"[" * depth + b"0" + b"]" * depth))
    if depth == 254:
        assert isinstance(result, EventDecodeSuccess)
    else:
        assert isinstance(result, EventDecodeFailure)
        assert result.code == EventFailureCode.excessive_nesting


def test_safe_failure_and_model_representations(caplog: pytest.LogCaptureFixture) -> None:
    """No payload, key, headers, schema values, or parser exception text is logged."""
    caplog.set_level(logging.DEBUG)
    private_marker = "CUSTOMER_PRIVATE_MARKER"
    decoder = JsonEventDecoder()
    events = [
        _event(private_marker.encode()),
        _event(b"{}", headers=[("content-type", private_marker.encode())]),
        _event(
            json.dumps(private_marker).encode(),
            key=private_marker.encode(),
            headers=[(private_marker, private_marker.encode())],
        ),
    ]
    for event in events:
        result = decoder.decode(event, schema={"type": "integer"})
        assert isinstance(result, EventDecodeFailure)
        assert private_marker not in result.message
        assert private_marker not in repr(result)
        assert private_marker not in repr(event)
    assert private_marker not in caplog.text
    assert not caplog.records


def test_candidate_settings_are_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    """Application settings expose candidate bounds without a transport guarantee."""
    settings = Settings()
    assert settings.event_max_value_bytes == 256 * 1024
    assert settings.event_max_envelope_bytes == 1024 * 1024
    assert settings.event_max_headers == 128
    monkeypatch.setenv("APP_EVENT_MAX_VALUE_BYTES", "3")
    monkeypatch.setenv("APP_EVENT_MAX_ENVELOPE_BYTES", "4096")
    monkeypatch.setenv("APP_EVENT_MAX_HEADERS", "2")
    settings = Settings()
    decoder = JsonEventDecoder(
        max_value_bytes=settings.event_max_value_bytes,
        max_envelope_bytes=settings.event_max_envelope_bytes,
        max_headers=settings.event_max_headers,
    )
    assert isinstance(decoder.decode(_event(b"123")), EventDecodeSuccess)
    failure = decoder.decode(_event(b"1234"))
    assert isinstance(failure, EventDecodeFailure)
    assert failure.code == EventFailureCode.value_too_large
    failure = decoder.decode(_event(b"0", headers=[("repeat", None)] * 3))
    assert isinstance(failure, EventDecodeFailure)
    assert failure.code == EventFailureCode.too_many_headers


@pytest.mark.parametrize(
    "setting",
    ["APP_EVENT_MAX_VALUE_BYTES", "APP_EVENT_MAX_ENVELOPE_BYTES", "APP_EVENT_MAX_HEADERS"],
)
@pytest.mark.parametrize("value", ["0", "-1"])
def test_candidate_settings_require_positive_values(monkeypatch: pytest.MonkeyPatch, setting: str, value: str) -> None:
    """Zero or negative values cannot silently disable candidate byte limits."""
    monkeypatch.setenv(setting, value)
    with pytest.raises(ValidationError):
        Settings()
