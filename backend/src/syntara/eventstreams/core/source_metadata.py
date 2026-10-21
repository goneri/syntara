"""Common event source context without transport-specific fields."""

from typing import ClassVar
from uuid import UUID

from pydantic import AwareDatetime, ConfigDict, Field
from sqlmodel import SQLModel


class EventSourceMetadata(SQLModel):
    """Identity and receipt context shared by supported event sources."""

    integration_id: UUID
    subscription_id: UUID
    source_generation: int = Field(ge=1, strict=True)
    received_at: AwareDatetime

    model_config: ClassVar[ConfigDict] = ConfigDict(  # type: ignore[assignment]
        extra="forbid", frozen=True, populate_by_name=True, serialize_by_alias=True
    )
