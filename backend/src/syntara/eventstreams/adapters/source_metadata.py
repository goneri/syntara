"""Select supported metadata variants without importing broker clients."""

from typing import Annotated

from pydantic import Field

from syntara.eventstreams.adapters.kafka_metadata import KafkaSourceMetadata

# This feature has one variant; later transports extend this tagged contract.
SourceMetadata = Annotated[KafkaSourceMetadata, Field(discriminator="transport")]
