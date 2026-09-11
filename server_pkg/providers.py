"""providers — GeneCode agent backend module (A-MAINT-001 split from server.py)."""
from __future__ import annotations

from typing import Any
from urllib.request import Request
import json
import os
import time
from urllib.parse import urlparse

from .schemas import ApiError
from .config import AGENT_LLM_TIMEOUT, DEFAULT_AGENT_LLM_BASE_URL, _LLM_SEMAPHORE, _is_run_cancelled, certifi, persist_local_env_overrides

def set_agent_llm_model_response(payload: dict[str, Any]) -> dict[str, Any]:
    """Runtime model switch.

    Updates the in-process LLM config (model / baseUrl / provider / optional
    API key) and persists it to the local .env file. No service restart is
    needed — agent_llm_config() reads the env on every call, so the very next
    request uses the new model.
    """
    model = str(payload.get("model") or "").strip()
    base_url = str(payload.get("baseUrl") or "").strip()
    provider = str(payload.get("provider") or "").strip()

    if not model or len(model) > 160:
        raise ApiError("模型名不能为空（最长 160 字符）。")
    if provider and len(provider) > 80:
        raise ApiError("Provider 名称过长（最长 80 字符）。")
    if base_url:
        if len(base_url) > 2048 or any(char.isspace() for char in base_url):
            raise ApiError("模型端点无效。")
        parsed = urlparse(base_url)
        secure = base_url.startswith("https://") and bool(parsed.hostname)
        local = (
            (base_url.startswith("http://127.0.0.1") or base_url.startswith("http://localhost"))
            and bool(parsed.hostname)
        )
        if not secure and not local:
            raise ApiError("模型端点必须使用 HTTPS（本地端点除外）。")

    overrides: dict[str, str] = {
        "AGENT_LLM_ENABLED": "true",
        "AGENT_LLM_MODEL": model,
    }
    if base_url:
        overrides["AGENT_LLM_BASE_URL"] = base_url
    if provider:
        overrides["AGENT_LLM_PROVIDER"] = provider

    for key, value in overrides.items():
        os.environ[key] = value
    persist_local_env_overrides(overrides)

    config = agent_llm_config()
    return {"ok": True, "llm": agent_llm_public_status(config)}
def env_first(*names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""
def bool_from_value(value: Any, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        return value
    token = str(value).strip().lower()
    if token in {"1", "true", "yes", "on", "enabled"}:
        return True
    if token in {"0", "false", "no", "off", "disabled"}:
        return False
    return default
def normalized_agent_llm_endpoint(raw_url: str) -> str:
    url = (raw_url or DEFAULT_AGENT_LLM_BASE_URL).strip().rstrip("/")
    if not url:
        url = DEFAULT_AGENT_LLM_BASE_URL
    if url.endswith("/chat/completions"):
        return url
    if url.endswith("/v1"):
        return f"{url}/chat/completions"
    if "/chat/completions" in url:
        return url
    return f"{url}/v1/chat/completions"
def agent_llm_config(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    # In production, clients may opt out of LLM enhancement for a request, but
    # they cannot inject credentials, models, providers, or arbitrary endpoints.
    trust_client = os.environ.get("PRIMER_TRUST_CLIENT_LLM", "0") == "1"
    client_llm = payload.get("llm") if isinstance(payload, dict) else None
    if not isinstance(client_llm, dict):
        client_llm = {}
    llm_payload = client_llm if trust_client else {}
    if not isinstance(llm_payload, dict):
        llm_payload = {}

    env_enabled = bool_from_value(env_first("AGENT_LLM_ENABLED"), default=True)
    client_opted_out = (
        "enabled" in client_llm
        and not bool_from_value(client_llm.get("enabled"), default=True)
    )
    enabled = (
        bool_from_value(llm_payload.get("enabled"), default=env_enabled)
        if trust_client
        else env_enabled and not client_opted_out
    )
    api_key = str(
        llm_payload.get("apiKey")
        or env_first("AGENT_LLM_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY")
    ).strip()
    model = str(llm_payload.get("model") or env_first("AGENT_LLM_MODEL", "OPENAI_MODEL")).strip()
    base_url = str(
        llm_payload.get("baseUrl")
        or env_first("AGENT_LLM_BASE_URL", "OPENAI_BASE_URL")
        or DEFAULT_AGENT_LLM_BASE_URL
    ).strip()
    provider = str(llm_payload.get("provider") or env_first("AGENT_LLM_PROVIDER") or "").strip()
    endpoint = normalized_agent_llm_endpoint(base_url)
    hostname = urlparse(endpoint).hostname or ""
    provider_label = provider or ("OpenAI" if hostname == "api.openai.com" else hostname or "OpenAI-compatible")
    configured = bool(api_key and model)
    available = bool(enabled and configured)
    if available:
        message = f"已配置 {provider_label} · {model}"
    elif not enabled:
        message = "大模型增强已关闭，当前使用本地规则。"
    elif not api_key:
        message = "未配置 AGENT_LLM_API_KEY，当前回退到本地规则。"
    elif not model:
        message = "未配置 AGENT_LLM_MODEL，当前回退到本地规则。"
    else:
        message = "当前回退到本地规则。"
    return {
        "enabled": enabled,
        "configured": configured,
        "available": available,
        "provider": provider_label,
        "model": model,
        "endpoint": endpoint,
        "apiKey": api_key,
        "message": message,
    }
def agent_llm_public_status(config: dict[str, Any]) -> dict[str, Any]:
    runtime_error = str(config.get("_runtimeError") or "").strip()
    available = bool(config.get("available")) and not runtime_error
    return {
        "enabled": bool(config.get("enabled")),
        "configured": bool(config.get("configured")),
        "available": available,
        "provider": str(config.get("provider") or ""),
        "model": str(config.get("model") or ""),
        "mode": "llm" if available else "rules",
        "message": (
            f"模型请求失败，已回退本地工具：{runtime_error[:240]}"
            if runtime_error
            else str(config.get("message") or "")
        ),
    }
def mark_agent_llm_failure(config: dict[str, Any], exc: Exception) -> None:
    """Expose runtime provider failures instead of silently labeling fallback as LLM."""
    if isinstance(config, dict):
        config["_runtimeError"] = str(exc).strip() or "未知模型错误"
def test_agent_llm_connection_response() -> dict[str, Any]:
    config = agent_llm_config()
    if not config.get("available"):
        raise ApiError(str(config.get("message") or "当前没有可用的大模型配置。"))

    agent_llm_completion(
        config,
        [
            {
                "role": "system",
                "content": "You are a connectivity check. Reply with exactly: OK",
            },
            {"role": "user", "content": "ping"},
        ],
        temperature=0,
        max_tokens=128,
    )
    provider = str(config.get("provider") or "OpenAI-compatible")
    model = str(config.get("model") or "")
    return {
        "connected": True,
        "message": f"连接成功：{provider} · {model}",
        "llm": agent_llm_public_status(config),
    }
def extract_first_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    start = text.find("{")
    if start < 0:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start:index + 1]
                try:
                    parsed = json.loads(candidate)
                except json.JSONDecodeError:
                    return None
                return parsed if isinstance(parsed, dict) else None
    return None
def extract_llm_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, dict):
                    if isinstance(item.get("text"), str):
                        parts.append(item["text"])
                    elif item.get("type") == "output_text" and isinstance(item.get("text"), str):
                        parts.append(item["text"])
            if parts:
                return "\n".join(part.strip() for part in parts if part.strip()).strip()
    output_text = payload.get("output_text")
    if isinstance(output_text, str):
        return output_text.strip()
    return ""
def extract_llm_error(payload: dict[str, Any]) -> str:
    error = payload.get("error")
    if isinstance(error, str):
        return error.strip()
    if not isinstance(error, dict):
        return ""
    message = error.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()
    return ""
def agent_llm_completion(
    config: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.15,
    max_tokens: int = 600,
    run_id: str = "",
) -> str:
    if not config.get("available"):
        raise ApiError("当前没有可用的大模型配置。")

    # v2: limit concurrent LLM calls to prevent thread exhaustion
    acquired = _LLM_SEMAPHORE.acquire(timeout=5)
    if not acquired:
        raise ApiError("当前 LLM 并发已满，请稍后重试。")
    try:
        return _agent_llm_completion_inner(
            config, messages,
            temperature=temperature,
            max_tokens=max_tokens,
            run_id=run_id,
        )
    finally:
        _LLM_SEMAPHORE.release()
def is_mimo_agent_llm(config: dict[str, Any]) -> bool:
    endpoint_host = (urlparse(str(config.get("endpoint") or "")).hostname or "").lower()
    provider_name = str(config.get("provider") or "").strip().lower()
    model_name = str(config.get("model") or "").strip().lower()
    return (
        endpoint_host.endswith("xiaomimimo.com")
        or provider_name == "mimo"
        or model_name.startswith("mimo-")
    )
def is_deepseek_reasoning_llm(config: dict[str, Any]) -> bool:
    """True for DeepSeek V4 reasoning models served through the opencode-go
    gateway or the DeepSeek API (deepseek-v4-* / deepseek-reasoner). These
    models emit ``reasoning_content`` before the final answer and treat the
    completion budget as one shared pool."""
    endpoint_host = (urlparse(str(config.get("endpoint") or "")).hostname or "").lower()
    provider_name = str(config.get("provider") or "").strip().lower()
    model_name = str(config.get("model") or "").strip().lower()
    return (
        model_name.startswith("deepseek-v4")
        or model_name == "deepseek-reasoner"
        or "reasoning_content" in str(config.get("kind") or "")
        or ("opencode" in endpoint_host or "opencode" in provider_name) and "deepseek" in model_name
    )
def is_openrouter_agent_llm(config: dict[str, Any]) -> bool:
    endpoint_host = (urlparse(str(config.get("endpoint") or "")).hostname or "").lower()
    provider_name = str(config.get("provider") or "").strip().lower()
    return endpoint_host == "openrouter.ai" or provider_name == "openrouter"
def agent_llm_request_headers(config: dict[str, Any]) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": f"Bearer {config['apiKey']}",
        # Some OpenAI-compatible gateways (e.g. opencode.ai zen) sit behind a
        # Cloudflare edge that rejects the default Python-urllib user agent
        # with HTTP 403 (error code 1010). Present a conventional client UA.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    }
    if is_openrouter_agent_llm(config):
        headers.update({
            "HTTP-Referer": "https://genecode.local",
            "X-OpenRouter-Title": "GeneCode",
        })
    return headers
def agent_llm_request_payload(
    config: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    temperature: float,
    max_tokens: int,
) -> dict[str, Any]:
    endpoint_host = (urlparse(str(config.get("endpoint") or "")).hostname or "").lower()
    provider_name = str(config.get("provider") or "").lower()
    payload: dict[str, Any] = {
        "model": config["model"],
        "messages": messages,
        "temperature": temperature,
    }
    if is_mimo_agent_llm(config):
        # MiMo 2.5 enables deep thinking by default. It can consume the entire
        # completion budget before emitting the strict JSON this planner needs.
        payload["max_completion_tokens"] = max_tokens
        payload["thinking"] = {"type": "disabled"}
    elif is_deepseek_reasoning_llm(config):
        # DeepSeek V4 (opencode-go / official API) is a reasoning model: it
        # spends part of the budget on internal chain-of-thought before the
        # final answer. ``max_tokens`` caps only the visible answer and can
        # leave ``content`` empty for strict-JSON planner calls, so use the
        # combined ``max_completion_tokens`` budget instead and give the
        # thinking phase headroom by doubling the requested size.
        payload["max_completion_tokens"] = max(512, int(max_tokens * 2))
    else:
        payload["max_tokens"] = max_tokens
    if "minimax" in endpoint_host or "minimax" in provider_name:
        payload["reasoning_split"] = True
    return payload
def _agent_llm_completion_inner(
    config: dict[str, Any],
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.15,
    max_tokens: int = 600,
    run_id: str = "",
) -> str:
    body_payload = agent_llm_request_payload(
        config,
        messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    body = json.dumps(body_payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        str(config["endpoint"]),
        data=body,
        headers=agent_llm_request_headers(config),
        method="POST",
    )
    # Run the HTTP call in a forked child process. Long reasoning-model calls
    # (DeepSeek V4 via opencode-go can take 2+ minutes) occasionally crash the
    # urllib/ssl stack inside the threaded HTTP server on macOS; isolating the
    # network call in a subprocess keeps the server process alive no matter
    # what the socket layer does. The child writes the raw response to stdout.
    import subprocess  # noqa: PLC0415 — imported lazily to keep startup light
    import sys  # noqa: PLC0415

    # Security (A-SEC-002): the request body (which carries the prompt and any
    # private sequence) and the headers (which carry the Bearer API key) are
    # delivered to the child over stdin, never through argv. argv carries only
    # the fixed child script and the endpoint URL, so `ps`/EDR/crash reporters
    # cannot observe credentials or user data.
    child_script = (
        "import json,sys,ssl,urllib.request as u\n"
        "from urllib.error import HTTPError, URLError\n"
        "payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))\n"
        "body = payload['body'].encode('utf-8')\n"
        "headers = payload['headers']\n"
        "ctx = ssl.create_default_context(cafile=%r)\n"
        "req = u.Request(sys.argv[1], data=body, headers=headers, method='POST')\n"
        "try:\n"
        "    with u.urlopen(req, context=ctx, timeout=%r) as r:\n"
        "        data = r.read()\n"
        "    sys.stdout.write('\\x01' + data.decode('utf-8', 'replace'))\n"
        "except HTTPError as e:\n"
        "    sys.stdout.write('\\x02' + str(e.code) + '\\x00' + (e.read().decode('utf-8','replace') or '')[:400])\n"
        "except URLError as e:\n"
        "    sys.stdout.write('\\x03' + str(getattr(e, 'reason', e)))\n"
        "except TimeoutError:\n"
        "    sys.stdout.write('\\x04')\n"
        "except OSError as e:\n"
        "    sys.stdout.write('\\x03' + str(e))\n"
        "except Exception as e:\n"
        "    sys.stdout.write('\\x03' + type(e).__name__ + ': ' + str(e))\n"
    ) % (
        str(certifi.where()) if certifi is not None else "",
        AGENT_LLM_TIMEOUT,
    )
    env = dict(os.environ)
    env["PYTHONPATH"] = env.get("PYTHONPATH", "")
    # A-SEC-002: the key now travels via stdin, so strip every credential
    # from the child environment — the child only needs the CA path and the
    # endpoint. This keeps `/proc/<pid>/environ` and `ps -E` clean too.
    for secret_key in (
        "AGENT_LLM_API_KEY",
        "OPENROUTER_API_KEY",
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "MINIMAX_API_KEY",
    ):
        env.pop(secret_key, None)
    child_input = json.dumps(
        # The child receives the already serialized request body. Keeping this
        # as a string preserves the exact JSON bytes that were signed/sent by
        # urllib; the child script intentionally calls ``encode`` on it.
        {"body": body.decode("utf-8"), "headers": agent_llm_request_headers(config),
         "cafile": str(certifi.where()) if certifi is not None else None,
         "timeout": AGENT_LLM_TIMEOUT},
        ensure_ascii=False,
    ).encode("utf-8")
    # A-AGT-003: the model call is cancellable.  ``subprocess.run`` would block
    # the whole wait on the child with no way to stop it, so run the child with
    # Popen and poll for the run's cancellation flag while it works.  On cancel
    # the child is killed and the call aborts instead of burning quota.
    if run_id and _is_run_cancelled(run_id):
        raise ApiError("任务已被取消。")
    worker_argv = (
        [sys.executable, "--llm-http-worker", str(config["endpoint"])]
        if getattr(sys, "frozen", False)
        else [sys.executable, "-c", child_script, str(config["endpoint"])]
    )
    proc = subprocess.Popen(
        worker_argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
    )
    try:
        proc.stdin.write(child_input)  # type: ignore[union-attr]
        proc.stdin.close()  # type: ignore[union-attr]
    except (BrokenPipeError, OSError):
        pass
    deadline = time.monotonic() + AGENT_LLM_TIMEOUT + 30
    poll_interval = 0.15
    while True:
        if run_id and _is_run_cancelled(run_id):
            proc.kill()
            proc.wait()
            raise ApiError("任务已被取消。")
        if proc.poll() is not None:
            break
        if time.monotonic() > deadline:
            proc.kill()
            proc.wait()
            raise ApiError("大模型 API 响应超时，已回退到本地规则。")
        time.sleep(poll_interval)
    # The child has exited, so reading its pipes cannot block.  Read directly
    # instead of communicate() — stdin was closed above, and communicate()
    # would try to flush it (ValueError on closed file in some Pythons).
    raw_out = proc.stdout.read() if proc.stdout else b""
    proc_err = proc.stderr.read() if proc.stderr else b""
    proc.wait()

    raw_out = raw_out or b""
    if not raw_out or raw_out[0:1] not in (b"\x01", b"\x02", b"\x03", b"\x04"):
        detail = (proc_err or b"")[-200:].decode("utf-8", "replace")
        raise ApiError(f"大模型 API 调用失败：{detail or '无响应'}")
    marker = raw_out[0:1]
    payload_text = raw_out[1:].decode("utf-8", "replace")
    if marker == b"\x01":
        raw = payload_text
    elif marker == b"\x02":
        code, _, detail = payload_text.partition("\x00")
        raise ApiError(f"大模型 API 返回 {code}：{detail[:240]}")
    elif marker == b"\x03":
        raise ApiError(f"大模型 API 连接失败：{payload_text[:240]}")
    else:
        raise ApiError("大模型 API 响应超时，已回退到本地规则。")

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(f"大模型 API 返回了非法 JSON：{exc}")

    provider_error = extract_llm_error(parsed)
    if provider_error:
        raise ApiError(f"大模型 API 错误：{provider_error[:320]}")

    text = extract_llm_text(parsed)
    if not text:
        raise ApiError("大模型 API 没有返回可用文本。")
    return text
def agent_llm_json_completion(
    config: dict[str, Any],
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 500,
    run_id: str = "",
) -> dict[str, Any] | None:
    raw = agent_llm_completion(
        config,
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        run_id=run_id,
    )
    return extract_first_json_object(raw)
