console.log("🔥 SERVER STARTED (FINAL STABLE VERSION) 🔥");

require("dotenv").config({ path: "./ENV.env" });

const express = require("express");
const cors = require("cors");
const path = require("path");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

/* ================= FRONTEND SERVING ================= */
// index.html MUST be inside ./public folder
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 5000;

/* ================= FETCH ================= */
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

/* ================= AI CONFIG ================= */
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const AI_MODEL = "mistralai/Mistral-7B-Instruct-v0.2";

console.log("HF KEY LOADED:", Boolean(HUGGINGFACE_API_KEY));

/* ================= GOOGLE SHEET CONFIG ================= */
const SPREADSHEET_ID = "1pHEvO1g8liPXg_kax2nCwjyHgKb00ZVGYWMTu1dZo3g";
const SHEET_NAME = "Sheet1";

/*
Sheet columns:
A Timestamp
B Name
C Phone
D Confidence
E Chapters difficult
F What exactly is difficult
G Main concern
H Consent
I Status
*/

/* ================= GOOGLE AUTH ================= */
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, "whatsapp-sheets-access.json"),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

/* ================= AI STEP GENERATOR ================= */
async function generateSteps({ confidence, difficulty, detail, worry }) {
  const fallback = `
Focus on NCERT examples from ${difficulty}
Practice ${detail} type questions daily
Revise formulas related to these chapters
Solve 4–5 timed questions to build confidence
`;

  if (!HUGGINGFACE_API_KEY) return fallback;

  try {
    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${AI_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inputs: `
You are a Class 10 Maths teacher.

Student details:
Confidence level: ${confidence}
Chapters difficult: ${difficulty}
Exact problem faced: ${detail}
Main concern: ${worry}

Write 3–4 VERY SPECIFIC action steps.
Each step must directly reference the student's chapters or problem.
One step per line only.
`,
          parameters: {
            max_new_tokens: 220,
            temperature: 0.7,
            top_p: 0.9,
            return_full_text: false
          }
        })
      }
    );

    const data = await response.json();

    let text = "";
    if (Array.isArray(data) && data[0]?.generated_text) {
      text = data[0].generated_text;
    } else if (data?.generated_text) {
      text = data.generated_text;
    }

    if (text && text.trim().length > 20) return text.trim();
    return fallback;
  } catch {
    return fallback;
  }
}

/* ================= MESSAGE BUILDER ================= */
async function generateFullMessage(c) {
  const stepsText = await generateSteps(c);

  const steps = stepsText
    .split("\n")
    .map(s => s.trim())
    .filter(s => s.length > 10)
    .slice(0, 4)
    .map(s => `• ${s.replace(/^[-•*]\s*/, "")}`)
    .join("\n");

  return `Hi ${c.name} 😊

From your responses in our Maths form, I noticed the following:

• Confidence level: ${c.confidence || "Not mentioned"}
• Topics you find difficult: ${c.difficulty || "Not mentioned"}

👉 What exactly is difficult for you in these chapters?
• ${c.detail || "Not mentioned"}

• Main concern: ${c.worry || "Not mentioned"}

Based on this, I suggest you follow these steps to improve 👇

${steps}

If you follow this method regularly, your understanding and exam performance will definitely improve.

📌 For clear explanations and regular practice:
▶️ YouTube – SimplifiedMinds SSLC  
https://youtube.com/@simplifiedmindssslc?si=axWslbMp1rblBsdo  

📲 WhatsApp Channel (daily updates & reminders):  
https://whatsapp.com/channel/0029Vb3QDu17YSd1brABFi1d  

Keep practicing and stay consistent 👍  
– Team SimplifiedMinds`;
}

/* ================= FETCH CONTACTS ================= */
async function getContacts(statusFilter = "PENDING") {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:I`
  });

  const rows = res.data.values || [];

  const contacts = rows
    .map((row, i) => {
      // ✅ AUTO-TREAT EMPTY STATUS AS PENDING
      const rawStatus = (row[8] || "").toString().trim();
      const normalizedStatus = rawStatus ? rawStatus.toUpperCase() : "PENDING";

      return {
        rowNumber: i + 2,
        name: row[1] || "Student",
        number: row[2] || "",
        confidence: row[3] || "",
        difficulty: row[4] || "",
        detail: row[5] || "",
        worry: row[6] || "",
        status: normalizedStatus
      };
    })
    .filter(r => {
      if (!r.number) return false;
      if (statusFilter === "ALL") return true;
      return r.status === statusFilter;
    });

  return Promise.all(
    contacts.map(async c => ({
      ...c,
      message: await generateFullMessage(c)
    }))
  );
}

/* ================= APIs ================= */
app.get("/api/contacts", async (req, res) => {
  try {
    const status = req.query.status || "PENDING";
    const contacts = await getContacts(status);
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/mark-sent", async (req, res) => {
  try {
    const { rowNumber } = req.body;
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!I${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [["SENT"]] }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ================= START SERVER ================= */
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
