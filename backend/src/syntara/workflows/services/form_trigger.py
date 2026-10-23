"""Form-trigger specific logic, kept out of the shared execution path.

Currently holds submission observability. ``record_form_trigger_submission`` is
fire-and-forget: nothing here may fail a submission.
"""

from __future__ import annotations

from time import monotonic
from typing import TYPE_CHECKING, NamedTuple

import structlog

from syntara.audit.dispatcher import AuditEventDispatcher
from syntara.metrics.types import ComponentLabel, MetricType
from syntara.workflows.audit.form_trigger import FormTriggerSubmittedEvent

if TYPE_CHECKING:
    from datetime import datetime
    from uuid import UUID

    from syntara.core.models import User
    from syntara.metrics.recorder import MetricsRecorder

logger = structlog.stdlib.get_logger(__name__)


class FormSchemaSummary(NamedTuple):
    """Field metadata from a form trigger definition, for observability only.

    ``field_count`` is the number of fields in the form definition, not the
    number of values submitted.
    """

    field_types: list[str]
    field_count: int


def record_form_trigger_submission(
    *,
    recorder: MetricsRecorder,
    user: User,
    submission_started: float,
    submitted_at: datetime,
    workflow_id: UUID,
    workflow_name: str,
    execution_id: UUID,
    trigger_node_id: str,
    form_schema: FormSchemaSummary,
) -> None:
    """Record submission latency and dispatch the metadata-only audit event.

    ``submission_started`` must be a ``time.monotonic()`` reading taken earlier
    in this same process. Never derive this latency from a persisted execution
    timestamp or Temporal history; those clocks may live on other hosts.
    """
    try:
        try:
            recorder.record(
                MetricType.FORM_TRIGGER_SUBMISSION_START,
                (monotonic() - submission_started) * 1000,
                unit="ms",
                component=ComponentLabel.EXECUTION_SERVICE,
            )
        except Exception:  # noqa: BLE001
            logger.warning("Failed to record form trigger submission start metric (non-fatal)", exc_info=True)

        AuditEventDispatcher.dispatch(
            FormTriggerSubmittedEvent(
                workflow_id=workflow_id,
                workflow_name=workflow_name,
                execution_id=execution_id,
                trigger_node_id=trigger_node_id,
                submitted_by=user.id,
                submitted_at=submitted_at,
                field_count=form_schema.field_count,
                field_types=form_schema.field_types,
                principal_type=user.__dict__.get("__principal_type__"),
            )
        )
    except Exception:  # noqa: BLE001
        logger.warning("Form trigger submission observability failed (non-fatal)", exc_info=True)
