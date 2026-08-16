import unittest

import server


class TestAgentLlmProviderCompatibility(unittest.TestCase):
    def test_mimo_disables_thinking_and_uses_completion_budget(self):
        payload = server.agent_llm_request_payload(
            {
                "provider": "MiMo",
                "model": "mimo-v2.5-pro",
                "endpoint": "https://token-plan-cn.xiaomimimo.com/v1/chat/completions",
            },
            [{"role": "user", "content": "ping"}],
            temperature=0,
            max_tokens=800,
        )

        self.assertEqual(payload["max_completion_tokens"], 800)
        self.assertEqual(payload["thinking"], {"type": "disabled"})
        self.assertNotIn("max_tokens", payload)

    def test_openai_compatible_default_keeps_max_tokens(self):
        payload = server.agent_llm_request_payload(
            {
                "provider": "OpenAI",
                "model": "gpt-test",
                "endpoint": "https://api.openai.com/v1/chat/completions",
            },
            [{"role": "user", "content": "ping"}],
            temperature=0.2,
            max_tokens=600,
        )

        self.assertEqual(payload["max_tokens"], 600)
        self.assertNotIn("max_completion_tokens", payload)
        self.assertNotIn("thinking", payload)

    def test_openrouter_uses_standard_payload_and_app_headers(self):
        config = {
            "provider": "OpenRouter",
            "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
            "endpoint": "https://openrouter.ai/api/v1/chat/completions",
            "apiKey": "secret",
        }

        payload = server.agent_llm_request_payload(
            config,
            [{"role": "user", "content": "ping"}],
            temperature=0.1,
            max_tokens=500,
        )
        headers = server.agent_llm_request_headers(config)

        self.assertEqual(payload["max_tokens"], 500)
        self.assertEqual(headers["Authorization"], "Bearer secret")
        self.assertEqual(headers["X-OpenRouter-Title"], "GeneCode")
        self.assertIn("HTTP-Referer", headers)

    def test_openrouter_top_level_error_is_preserved(self):
        message = server.extract_llm_error({
            "error": {
                "message": "Upstream error from Nvidia: ResourceExhausted",
            },
        })

        self.assertEqual(message, "Upstream error from Nvidia: ResourceExhausted")

    def test_minimax_keeps_reasoning_split(self):
        payload = server.agent_llm_request_payload(
            {
                "provider": "MiniMax",
                "model": "MiniMax-M2.7",
                "endpoint": "https://api.minimax.io/v1/chat/completions",
            },
            [{"role": "user", "content": "ping"}],
            temperature=0.1,
            max_tokens=500,
        )

        self.assertTrue(payload["reasoning_split"])
        self.assertEqual(payload["max_tokens"], 500)


if __name__ == "__main__":
    unittest.main()
