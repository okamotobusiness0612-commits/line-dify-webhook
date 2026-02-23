require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");

// Node 18+ なら fetch はグローバルで使えます。
// Node 18未満の場合は node-fetch を入れて以下を有効化してください。
// const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();

// ===============================
// LINE 設定
// ===============================
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client({ channelAccessToken: lineConfig.channelAccessToken });

// ===============================
// Dify 会話ID 保存（暫定：メモリ）
// key: LINE userId, value: Dify conversation_id
// ===============================
const conversationStore = new Map();

// ===============================
// Dify 呼び出し
// ===============================
async function callDifyChat(lineUserId, messageText) {
  const conversationId = conversationStore.get(lineUserId);

  const payload = {
    inputs: {},
    query: messageText,
    response_mode: "blocking",
    user: lineUserId,
    ...(conversationId ? { conversation_id: conversationId } : {}),
  };

  const res = await fetch("https://api.dify.ai/v1/chat-messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DIFY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  // デバッグしたい時だけONにしてOK
  console.log("Dify req conversation_id:", conversationId);
  console.log("Dify res conversation_id:", data.conversation_id);
  console.log("Dify status:", res.status, "message:", data.message);

  // conversation_id を保存（会話継続の肝）
  if (data.conversation_id) {
    conversationStore.set(lineUserId, data.conversation_id);
  }

  // 失敗時の最低限のハンドリング
  if (!res.ok) {
    // Difyが返す message があればそれを出す
    return `（Difyエラー）${data.message ?? "不明なエラーが発生しました"}`;
  }

  // 返答本文
  return data.answer ?? "（回答を取得できませんでした）";
}

// ===============================
// 会話リセット（ユーザーが「リセット」と送ったら）
// ===============================
function resetConversation(lineUserId) {
  conversationStore.delete(lineUserId);
}

// ===============================
// Webhook
// ===============================
async function notifyStaff(text) {
  const to = [
    process.env.STAFF_USER_ID_1,
    process.env.STAFF_USER_ID_2,
  ].filter(Boolean);

  console.log("notifyStaff to:", to);

  if (to.length === 0) return;

  await client.multicast(to, { type: "text", text });
}
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  // LINEには即200返す（タイムアウト対策）
  res.sendStatus(200);

  try {
const events = req.body.events || [];

await Promise.all(
  events.map(async (event) => {
    // メッセージ以外は無視
    if (event.type !== "message") return;
    if (event.message.type !== "text") return;

    // ① 先に取り出す（超重要）
    const lineUserId = event.source?.userId;
    const text = (event.message.text || "").trim();

    if (!lineUserId) return;

    // ② 通知登録
    if (text === "通知登録") {
      console.log("STAFF REGISTER userId:", lineUserId);

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "通知登録OK！この端末に仮予約が入ったら通知します📩",
      });
    }

    // ③ 通知テスト
    if (text === "通知テスト") {
      await notifyStaff("【通知テスト】スタッフ通知OKです📩");

      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "スタッフへ通知しました！",
      });
    }

    // ④ ここから先は通常処理（リセット、Difyなど）を続ける
    // 例：
    // if (text === "リセット" || text === "reset") { ... }
    // const answer = await callDifyChat(lineUserId, text);
    // return client.replyMessage(event.replyToken, { type: "text", text: answer });
  })
);
  } catch (err) {
    console.error("Webhook error:", err);
    // ここでLINEへは返信できない（replyTokenの有効期限/非同期など）
  }
});

// ===============================
// Health check（Render用）
// ===============================
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on ${port}`);
});