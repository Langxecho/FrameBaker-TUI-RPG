from __future__ import annotations

CAP_T2I = "t2i"
CAP_I2I = "i2i"
CAP_T2V = "t2v"
CAP_I2V = "i2v"
CAP_IMAGE_EVAL = "image_eval"
CAP_VIDEO_EVAL = "video_eval"
CAP_T2A = "t2a"
CAP_I2A = "i2a"
CAP_A2A = "a2a"
CAP_AUDIO_EVAL = "audio_eval"
CAP_WORKFLOW = "workflow"


def normalize_capabilities(values: object) -> tuple[str, ...]:
    cleaned = sorted({str(value).strip() for value in values if str(value).strip()})

    return tuple(cleaned)
