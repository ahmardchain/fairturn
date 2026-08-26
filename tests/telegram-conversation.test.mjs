import assert from "node:assert/strict";
import test from "node:test";

import {
  fairTurnConversation,
  isRepliedMessageDeletionRequest,
} from "../lib/telegram-conversation.ts";

function repliedMessage(text) {
  return {
    chat: { type: "supergroup" },
    text,
    reply_to_message: { from: { id: 42 } },
  };
}

test("recognizes typo-tolerant replied-message deletion requests", () => {
  for (const text of [
    "@FairturnBot delete this",
    "@FairturnBot delete this masssage",
    "Please @FairturnBot remove that post",
    "FairTurn take down the replied message because it is a scam",
  ]) {
    assert.equal(
      isRepliedMessageDeletionRequest({ message: repliedMessage(text) }),
      true,
      text,
    );
  }
});

test("keeps explicit knowledge deletion out of reply moderation", () => {
  assert.equal(
    isRepliedMessageDeletionRequest({
      message: repliedMessage(
        "@FairturnBot delete this knowledge source from memory",
      ),
    }),
    false,
  );
});

test("normalizes invisible Telegram text before addressing FairTurn", () => {
  const conversation = fairTurnConversation({
    message: repliedMessage("@Fair\u200BTurnBot delete this"),
  });
  assert.equal(conversation.directed, true);
  assert.equal(conversation.text, "delete this");
});
