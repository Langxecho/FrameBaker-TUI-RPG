"""Qwen Image 2.1 ComfyUI image API plugin.

The prompt-enhancement contract is adapted from the supplied standalone
qwen_image21_prompt_enhancer.py. Reference images and the user's prompt are
sent to the enhancer before routing to the text-to-image or edit workflow.
"""

from __future__ import annotations

import base64
import copy
import json
import math
import re
import time
from typing import Any
from urllib.parse import urlencode

import requests


MAX_REFERENCE_IMAGES = 10
OUTPUT_RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "1:2", "2:1"}

SKILL_TEXT = r'''# Image Prompt Rewriting Expert

You turn a user's image request into one long English paragraph that describes the
finished image as if you were looking at it, plus the aspect ratio it should be
rendered at. You are not talking to the user and not talking to a renderer: you are
an observer reporting what is in the frame.

Work through the eight steps below in order. Each step commits one decision; later
steps never revise an earlier one.

## Step 1 - Read the brief and split it in two

List what the user has fixed and what they have left open.

Fixed, and it must survive into your description unchanged: every string of text
they want shown, every named object, every count, every stated colour, every stated
position, and the aspect ratio if they gave one. Copy their text strings character
for character, in their own script, including punctuation and spacing.

A third thing they may give you is an instruction about the job rather than about the
picture - "use double quotes", "no hard-edged blocks", "4K, no noise", "make sure the
text is sharp". That is not content. Obey it silently where it applies and never echo
it: the description states what is in the frame, never what must be done.

Open, and you must decide it: everything they did not mention. A three-word request
and a three-hundred-word request both become a description of the same size, so a
short brief means you are inventing most of the frame, not writing less.

## Step 2 - Fix the frame

Decide the orientation from the subject, then pick the ratio.

If the user states a ratio, use it. Otherwise: `3:2` for anything horizontal and
`2:3` for anything vertical - these are the two defaults and cover most images.
Use `1:1` for a square badge, icon, album cover or single centred emblem, `16:9`
for a wide cinematic or presentation frame, `1:2` or `9:16` for a phone screen or a
tall standing banner. `3:4`, `2:1`, `21:9`, `4:3`, `9:21`, `4:5`, `3:1`, `5:4`,
`1:3` exist but only when the subject or the user really calls for them.

The ratio lives only in the `wh_ratio` field. Never write a ratio, a resolution, or
a pixel count into the description itself.

## Step 3 - Write the opening sentence

One sentence, around twenty words. Name the medium, the style, the subject, and the
background or palette; usually name the orientation too:

`The image is a <vertical / wide / square / tall> <style> <photograph / poster /
illustration / scene / portrait / infographic / close-up / graphic / page / card /
sheet / logo> of <subject>, <the background and its palette>.`

`This is a ...` or a bare `A vertical realistic photograph of ...` work equally well.
The medium noun is the one part that is never omitted.

The style word goes here - realistic, photorealistic, minimalist, flat-vector,
cinematic, watercolour, isometric, editorial, hand-drawn, 3D-rendered, retro. Name
it once here; you may echo it in the closing sentence.

## Step 4 - Inventory before you write

Before any more prose, settle two lists.

Every element that will appear, each with a place in the frame: upper-left,
across the top, on the far right, in the lower-third, in the centre, in front of,
behind, tucked into the corner. You will need eight to fourteen such positional
phrases, about ten typically, and they must reach the corners, the edges and the
centre - not cluster in the middle.

Every piece of text that will be legible in the image, in reading order.

## Step 5 - Walk the frame

Now describe it in order. Which order depends on how the frame is filled.

If the frame is divided into regions - a poster, a page, an interface, a layout, a
wide scene with several things in it - walk the regions:

1. The background and the surface it sits on comes immediately after the opening.
2. Describe the top band: headline, header bar, sky, ceiling, or top edge.
3. Move down and across the body: left side, centre, then right side.
4. Describe the bottom band: footer, foreground, ground plane, or base row.

If one subject fills the frame - a portrait, close-up, or single object - walk the
subject instead: background falloff, subject placement and pose, head and face, body
and garments or surfaces, held or touching objects, and remaining edge details.

Roughly a third of sentences should open on a positional phrase such as "On the
right side of the frame" or "Across the lower third" so the frame stays locatable.

Keep it to one paragraph. Break only when the image genuinely uses stacked regions,
then use one paragraph per region and open each paragraph with its location.

## Step 6 - Set every piece of text

Skip this step if nothing is meant to be read. Do not invent signage.

Otherwise, for every visible text string, state where it sits, what it looks like,
and exactly what it says. Put the string in straight double quotes in its original
script. Preserve Chinese, Russian, Korean, Japanese, Arabic, punctuation, and spacing.
Describe line breaks in prose rather than putting a newline inside the quoted text.
Give weight, colour, case, and relative size. If a mark is not meant to be read, call
it blurred, indistinct, or too small to read instead of inventing letters. Chart and
table labels, legends, values, axes, and cells also count as visible text.

## Step 7 - Give the lighting its own sentence

Every image explicitly accounts for the light source, direction, quality, shadows,
and highlights. Use a sentence beginning with `The lighting is ...`, or fold the
lighting into a surface sentence when it directly determines that surface.

## Step 8 - Close with the whole frame

End with exactly one sentence that steps back. Cover balance and symmetry, palette,
style, and mood. Use a form such as `The overall composition is ...`. Do not follow
it with a second summary.

## Throughout

Size: about twenty sentences and four to five hundred words, around twenty-five words
per sentence. A short brief means inventing more, not writing less.

Observe, do not instruct. Use present tense, third person, and declarative sentences.
Do not say "you", "create", "make sure", or "the AI should". Do not use quality
boosters such as "masterpiece", "8K", "highly detailed", or "award-winning".

Hedge genuinely uncertain visual details with "appears to be", "likely", "suggesting",
or a pair such as "wood or dark laminate". Be definite about user-fixed facts.

Name colours with modifiers: deep navy, muted olive, pale cream, warm terracotta,
soft dusty rose, blue-grey, off-white, charcoal, brownish-green. Use hex codes only
when the user supplied them.

Give materials, texture, and surface response, not only nouns: brushed metal, matte
plastic, glossy ceramic, coarse linen, weathered wood, frosted glass, grain, scuffs,
condensation, visible brush strokes, paper fibre.

Enumerate instead of summarising. Do not write "several items" or "various
decorations". Name each item. Write small counts as words. Describe visible portions
of partly hidden objects.

For people, describe observable build, posture, gaze, expression, hair, skin tone,
and each garment's colour and material. Use a life stage or decade rather than a
precise age. If a face is turned away or cropped, say so.

Describe objects by class rather than brand unless the user named the brand.
Photographic and design vocabulary is welcome: shallow depth of field, bokeh,
backlit, close-up, negative space, grid, drop shadow.

Keep the scene physically coherent. Shadows fall away from the light, reflections
match what is in front of a surface, scale remains consistent, and surfaces react to
objects placed on them. Impossible user requests may remain impossible, but the rest
of the scene stays coherent around them.

## Language

The description is always in English, whatever language the request uses. Only text
shown inside the image remains in its original script.

## Output format

Return one strictly valid JSON object on one line, with nothing before or after:

{"rewritten_prompt":"<the description>","wh_ratio":"<e.g. 3:2>"}
'''


T2I_WORKFLOW: dict[str, Any] = {
    "461": {"inputs": {"filename_prefix": "Qwen_image_2.1", "format": "png", "format.bit_depth": "8-bit", "format.input_color_space": "sRGB", "images": ["473", 0]}, "class_type": "SaveImageAdvanced"},
    "468": {"inputs": {"unet_name": "qwen_image_2.1_int8_convrot.safetensors", "weight_dtype": "default"}, "class_type": "UNETLoader"},
    "469": {"inputs": {"prompt": "", "negative_prompt": "", "resolution": 1024, "clip": ["470", 0]}, "class_type": "TextEncodeQwenImage21"},
    "470": {"inputs": {"clip_name": "qwen3vl_8b_int8_convrot.safetensors", "type": "qwen_image", "device": "default"}, "class_type": "CLIPLoader"},
    "471": {"inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}, "class_type": "VAELoader"},
    "472": {"inputs": {"width": 1536, "height": 1024, "batch_size": 1}, "class_type": "EmptyLatentImage"},
    "473": {"inputs": {"samples": ["474", 0], "vae": ["471", 0]}, "class_type": "VAEDecode"},
    "474": {"inputs": {"seed": 0, "steps": 40, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1, "model": ["468", 0], "positive": ["469", 0], "negative": ["469", 1], "latent_image": ["472", 0]}, "class_type": "KSampler"},
}

EDIT_WORKFLOW: dict[str, Any] = {
    "461": {"inputs": {"filename_prefix": "Qwen_image_2.1", "format": "png", "format.bit_depth": "8-bit", "format.input_color_space": "sRGB", "images": ["483", 0]}, "class_type": "SaveImageAdvanced"},
    "479": {"inputs": {"unet_name": "qwen_image_2.1_int8_convrot.safetensors", "weight_dtype": "default"}, "class_type": "UNETLoader"},
    "480": {"inputs": {"clip_name": "qwen3vl_8b_int8_convrot.safetensors", "type": "qwen_image", "device": "default"}, "class_type": "CLIPLoader"},
    "481": {"inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}, "class_type": "VAELoader"},
    "482": {"inputs": {"width": 1024, "height": 1365, "batch_size": 1}, "class_type": "EmptyLatentImage"},
    "483": {"inputs": {"samples": ["484", 0], "vae": ["481", 0]}, "class_type": "VAEDecode"},
    "484": {"inputs": {"seed": 0, "steps": 40, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": 1, "model": ["486", 0], "positive": ["487", 0], "negative": ["487", 1], "latent_image": ["485", 0]}, "class_type": "KSampler"},
    "485": {"inputs": {"switch": False, "on_false": ["487", 2], "on_true": ["482", 0]}, "class_type": "ComfySwitchNode"},
    "486": {"inputs": {"device": "auto", "dtype": "default", "model": ["479", 0]}, "class_type": "QwenImage21Cache"},
    "487": {"inputs": {"prompt": "", "negative_prompt": "", "resolution": 1024, "clip": ["480", 0], "vae": ["481", 0]}, "class_type": "TextEncodeQwenImage21"},
}


def _clean_base_url(value: str, name: str) -> str:
    result = str(value or "").strip().rstrip("/")
    if not result:
        raise RuntimeError(f"{name} is empty")
    return result


def _param(params: dict[str, Any], name: str, default: Any) -> Any:
    value = params.get(name, default)
    return default if value is None else value


def _chat_url(base_url: str) -> str:
    base = _clean_base_url(base_url, "enhancer_base_url")
    return base if base.lower().endswith("/chat/completions") else base + "/chat/completions"


def _extract_json(text: str) -> dict[str, Any] | None:
    value = str(text or "").strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
        value = re.sub(r"\s*```$", "", value)
    start, end = value.find("{"), value.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(value[start : end + 1])
    except (TypeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _assistant_content(payload: dict[str, Any]) -> str:
    try:
        content = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Prompt enhancer returned no assistant content: {payload.get('error') or 'unknown response'}") from exc
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "\n".join(str(item.get("text") or item.get("content") or "") for item in content if isinstance(item, dict)).strip()
    raise RuntimeError("Prompt enhancer returned unsupported assistant content")


def _validate_enhancer_output(raw: str, *, requested_ratio: str, transparent: bool, max_chars: int) -> dict[str, str]:
    payload = _extract_json(raw)
    if payload is None or set(payload) != {"rewritten_prompt", "wh_ratio"}:
        raise RuntimeError("Enhancer response must contain exactly rewritten_prompt and wh_ratio")
    rewritten = payload.get("rewritten_prompt")
    ratio = payload.get("wh_ratio")
    if not isinstance(rewritten, str) or not rewritten.strip():
        raise RuntimeError("Enhancer returned an empty rewritten_prompt")
    if not isinstance(ratio, str) or ratio not in OUTPUT_RATIOS:
        raise RuntimeError(f"Enhancer returned unsupported wh_ratio: {ratio!r}")
    rewritten = rewritten.strip()
    if requested_ratio != "auto" and ratio != requested_ratio:
        raise RuntimeError(f"Enhancer returned wh_ratio={ratio}; expected {requested_ratio}")
    unquoted = re.sub(r'"(?:\\.|[^"\\])*"', "", rewritten)
    if requested_ratio != "auto" and requested_ratio in unquoted:
        raise RuntimeError("Aspect ratio must appear only in wh_ratio, not in rewritten_prompt")
    if max_chars and len(rewritten) > max_chars:
        raise RuntimeError(f"Enhancer prompt has {len(rewritten)} characters; limit is {max_chars}")
    if transparent:
        required = (
            re.search(r"\bRGBA\b", rewritten, flags=re.IGNORECASE),
            re.search(r"\balpha\s+channel\b", rewritten, flags=re.IGNORECASE),
            re.search(r"\btransparent\s+background\b|\bbackground\s+(?:is|remains|must\s+be)\s+transparent\b", rewritten, flags=re.IGNORECASE),
        )
        if not all(required):
            raise RuntimeError("Transparent output must mention RGBA, alpha channel, and transparent background")
    return {"rewritten_prompt": rewritten, "wh_ratio": ratio}


def _call_enhancer(messages: list[dict[str, Any]], *, secrets: dict[str, str], params: dict[str, Any]) -> str:
    api_key = str(secrets.get("enhancer_api_key") or "").strip()
    if not api_key:
        raise RuntimeError("enhancer_api_key is not configured")
    body = {
        "model": str(params.get("enhancer_model") or "").strip(),
        "messages": messages,
        "max_tokens": int(_param(params, "enhancer_max_tokens", 8192)),
        "stream": False,
    }
    timeout = max(1, int(_param(params, "enhancer_timeout", 300)))
    attempts = max(1, int(_param(params, "enhancer_retry_count", 3)))
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.post(
                _chat_url(secrets.get("enhancer_base_url", "")),
                json=body,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json", "User-Agent": "qwen-image21-iap/1.0"},
                timeout=timeout,
            )
            if not response.ok:
                raise RuntimeError(f"Prompt enhancer HTTP {response.status_code}: {response.text[:1000]}")
            payload = response.json()
            if not isinstance(payload, dict):
                raise RuntimeError("Prompt enhancer returned a non-object response")
            return _assistant_content(payload)
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(f"Prompt enhancer request failed: {last_error}") from last_error


def _enhance_prompt_once(*, prompt: str, references: list[tuple[bytes, str, str, str]], secrets: dict[str, str], params: dict[str, Any]) -> dict[str, str]:
    ratio = str(_param(params, "aspect_ratio", "auto"))
    if ratio != "auto" and ratio not in OUTPUT_RATIOS:
        raise RuntimeError(f"Unsupported aspect_ratio: {ratio}")
    transparent = bool(params.get("transparent_alpha", False))
    max_chars = int(_param(params, "max_output_chars", 0))
    if max_chars < 0 or max_chars > 12000:
        raise RuntimeError("max_output_chars must be between 0 and 12000")
    rules = [
        "Follow the bundled Skill as the governing contract.",
        f"This is image editing with {len(references)} ordered reference image(s). Inspect every image in order." if references else "This is text-to-image with no reference images.",
        "The user selected auto. Choose an appropriate output ratio according to the Skill." if ratio == "auto" else f"The user selected wh_ratio={ratio}. Preserve it exactly in wh_ratio and do not write it in rewritten_prompt.",
        "Transparency is required. The rewritten prompt must explicitly describe RGBA, an alpha channel, and a transparent background." if transparent else "Transparency is not requested. Do not invent an alpha channel or transparent background.",
        "max_output_chars is 0, so choose a complete Skill-compliant length." if max_chars == 0 else f"Keep rewritten_prompt at or below {max_chars} characters without cutting a sentence.",
        "The user's brief follows. Fixed visible text, named objects, counts, colours, and positions are authoritative:",
        str(prompt).strip(),
        "Return only one JSON object on one line. Do not add Markdown, analysis, or a preamble.",
    ]
    user_text = "\n".join(rules)
    user_content: str | list[dict[str, Any]] = user_text
    if references:
        user_content = [{"type": "text", "text": user_text}]
        for _data, _mime, _suffix, enhancer_url in references:
            user_content.append({"type": "image_url", "image_url": {"url": enhancer_url}})
    messages = [
        {"role": "system", "content": "You are the Qwen Image 2.1 Prompt Enhancer. The attached Skill is a frozen source contract. Never echo job instructions as image content. Preserve user-fixed visible text character-for-character.\n\n" + SKILL_TEXT},
        {"role": "user", "content": user_content},
    ]
    raw = _call_enhancer(messages, secrets=secrets, params=params)
    try:
        return _validate_enhancer_output(raw, requested_ratio=ratio, transparent=transparent, max_chars=max_chars)
    except RuntimeError as first_error:
        repair = messages + [
            {"role": "assistant", "content": raw},
            {"role": "user", "content": f"Your response violated the output contract: {first_error}. Return only a corrected JSON object with exactly rewritten_prompt and wh_ratio."},
        ]
        repaired = _call_enhancer(repair, secrets=secrets, params=params)
        return _validate_enhancer_output(repaired, requested_ratio=ratio, transparent=transparent, max_chars=max_chars)


def _enhance_prompt(*, prompt: str, references: list[tuple[bytes, str, str, str]], secrets: dict[str, str], params: dict[str, Any]) -> dict[str, str]:
    per_call = max(1, int(_param(params, "enhancer_max_images_per_call", 8)))
    if len(references) <= per_call:
        return _enhance_prompt_once(
            prompt=prompt,
            references=references,
            secrets=secrets,
            params=params,
        )

    draft = _enhance_prompt_once(
        prompt=prompt,
        references=references[:per_call],
        secrets=secrets,
        params=params,
    )
    synthesis_prompt = "\n\n".join(
        (
            "Original user brief (authoritative):\n" + prompt,
            "Draft description based on the earlier ordered reference images:\n" + draft["rewritten_prompt"],
            "Inspect the additional ordered reference images attached to this request and reconcile them with the original brief and draft. Return one final description that accounts for all earlier and additional references without mentioning this two-stage process.",
        )
    )
    return _enhance_prompt_once(
        prompt=synthesis_prompt,
        references=references[per_call:],
        secrets=secrets,
        params=params,
    )


def _decode_data_url(url: str) -> tuple[bytes, str]:
    header, separator, payload = url.partition(",")
    if not separator or ";base64" not in header.lower():
        raise RuntimeError("Only base64 data URLs are supported for inline reference images")
    mime = header[5:].split(";", 1)[0].strip().lower() or "application/octet-stream"
    try:
        return base64.b64decode(payload, validate=True), mime
    except ValueError as exc:
        raise RuntimeError("Invalid base64 reference image") from exc


def _detect_image(data: bytes, declared_mime: str = "") -> tuple[str, str]:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", ".gif"
    if declared_mime.startswith("image/"):
        suffix = ".jpg" if declared_mime == "image/jpeg" else "." + declared_mime.split("/", 1)[1].split("+", 1)[0]
        return declared_mime, suffix
    raise RuntimeError("Reference input is not a supported PNG, JPEG, WebP, or GIF image")


def _load_references(urls: list[str], *, helpers: Any, params: dict[str, Any]) -> list[tuple[bytes, str, str, str]]:
    timeout = max(1, int(_param(params, "reference_download_timeout", 120)))
    max_bytes = max(1, int(_param(params, "max_reference_image_mb", 25))) * 1024 * 1024
    result: list[tuple[bytes, str, str, str]] = []
    for index, url in enumerate(urls, 1):
        value = str(url or "").strip()
        if not value:
            raise RuntimeError(f"Reference image {index} URL is empty")
        if value.startswith("data:"):
            data, declared_mime = _decode_data_url(value)
            enhancer_url = value
        else:
            data, declared_mime = helpers.download(value, timeout=timeout), ""
            enhancer_url = value
        if not data:
            raise RuntimeError(f"Reference image {index} is empty")
        if len(data) > max_bytes:
            raise RuntimeError(f"Reference image {index} exceeds the {max_bytes // (1024 * 1024)} MB limit")
        mime, suffix = _detect_image(data, declared_mime)
        # The prompt enhancer is remote and cannot read the server's local run
        # directory. Keep ordinary public URLs for compatibility, but turn a
        # server-materialized file reference into an inline image payload.
        if value.lower().startswith("file:"):
            enhancer_url = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
        result.append((data, mime, suffix, enhancer_url))
    return result


def _dimensions(ratio: str, megapixels: float, multiple: int) -> tuple[int, int]:
    left, right = ratio.split(":", 1)
    aspect = float(left) / float(right)
    pixels = max(0.1, float(megapixels)) * 1_000_000
    width = math.sqrt(pixels * aspect)
    height = width / aspect
    multiple = max(8, int(multiple))
    rounded_width = max(multiple, int(round(width / multiple)) * multiple)
    rounded_height = max(multiple, int(round(height / multiple)) * multiple)
    return rounded_width, rounded_height


def _apply_common_workflow_params(workflow: dict[str, Any], *, prompt: str, params: dict[str, Any], edit: bool) -> None:
    unet_node = workflow["479" if edit else "468"]["inputs"]
    clip_node = workflow["480" if edit else "470"]["inputs"]
    vae_node = workflow["481" if edit else "471"]["inputs"]
    text_node = workflow["487" if edit else "469"]["inputs"]
    sampler = workflow["484" if edit else "474"]["inputs"]
    latent = workflow["482" if edit else "472"]["inputs"]
    save = workflow["461"]["inputs"]

    unet_node["unet_name"] = str(params.get("unet_name") or "")
    unet_node["weight_dtype"] = str(params.get("unet_weight_dtype") or "default")
    clip_node["clip_name"] = str(params.get("clip_name") or "")
    clip_node["type"] = str(params.get("clip_type") or "qwen_image")
    clip_node["device"] = str(params.get("clip_device") or "default")
    vae_node["vae_name"] = str(params.get("vae_name") or "")
    text_node["prompt"] = prompt
    text_node["negative_prompt"] = str(params.get("negative_prompt") or "")
    text_node["resolution"] = int(_param(params, "reference_resolution", 1024))
    sampler["seed"] = int(_param(params, "seed", 0))
    sampler["steps"] = int(_param(params, "steps", 40))
    sampler["cfg"] = float(_param(params, "cfg", 1.0))
    sampler["sampler_name"] = str(params.get("sampler_name") or "euler")
    sampler["scheduler"] = str(params.get("scheduler") or "simple")
    sampler["denoise"] = float(_param(params, "denoise", 1.0))
    latent["batch_size"] = int(_param(params, "batch_size", 1))
    save["filename_prefix"] = str(params.get("filename_prefix") or "Qwen_image_2.1")


def _build_workflow(*, enhanced: dict[str, str], uploaded_names: list[str], params: dict[str, Any]) -> dict[str, Any]:
    edit = bool(uploaded_names)
    workflow = copy.deepcopy(EDIT_WORKFLOW if edit else T2I_WORKFLOW)
    _apply_common_workflow_params(workflow, prompt=enhanced["rewritten_prompt"], params=params, edit=edit)
    width, height = _dimensions(enhanced["wh_ratio"], float(_param(params, "megapixels", 2.2)), int(_param(params, "dimension_multiple", 32)))
    latent = workflow["482" if edit else "472"]["inputs"]
    latent["width"], latent["height"] = width, height
    if not edit:
        return workflow

    workflow["485"]["inputs"]["switch"] = not bool(params.get("preserve_reference_size", True))
    workflow["486"]["inputs"]["device"] = str(params.get("cache_device") or "auto")
    workflow["486"]["inputs"]["dtype"] = str(params.get("cache_dtype") or "default")
    text_inputs = workflow["487"]["inputs"]
    for index, uploaded_name in enumerate(uploaded_names, 1):
        node_id = str(500 + index - 1)
        workflow[node_id] = {"inputs": {"image": uploaded_name}, "class_type": "LoadImage"}
        text_inputs[f"images.image_{index}"] = [node_id, 0]
    return workflow


def _upload_reference(*, base_url: str, reference: tuple[bytes, str, str, str], index: int, timeout: int) -> str:
    data, mime, suffix, _enhancer_url = reference
    filename = f"qwen_image21_ref_{int(time.time() * 1000)}_{index}{suffix}"
    response = requests.post(
        base_url + "/upload/image",
        files={"image": (filename, data, mime)},
        data={"type": "input", "overwrite": "true"},
        timeout=timeout,
    )
    if not response.ok:
        raise RuntimeError(f"ComfyUI reference upload failed with HTTP {response.status_code}: {response.text[:1000]}")
    payload = response.json()
    uploaded = str(payload.get("name") or payload.get("filename") or "").strip()
    if not uploaded:
        raise RuntimeError("ComfyUI upload response did not contain a filename")
    subfolder = str(payload.get("subfolder") or "").strip().strip("/\\")
    return f"{subfolder}/{uploaded}" if subfolder else uploaded


def _reference_view_url(*, base_url: str, uploaded_name: str) -> str:
    subfolder, separator, filename = uploaded_name.rpartition("/")
    if not separator:
        filename = uploaded_name
        subfolder = ""
    return base_url + "/view?" + urlencode({"filename": filename, "subfolder": subfolder, "type": "input"})


def _submit_and_wait(*, base_url: str, workflow: dict[str, Any], params: dict[str, Any], helpers: Any) -> dict[str, Any]:
    submit_timeout = max(1, int(_param(params, "comfyui_submit_timeout", 30)))
    response = requests.post(base_url + "/prompt", json={"prompt": workflow}, timeout=submit_timeout)
    if not response.ok:
        raise RuntimeError(f"ComfyUI prompt submission failed with HTTP {response.status_code}: {response.text[:2000]}")
    payload = response.json()
    prompt_id = str(payload.get("prompt_id") or "").strip()
    if not prompt_id:
        raise RuntimeError(f"ComfyUI submission returned no prompt_id: {payload}")
    helpers.log(f"ComfyUI prompt submitted: {prompt_id}")

    timeout = max(1, int(_param(params, "comfyui_poll_timeout", 600)))
    interval = max(0.2, float(_param(params, "comfyui_poll_interval", 1.0)))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        history_response = requests.get(base_url + f"/history/{prompt_id}", timeout=min(30, submit_timeout))
        history_response.raise_for_status()
        history_payload = history_response.json() or {}
        entry = history_payload.get(prompt_id) if isinstance(history_payload, dict) else None
        if isinstance(entry, dict):
            status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
            status_text = str(status.get("status_str") or "").lower()
            if status_text in {"error", "failed"} or entry.get("error"):
                raise RuntimeError(f"ComfyUI generation failed: {entry.get('error') or status.get('messages') or status_text}")
            outputs = entry.get("outputs")
            if isinstance(outputs, dict) and outputs:
                return entry
            if status_text in {"success", "completed"} or status.get("completed"):
                raise RuntimeError("ComfyUI generation completed without outputs")
        time.sleep(interval)
    raise TimeoutError(f"ComfyUI prompt {prompt_id} timed out after {timeout} seconds")


def _result_url(base_url: str, history: dict[str, Any]) -> str:
    outputs = history.get("outputs") if isinstance(history, dict) else None
    node = outputs.get("461") if isinstance(outputs, dict) else None
    images = node.get("images") if isinstance(node, dict) else None
    if not isinstance(images, list) or not images or not isinstance(images[0], dict):
        raise RuntimeError("ComfyUI history is missing node 461 images[0]")
    image = images[0]
    query = urlencode({
        "filename": str(image.get("filename") or ""),
        "subfolder": str(image.get("subfolder") or ""),
        "type": str(image.get("type") or "output"),
    })
    return base_url + "/view?" + query


def generate(*, request: Any, secrets: dict[str, str], params: dict[str, Any], helpers: Any) -> dict[str, str]:
    prompt = str(request.prompt or "").strip()
    if not prompt:
        raise RuntimeError("prompt cannot be empty")
    image_urls = list(request.image_urls or [])
    if len(image_urls) > MAX_REFERENCE_IMAGES:
        raise RuntimeError(f"At most {MAX_REFERENCE_IMAGES} reference images are supported")

    base_url = _clean_base_url(secrets.get("comfyui_base_url", ""), "comfyui_base_url")
    references = _load_references(image_urls, helpers=helpers, params=params)
    # A local file URI is valid only inside this run. Upload it once to the
    # configured ComfyUI input area so the remote prompt enhancer receives a
    # reachable HTTP reference rather than a local path or unsupported data URL.
    upload_timeout = max(1, int(_param(params, "comfyui_submit_timeout", 30)))
    uploaded_by_index: dict[int, str] = {}
    enhancer_references = list(references)
    for index, reference in enumerate(references, 1):
        if reference[3].lower().startswith(("file:", "data:")):
            uploaded_name = _upload_reference(
                base_url=base_url,
                reference=reference,
                index=index,
                timeout=upload_timeout,
            )
            uploaded_by_index[index - 1] = uploaded_name
            enhancer_references[index - 1] = (
                reference[0],
                reference[1],
                reference[2],
                _reference_view_url(base_url=base_url, uploaded_name=uploaded_name),
            )
    helpers.log(f"Enhancing prompt for {'image edit' if references else 'text-to-image'} with {len(references)} reference image(s)")
    enhanced = _enhance_prompt(prompt=prompt, references=enhancer_references, secrets=secrets, params=params)
    helpers.log(f"Prompt enhanced; wh_ratio={enhanced['wh_ratio']}")

    uploaded_names = [
        uploaded_by_index.get(index - 1)
        or _upload_reference(base_url=base_url, reference=reference, index=index, timeout=upload_timeout)
        for index, reference in enumerate(references, 1)
    ]
    workflow = _build_workflow(enhanced=enhanced, uploaded_names=uploaded_names, params=params)
    helpers.log("Routing to the image-edit workflow" if references else "Routing to the text-to-image workflow")
    history = _submit_and_wait(base_url=base_url, workflow=workflow, params=params, helpers=helpers)
    return {"url": _result_url(base_url, history)}
