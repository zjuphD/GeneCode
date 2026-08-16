import os
import unittest
from unittest.mock import patch

os.environ["AGENT_LLM_ENABLED"] = "0"
import server


class TestAgentConversationIntent(unittest.TestCase):
    def test_greeting_returns_natural_context_aware_reply_without_workflow(self):
        payload = {
            "message": "在吗",
            "snapshot": {
                "currentSequenceDocument": {
                    "name": "SYNPUC19V",
                    "sequence": "ATGC" * 8,
                    "circular": True,
                }
            },
        }

        with patch.object(server, "llm_analyze_agent_task") as analyze:
            response = server.agent_chat_response(payload)

        analyze.assert_not_called()
        self.assertEqual(response.get("plan"), [])
        self.assertEqual(response.get("runLog"), [])
        self.assertEqual(len(response.get("messages") or []), 1)
        self.assertIn("在的", response["messages"][0])
        self.assertIn("SYNPUC19V", response["messages"][0])
        self.assertTrue((response.get("meta") or {}).get("conversationOnly"))
        self.assertNotIn("agentRun", response.get("meta") or {})

    def test_identity_has_product_identity_without_human_claim(self):
        response = server.agent_chat_response({"message": "你是谁", "snapshot": {}})
        message = " ".join(response.get("messages") or [])
        self.assertIn("GeneCode", message)
        self.assertIn("分子设计 Agent", message)
        self.assertNotIn("人类", message)
        self.assertTrue((response.get("meta") or {}).get("conversationOnly"))

    def test_model_question_does_not_enter_cloning_workflow(self):
        payload = {"message": "你是什么模型", "snapshot": {}}
        with patch.object(server, "agent_llm_config") as config:
            config.return_value = {
                "enabled": True,
                "configured": True,
                "available": True,
                "provider": "OpenRouter",
                "model": "nvidia/nemotron-test:free",
                "message": "configured",
            }
            response = server.agent_chat_response(payload)

        message = " ".join(response.get("messages") or [])
        self.assertIn("OpenRouter", message)
        self.assertIn("nvidia/nemotron-test:free", message)
        self.assertEqual(response.get("plan"), [])
        self.assertTrue((response.get("meta") or {}).get("conversationOnly"))

    def test_restriction_site_question_reads_the_open_sequence(self):
        payload = {
            "message": "这个质粒有多少个酶切位点？",
            "snapshot": {
                "currentSequenceDocument": {
                    "name": "test-plasmid",
                    "sequence": "GAATTCTCGAG" * 8,
                    "circular": True,
                },
            },
        }

        with patch.object(server, "llm_analyze_agent_task") as analyze:
            response = server.agent_chat_response(payload)

        analyze.assert_not_called()
        self.assertEqual((response.get("meta") or {}).get("intent"), "restriction_scan")
        self.assertEqual((response.get("meta") or {}).get("workspace"), "shared")
        self.assertTrue((response.get("meta") or {}).get("conversationOnly"))
        self.assertIn("识别位点", " ".join(response.get("messages") or []))
        self.assertTrue(any(item.get("tool") == "scan_restriction_sites" for item in response.get("plan") or []))

    def test_llm_can_answer_an_open_ended_question_without_entering_workflow(self):
        payload = {
            "message": "为什么这个载体适合做表达载体？",
            "snapshot": {
                "currentSequenceDocument": {
                    "name": "expression-vector",
                    "sequence": "ATGC" * 40,
                    "circular": True,
                },
            },
        }
        with patch.object(server, "agent_llm_config", return_value={"available": True, "provider": "test", "model": "test-model"}), \
             patch.object(server, "agent_llm_json_completion", return_value={
                 "workspace": "shared",
                 "intent": "vector_explanation",
                 "action": "answer",
                 "goal": "解释当前载体是否适合表达",
                 "summary": "这是一个需要结合当前序列和注释的解释问题",
                 "messages": ["我可以先结合当前载体的启动子、抗性标记和表达相关注释说明。请确认你关注的是哺乳动物还是细菌表达。"],
                 "missing": [{"key": "host", "label": "表达宿主", "prompt": "表达宿主是什么？", "kind": "select"}],
             }):
            response = server.agent_chat_response(payload)

        self.assertTrue((response.get("meta") or {}).get("agentic"))
        self.assertTrue((response.get("meta") or {}).get("conversationOnly"))
        self.assertEqual((response.get("meta") or {}).get("decision", {}).get("action"), "answer")
        self.assertEqual(response.get("plan"), [])
        self.assertIn("启动子", " ".join(response.get("messages") or []))

    def test_unknown_model_task_is_not_forced_into_cloning(self):
        payload = {"message": "帮我把这条序列整理成一个实验记录模板", "snapshot": {}}
        with patch.object(server, "agent_llm_config", return_value={"available": True, "provider": "test", "model": "test-model"}), \
             patch.object(server, "agent_llm_json_completion", return_value={
                 "workspace": "shared",
                 "intent": "lab_record_template",
                 "action": "clarify",
                 "goal": "整理实验记录模板",
                 "summary": "当前工具注册表没有直接创建实验记录模板的工具",
                 "messages": ["可以。我需要先知道你要记录的是 PCR、克隆还是蛋白表达实验，以及希望保留哪些字段。"],
                 "missing": [{"key": "experimentType", "label": "实验类型", "prompt": "实验类型是什么？", "kind": "select"}],
             }):
            response = server.agent_chat_response(payload)

        self.assertTrue((response.get("meta") or {}).get("agentic"))
        self.assertEqual((response.get("meta") or {}).get("workspace"), "shared")
        self.assertNotEqual((response.get("meta") or {}).get("workspace"), "cloning")
        self.assertIn("PCR", " ".join(response.get("messages") or []))

    def test_llm_answer_in_summary_is_used_as_the_reply(self):
        payload = {"message": "为什么先检查阅读框？", "snapshot": {}}
        with patch.object(server, "agent_llm_config", return_value={"available": True, "provider": "test", "model": "test-model"}), \
             patch.object(server, "agent_llm_json_completion", return_value={
                 "workspace": "shared",
                 "intent": "explain_reading_frame",
                 "action": "answer",
                 "goal": "解释阅读框检查",
                 "summary": "先检查阅读框可以避免 junction 引入移码，并确保融合蛋白按预期表达。",
                 "messages": [],
                 "missing": [],
             }):
            response = server.agent_chat_response(payload)

        self.assertTrue((response.get("meta") or {}).get("agentic"))
        self.assertTrue((response.get("meta") or {}).get("conversationOnly"))
        self.assertIn("移码", " ".join(response.get("messages") or []))
        self.assertEqual(response.get("plan"), [])

    def test_answer_decision_can_use_a_freeform_second_stage(self):
        payload = {"message": "你觉得这个载体有哪些值得注意的地方？", "snapshot": {}}
        decision = {
            "workspace": "shared",
            "intent": "review_vector",
            "action": "answer",
            "goal": "审查当前载体",
            "summary": payload["message"],
            "messages": [],
            "missing": [],
        }
        with patch.object(server, "agent_llm_config", return_value={"available": True, "provider": "test", "model": "test-model"}), \
             patch.object(server, "agent_llm_json_completion", return_value=decision), \
             patch.object(server, "agent_llm_completion", return_value="我会先看启动子、选择标记、复制起点和插入区域之间是否匹配你的表达目标。") as completion:
            response = server.agent_chat_response(payload)

        completion.assert_called_once()
        self.assertTrue((response.get("meta") or {}).get("agentic"))
        self.assertEqual(response.get("plan"), [])
        self.assertIn("启动子", " ".join(response.get("messages") or []))

    def test_llm_history_keeps_both_sides_of_the_conversation(self):
        payload = {
            "message": "继续",
            "history": [
                {"role": "user", "content": "把 EGFP 放在 APOBEC3A 后面"},
                {"role": "assistant", "content": "我会先检查阅读框和终止密码子。"},
                {"role": "user", "content": "继续"},
            ],
        }

        summary = server.summarize_agent_history_for_llm(payload)

        self.assertIn("user: 把 EGFP 放在 APOBEC3A 后面", summary)
        self.assertIn("assistant: 我会先检查阅读框和终止密码子。", summary)
        self.assertNotIn("user: 继续", summary)

    def test_attachment_sequence_stays_local_while_history_keeps_it_for_tools(self):
        sequence = "ATGC" * 80
        payload = {
            "message": "继续",
            "history": [
                {
                    "role": "user",
                    "content": "附件：EGFP.gb · 320 bp",
                    "contextContent": f"请分析附件\nagent attachment sequence: {sequence}",
                },
                {"role": "assistant", "content": "我已经读取附件。"},
                {"role": "user", "content": "继续"},
            ],
        }

        llm_summary = server.summarize_agent_history_for_llm(payload)
        local_history = server.agent_history_entries(payload)

        self.assertIn("附件：EGFP.gb · 320 bp", llm_summary)
        self.assertNotIn(sequence, llm_summary)
        self.assertIn(sequence, local_history[0]["content"])

    def test_design_request_with_greeting_is_not_swallowed(self):
        message = "你好，帮我设计一对同源重组引物"
        self.assertEqual(server.agent_conversation_intent(message), "")

    def test_scientific_term_containing_greeting_characters_is_not_swallowed(self):
        self.assertEqual(server.agent_conversation_intent("检查这段序列好吗"), "")


if __name__ == "__main__":
    unittest.main()
