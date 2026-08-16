import os
import unittest
from unittest.mock import patch

import server


class TestAgentLlmConnection(unittest.TestCase):
    def configured(self):
        return {
            "enabled": True,
            "configured": True,
            "available": True,
            "provider": "MiniMax",
            "model": "MiniMax-M2.7",
            "message": "已配置 MiniMax · MiniMax-M2.7",
        }

    def test_untrusted_client_may_disable_but_not_replace_server_config(self):
        environment = {
            "AGENT_LLM_ENABLED": "1",
            "AGENT_LLM_API_KEY": "server-key",
            "AGENT_LLM_MODEL": "server-model",
            "AGENT_LLM_BASE_URL": "https://server.example/v1",
            "AGENT_LLM_PROVIDER": "Server Provider",
            "PRIMER_TRUST_CLIENT_LLM": "0",
        }
        payload = {
            "llm": {
                "enabled": False,
                "apiKey": "client-key",
                "model": "client-model",
                "baseUrl": "http://127.0.0.1:9999",
                "provider": "Client Provider",
            }
        }

        with patch.dict(os.environ, environment, clear=True):
            config = server.agent_llm_config(payload)

        self.assertFalse(config["enabled"])
        self.assertFalse(config["available"])
        self.assertTrue(config["configured"])
        self.assertEqual(config["apiKey"], "server-key")
        self.assertEqual(config["model"], "server-model")
        self.assertEqual(config["provider"], "Server Provider")
        self.assertEqual(
            config["endpoint"],
            "https://server.example/v1/chat/completions",
        )

    def test_untrusted_client_cannot_enable_disabled_server_config(self):
        environment = {
            "AGENT_LLM_ENABLED": "0",
            "AGENT_LLM_API_KEY": "server-key",
            "AGENT_LLM_MODEL": "server-model",
            "PRIMER_TRUST_CLIENT_LLM": "0",
        }

        with patch.dict(os.environ, environment, clear=True):
            config = server.agent_llm_config({"llm": {"enabled": True}})

        self.assertFalse(config["enabled"])
        self.assertFalse(config["available"])

    @patch.object(server, "agent_llm_completion", return_value="OK")
    @patch.object(server, "agent_llm_config")
    def test_reports_a_real_success(self, config_mock, completion_mock):
        config_mock.return_value = self.configured()

        result = server.test_agent_llm_connection_response()

        self.assertTrue(result["connected"])
        self.assertEqual(result["message"], "连接成功：MiniMax · MiniMax-M2.7")
        completion_mock.assert_called_once()
        self.assertEqual(completion_mock.call_args.kwargs["max_tokens"], 128)

    @patch.object(server, "agent_llm_config")
    def test_rejects_missing_configuration(self, config_mock):
        config_mock.return_value = {
            "enabled": True,
            "configured": False,
            "available": False,
            "message": "未配置 API key",
        }

        with self.assertRaisesRegex(server.ApiError, "未配置 API key"):
            server.test_agent_llm_connection_response()

    @patch.object(server, "agent_llm_completion")
    @patch.object(server, "agent_llm_config")
    def test_surfaces_provider_errors(self, config_mock, completion_mock):
        config_mock.return_value = self.configured()
        completion_mock.side_effect = server.ApiError("大模型 API 返回 429：额度不足")

        with self.assertRaisesRegex(server.ApiError, "429"):
            server.test_agent_llm_connection_response()


class TestAgentModelSwitch(unittest.TestCase):
    def test_switches_model_and_returns_new_status(self):
        environment = {
            "AGENT_LLM_ENABLED": "1",
            "AGENT_LLM_API_KEY": "server-key",
            "AGENT_LLM_MODEL": "old-model",
            "AGENT_LLM_BASE_URL": "https://old.example/v1",
            "AGENT_LLM_PROVIDER": "Old Provider",
            "PRIMER_TRUST_CLIENT_LLM": "0",
        }

        with patch.dict(os.environ, environment, clear=True):
            with patch.object(
                server, "persist_local_env_overrides"
            ) as persist_mock:
                result = server.set_agent_llm_model_response(
                    {
                        "model": "deepseek-v4-pro",
                        "baseUrl": "https://opencode.ai/zen/go/v1",
                        "provider": "opencode-go",
                    }
                )

            self.assertTrue(result["ok"])
            self.assertEqual(os.environ["AGENT_LLM_MODEL"], "deepseek-v4-pro")
            self.assertEqual(os.environ["AGENT_LLM_BASE_URL"], "https://opencode.ai/zen/go/v1")
            self.assertEqual(os.environ["AGENT_LLM_PROVIDER"], "opencode-go")
            self.assertEqual(os.environ["AGENT_LLM_ENABLED"], "true")
            persist_mock.assert_called_once()
            persisted = persist_mock.call_args.args[0]
            self.assertEqual(persisted["AGENT_LLM_MODEL"], "deepseek-v4-pro")

    def test_rejects_empty_model(self):
        with self.assertRaisesRegex(server.ApiError, "模型名不能为空"):
            server.set_agent_llm_model_response({"model": "   "})

    def test_rejects_insecure_remote_endpoint(self):
        with self.assertRaisesRegex(server.ApiError, "HTTPS"):
            server.set_agent_llm_model_response(
                {"model": "x", "baseUrl": "http://example.com/v1"}
            )

    def test_accepts_local_http_endpoint(self):
        environment = {
            "AGENT_LLM_ENABLED": "1",
            "AGENT_LLM_API_KEY": "k",
            "AGENT_LLM_MODEL": "m",
            "PRIMER_TRUST_CLIENT_LLM": "0",
        }
        with patch.dict(os.environ, environment, clear=True):
            with patch.object(server, "persist_local_env_overrides"):
                result = server.set_agent_llm_model_response(
                    {"model": "m", "baseUrl": "http://127.0.0.1:11434/v1"}
                )
            self.assertTrue(result["ok"])

    def test_persist_rewrites_existing_keys_and_appends_new_ones(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            env_path = os.path.join(tmp, ".env.local")
            with open(env_path, "w", encoding="utf-8") as handle:
                handle.write(
                    "AGENT_LLM_ENABLED=true\n"
                    "AGENT_LLM_MODEL=old\n"
                    "SOME_OTHER=keep\n"
                )
            with patch.object(server, "DATA_DIR", __import__("pathlib").Path(tmp)):
                server.persist_local_env_overrides(
                    {"AGENT_LLM_MODEL": "new", "AGENT_LLM_BASE_URL": "https://x/v1"}
                )

            with open(env_path, encoding="utf-8") as handle:
                content = handle.read()
            self.assertIn("AGENT_LLM_MODEL=new", content)
            self.assertIn("AGENT_LLM_BASE_URL=https://x/v1", content)
            self.assertIn("SOME_OTHER=keep", content)
            self.assertNotIn("AGENT_LLM_MODEL=old", content)


if __name__ == "__main__":
    unittest.main()
