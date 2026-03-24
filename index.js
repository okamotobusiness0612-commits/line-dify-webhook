require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();

// ===============================
// LINE 設定
// ===============================
const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client({
  channelAccessToken: lineConfig.channelAccessToken,
});

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

  console.log("Dify req conversation_id:", conversationId);
  console.log("Dify res conversation_id:", data.conversation_id);
  console.log("Dify status:", res.status, "message:", data.message);

  if (data.conversation_id) {
    conversationStore.set(lineUserId, data.conversation_id);
  }

  if (!res.ok) {
    return `（Difyエラー）${data.message ?? "不明なエラーが発生しました"}`;
  }

  return data.answer ?? "（回答を取得できませんでした）";
}

// ===============================
// 会話リセット
// ===============================
function resetConversation(lineUserId) {
  conversationStore.delete(lineUserId);
}

// ===============================
// スタッフ通知
// ===============================
async function notifyStaff(text) {
  const to = [
    process.env.STAFF_USER_ID_1,
    process.env.STAFF_USER_ID_2,
  ].filter(Boolean);

  console.log("notifyStaff to:", to);

  if (to.length === 0) return;

  await client.multicast(to, {
    type: "text",
    text,
  });
}

// ===============================
// スタッフ用フォーマット
// ===============================
function formatReservationForStaff(text) {
  // 名前（2パターン対応）
  let name = "未取得";

  const nameMatch1 = text.match(/お名前[:：]\s*(.+)/);
  if (nameMatch1) {
    name = nameMatch1[1];
  } else {
    const nameMatch2 = text.match(/ありがとうございます、?\s*([^\s、。]+)様/);
    if (nameMatch2) {
      name = nameMatch2[1];
    }
  }

  // 他はシンプルに
  const dateMatch = text.match(/日時[:：]\s*(.+)/);
  const menuMatch = text.match(/メニュー[:：]\s*(.+)/);
  const contactMatch = text.match(/連絡先[:：]\s*(.+)/);

  const date = dateMatch ? dateMatch[1] : "未取得";
  const menu = menuMatch ? menuMatch[1] : "未取得";
  const contact = contactMatch ? contactMatch[1] : "未取得";

  return `【新規仮予約】
お名前：${name}様
日時：${date}
メニュー：${menu}
連絡先：${contact}

スタッフ確認をお願いします`;
}

// ===============================
// Webhook
// ===============================
app.post("/webhook", line.middleware(lineConfig), async (req, res) => {
  // LINEには即200返す（タイムアウト対策）
  res.sendStatus(200);

  try {
    const events = req.body.events || [];

    await Promise.all(
      events.map(async (event) => {
        if (event.type !== "message") return;
        if (event.message.type !== "text") return;

        const lineUserId = event.source?.userId;
        const text = (event.message.text || "").trim();

        if (!lineUserId) return;

        // 通知登録
        if (text === "通知登録") {
          console.log("STAFF REGISTER userId:", lineUserId);

          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "通知登録OK！この端末に仮予約が入ったら通知します📩",
          });
        }

        // 通知テスト
        if (text === "通知テスト") {
          await notifyStaff("【通知テスト】スタッフ通知OKです📩");

          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "スタッフへ通知しました！",
          });
        }

        // 会話リセット
        if (text === "リセット" || text === "reset") {
          resetConversation(lineUserId);

          return client.replyMessage(event.replyToken, {
            type: "text",
            text: "会話をリセットしました！もう一度ご用件をどうぞ😊",
          });
        }

        // 通常はDifyへ
        console.log("🔥 Dify到達:", text);

        const answer = await callDifyChat(lineUserId, text);

        console.log("✅ Dify answer:", answer);

        // 仮予約検知 → スタッフ通知
        if (answer.includes("仮予約")) {
          console.log("📩 仮予約検知 → 通知送信");

          const staffMessage = formatReservationForStaff(answer);
          await notifyStaff(staffMessage);
        }

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: answer || "すみません、うまく回答できませんでした。もう一度お願いします🙇‍♂️",
        });
      })
    );
  } catch (err) {
    console.error("Webhook error:", err);
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