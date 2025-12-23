console.log("server.js loaded")
const express = require("express")
const axios = require("axios")
const { OAuth2Client } = require("google-auth-library")
const multer = require("multer")
const fs = require("fs")
const { MongoClient, ObjectId } = require("mongodb")
require("dotenv").config()

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static("public"))

const GOOGLE_CLIENT_ID =
  "733819648330-gga9d3mohbotq38ti6k7fg4st9f71hqi.apps.googleusercontent.com"

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

const client = new MongoClient(process.env.MONGODB_URI)
let conversations
let userMemories

const systemPrompts = {
  fastxai:
    'You are FastxAI, a witty and irreverent AI assistant created to provide honest, entertaining, and highly capable support. Please respond in a clean, well-structured format:- Use clear paragraphs without excessive formatting- Avoid asterisks for emphasis unless necessary- Keep tone professional and concise- Use bullet points only when listing items- No emojis or excessive punctuation',
  assistant: "You are a helpful, harmless, and honest AI assistant. Please respond in a clean, well-structured format:- Use clear paragraphs without excessive formatting- Avoid asterisks for emphasis unless necessary- Keep tone professional and concise- Use bullet points only when listing items- No emojis or excessive punctuation",
  coder: "You are an expert programmer. Please respond in a clean, well-structured format:- Use clear paragraphs without excessive formatting- Avoid asterisks for emphasis unless necessary- Keep tone professional and concise- Use bullet points only when listing items- No emojis or excessive punctuation",
  creative: "You are a creative writing assistant. Please respond in a clean, well-structured format:- Use clear paragraphs without excessive formatting- Avoid asterisks for emphasis unless necessary- Keep tone professional and concise- Use bullet points only when listing items- No emojis or excessive punctuation",
  tutor: "You are a patient educator. Please respond in a clean, well-structured format:- Use clear paragraphs without excessive formatting- Avoid asterisks for emphasis unless necessary- Keep tone professional and concise- Use bullet points only when listing items- No emojis or excessive punctuation",
  analyst: "You are a data analyst expert. Please respond in a clean, well-structured format:- Use clear paragraphs without excessive formatting- Avoid asterisks for emphasis unless necessary- Keep tone professional and concise- Use bullet points only when listing items- No emojis or excessive punctuation",
  mentor: "You are a supportive life mentor. Please respond in a clean, well-structured format:- Use clear paragraphs without excessive formatting- Avoid asterisks for emphasis unless necessary- Keep tone professional and concise- Use bullet points only when listing items- No emojis or excessive punctuation"
}

const upload = multer({ dest: "uploads/" })

app.post("/api/upload-image", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image" })
  fs.unlinkSync(req.file.path)
  res.json({ success: true })
})

app.post("/api/generate-image", async (req, res) => {
  if (!req.body.prompt) {
    return res.status(400).json({ error: "Missing prompt" })
  }

  res.json({
    success: true,
    imageUrl: `https://via.placeholder.com/512?text=${encodeURIComponent(
      req.body.prompt
    )}`
  })
})

app.get("/api/system-prompts", (req, res) => {
  res.json(
    Object.keys(systemPrompts).map(k => ({
      id: k,
      name: k.toUpperCase()
    }))
  )
})

app.get("/api/models", (req, res) => {
  res.json([
    { id: "mistralai/devstral-2512:free", name: "Mistral 2512 (Free)" },
    { id: "nex-agi/deepseek-v3.1-nex-n1:free", name: "Deepseek V3 (Free)" },
    { id: "tngtech/deepseek-r1t2-chimera:free", name: "Deepseek R1T2 (Free)" },
    { id: "mistralai/mistral-7b-instruct", name: "Mistral 7B (Free)" }
  ])
})

app.use((req, res, next) => {
  if (!conversations || !userMemories) {
    return res.status(503).json({ error: "Database not ready" })
  }
  next()
})

app.get("/api/memory/:userId", async (req, res) => {
  const memory = await userMemories.findOne({ userId: req.params.userId })
  res.json(memory || { userId: req.params.userId, preferences: {}, facts: [] })
})

app.post("/api/memory/:userId", async (req, res) => {
  const { preferences, facts } = req.body
  
  await userMemories.updateOne(
    { userId: req.params.userId },
    {
      $set: {
        userId: req.params.userId,
        preferences: preferences || {},
        facts: facts || [],
        updatedAt: new Date()
      }
    },
    { upsert: true }
  )
  
  res.json({ success: true })
})

async function extractMemoryFromConversation(userId, userMessage, assistantMessage) {
  try {
    const extractionPrompt = `Analyze this conversation and extract ONLY new, important information about the user.

User said: "${userMessage}"
Assistant replied: "${assistantMessage}"

Extract ONLY if the user explicitly stated something about themselves (preferences, facts, habits, work, interests, etc.).

Respond ONLY in this JSON format (no markdown, no explanation):
{
  "newPreferences": {"key": "value"},
  "newFacts": ["fact1", "fact2"]
}

If nothing important to extract, respond:
{
  "newPreferences": {},
  "newFacts": []
}`

    const res = await axios.post(
      `${process.env.OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: "mistralai/mistral-7b-instruct",
        messages: [
          {
            role: "system",
            content: "You are a memory extraction system. Only extract explicit user information. Respond ONLY with valid JSON, no markdown."
          },
          {
            role: "user",
            content: extractionPrompt
          }
        ],
        max_tokens: 200,
        temperature: 0.3
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "FastxAI"
        }
      }
    )

    let extracted = res.data.choices[0].message.content.trim()
    extracted = extracted.replace(/```json\n?|```\n?/g, "").trim()
    
    const parsed = JSON.parse(extracted)

    if (Object.keys(parsed.newPreferences).length > 0 || parsed.newFacts.length > 0) {
      const currentMemory = await userMemories.findOne({ userId })
      
      const updatedPreferences = {
        ...(currentMemory?.preferences || {}),
        ...parsed.newPreferences
      }
      
      const existingFacts = currentMemory?.facts || []
      const uniqueNewFacts = parsed.newFacts.filter(
        fact => !existingFacts.some(existing => 
          existing.toLowerCase().includes(fact.toLowerCase()) || 
          fact.toLowerCase().includes(existing.toLowerCase())
        )
      )
      
      const updatedFacts = [...existingFacts, ...uniqueNewFacts].slice(-20)

      await userMemories.updateOne(
        { userId },
        {
          $set: {
            userId,
            preferences: updatedPreferences,
            facts: updatedFacts,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      )

      console.log(`Memory updated for ${userId}:`, { 
        newPreferences: parsed.newPreferences, 
        newFacts: uniqueNewFacts 
      })
    }

  } catch (err) {
    console.error("Memory extraction failed:", err.message)
  }
}

app.get("/api/conversations", async (req, res) => {
  const filter = req.query.userId ? { userId: req.query.userId } : {}
  const chats = await conversations
    .find(filter)
    .sort({ updatedAt: -1 })
    .toArray()

  res.json(chats)
})

app.get("/api/conversations/:id", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid ID" })
  }

  const chat = await conversations.findOne({
    _id: new ObjectId(req.params.id)
  })

  if (!chat) return res.status(404).json({ error: "Not found" })
  res.json(chat)
})

app.post("/api/conversations/new", async (req, res) => {
  const chat = {
    userId: req.body.userId || null,
    title: "New chat",
    model: req.body.model || "mistralai/devstral-2512:free",
    systemPrompt: req.body.systemPrompt || "fastxai",
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  }

  const result = await conversations.insertOne(chat)
  res.json({ ...chat, _id: result.insertedId })
})

app.delete("/api/conversations/:id", async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid ID" })
    }

    const chatId = new ObjectId(req.params.id)
    
    const result = await conversations.deleteOne({ _id: chatId })
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Chat not found" })
    }

    res.json({ success: true, message: "Chat deleted successfully" })
    
  } catch (err) {
    console.error("Delete error:", err)
    res.status(500).json({ error: "Failed to delete chat" })
  }
})

app.post("/api/conversations/:id/messages", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: "Invalid ID" })
  }

  const chatId = new ObjectId(req.params.id)
  const chat = await conversations.findOne({ _id: chatId })
  if (!chat) return res.status(404).json({ error: "Not found" })

  if (chat.messages.length >= 30) {
    return res.status(400).json({ error: "Chat limit reached" })
  }

  const userMessage = req.body.message

  chat.messages.push({
    role: "user",
    content: userMessage,
    timestamp: new Date()
  })

  try {
    let baseSystemPrompt = systemPrompts[chat.systemPrompt]
    
    let memory = null
    if (chat.userId) {
      memory = await userMemories.findOne({ userId: chat.userId })
      
      if (memory && (memory.preferences || memory.facts)) {
        let memoryContext = "\n\n[USER MEMORY - Always remember this across all conversations]"
        
        if (memory.preferences && Object.keys(memory.preferences).length > 0) {
          memoryContext += "\nPreferences: " + JSON.stringify(memory.preferences)
        }
        
        if (memory.facts && memory.facts.length > 0) {
          memoryContext += "\nFacts about user: " + memory.facts.join("; ")
        }
        
        baseSystemPrompt += memoryContext
        console.log(`💾 Memory injected for user ${chat.userId}:`, {
          preferences: memory.preferences,
          facts: memory.facts
        })
      } else {
        console.log(`⚠️ No memory found for user ${chat.userId}`)
      }
    }

    const aiRes = await axios.post(
      `${process.env.OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: req.body.model || chat.model,
        messages: [
          { role: "system", content: baseSystemPrompt },
          ...chat.messages
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "FastxAI"
        }
      }
    )

    const aiContent = aiRes.data.choices[0].message.content

    const aiMsg = {
      role: "assistant",
      content: aiContent,
      timestamp: new Date()
    }

    chat.messages.push(aiMsg)

    if (chat.userId) {
      await extractMemoryFromConversation(chat.userId, userMessage, aiContent)
    }

    let newTitle = chat.title
    if (chat.messages.length === 2 && chat.title === "New chat") {
      try {
        const titleRes = await axios.post(
          `${process.env.OPENROUTER_BASE_URL}/chat/completions`,
          {
            model: "mistralai/mistral-7b-instruct",
            messages: [
              {
                role: "system",
                content: "You are a title generator. Generate a short, concise title (max 5 words) based on the user's first message. Only respond with the title, nothing else."
              },
              {
                role: "user",
                content: chat.messages[0].content
              }
            ],
            max_tokens: 20
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "FastxAI"
            }
          }
        )

        newTitle = titleRes.data.choices[0].message.content.trim()
        newTitle = newTitle.replace(/^["']|["']$/g, "")
        
      } catch (err) {
        console.error("Title generation failed:", err.message)
        newTitle = chat.messages[0].content.slice(0, 40)
      }
    }

    await conversations.updateOne(
      { _id: chatId },
      {
        $set: {
          messages: chat.messages,
          updatedAt: new Date(),
          title: newTitle
        }
      }
    )

    res.json({ messages: chat.messages, title: newTitle })
  } catch (err) {
    console.error(err.response?.data || err.message)
    res.status(500).json({ error: "AI error" })
  }
})

async function start() {
  try {
    await client.connect()
    const db = client.db(process.env.DB_NAME || "fastxai")
    conversations = db.collection("conversations")
    userMemories = db.collection("userMemories")

    console.log("MongoDB connected")

    app.listen(PORT, () => {
      console.log(`FastxAI running at http://localhost:${PORT}`)
    })
  } catch (err) {
    console.error("MongoDB failed", err)
    process.exit(1)
  }
}

start()