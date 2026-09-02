class BackendError(RuntimeError):
    pass


class ConfigurationError(BackendError):
    pass


class AuthenticationError(BackendError):
    pass


class CapabilityMismatchError(BackendError):
    pass


class BackendUnavailableError(BackendError):
    pass


class ExecutionTimeoutError(BackendError):
    pass


class ExecutionFailedError(BackendError):
    pass


class OutputParseError(BackendError):
    pass
