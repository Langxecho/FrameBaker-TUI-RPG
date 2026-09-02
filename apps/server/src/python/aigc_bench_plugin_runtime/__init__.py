"""FrameBaker media plugin runtime core (.iap/.vap/.aap)."""

from .capabilities import normalize_capabilities
from .errors import (
    AuthenticationError,
    BackendError,
    BackendUnavailableError,
    CapabilityMismatchError,
    ConfigurationError,
    ExecutionFailedError,
    ExecutionTimeoutError,
    OutputParseError,
)

__all__ = [
    "AuthenticationError",
    "BackendError",
    "BackendUnavailableError",
    "CapabilityMismatchError",
    "ConfigurationError",
    "ExecutionFailedError",
    "ExecutionTimeoutError",
    "OutputParseError",
    "normalize_capabilities",
]
