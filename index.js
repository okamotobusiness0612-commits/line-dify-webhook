require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");

const app = express();
// ===== Dify 呼び出し関数 =====


async function callDifyChat(userId, messageText) {
  const response = await fetch("https://api.dify.ai/v1/chat-messages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.DIFY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {},
      query: messageText,
      response_mode: "blocking",
      user: userId,
    }),
  });

  const data = await response.json();
  return data.answer;
}
// LINE署名検証をするため、webhook では rawBody が必要
app.post(
  "/webhook",
  line.middleware({ channelSecret: process.env.LINE_CHANNEL_SECRET }),
  (req, res) => {
    res.sendStatus(200);

    const client = new line.Client({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });

    Promise.all(
      req.body.events.map((event) => {
        if (event.type !== "message") return null;
        if (event.message.type !== "text") return null;

        return client.replyMessage(event.replyToken, {
          type: "text",
          text: `echo: ${event.message.text}`,
        });
      })
    )
      .then(() => {})
      .catch((err) => console.error("reply error:", err));
  }
);

// ルート（Render確認用）
app.get("/", (req, res) => res.send("Server is running!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));


