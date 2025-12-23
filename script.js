const GOOGLE_CLIENT_ID = "733819648330-gga9d3mohbotq38ti6k7fg4st9f71hqi.apps.googleusercontent.com"

let currentChatId = null
let allChats = []
let currentModel = "mistralai/devstral-2512:free"
let currentSystemPrompt = "fastxai"
let isSendingMessage = false
let userMemory = { preferences: {}, facts: [] }
let memoryCheckInterval = null

const btn = document.getElementById("toggleBtn")
const sidebar = document.getElementById("sidebar")
const mobileIconElement = document.getElementById("MobileIconElement")
const iconElement = document.getElementById("iconElement")
const modelSelector = document.getElementById("modelSelector")
const promptSelector = document.getElementById("promptSelector")
const messageInput = document.getElementById("messageInput")
const messagesArea = document.getElementById("messagesArea")
const chatList = document.getElementById("chatList")
const sendBtn = document.getElementById("sendBtn")
const mobileBtn = document.getElementById("toggleMobileBtn")
const mobileSidebar = document.getElementById("mobileSidebar")
const inputSection = document.getElementById("inputSection")

function initGoogleLogin() {
  if (typeof google === "undefined") {
    setTimeout(initGoogleLogin, 100)
    return
  }

  const box = document.getElementById("googleLogin")
  if (!box) return

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential
  })

  google.accounts.id.renderButton(box, {
    theme: "outline",
    size: "large"
  })
}

async function handleGoogleCredential(response) {
  const payload = JSON.parse(atob(response.credential.split(".")[1]))

  const user = {
    id: payload.sub,
    name: payload.name,
    email: payload.email,
    avatar: payload.picture
  }

  localStorage.setItem("fastx_user", JSON.stringify(user))
  applyUserUI(user)
  await loadUserMemory(user.id)
  startMemoryPolling(user.id)
  loadChats()
}

function applyUserUI(user) {
  document.getElementById("googleLogin")?.style.setProperty("display", "none")
  document.getElementById("userBox")?.style.setProperty("display", "flex")
  document.getElementById("userName").textContent = user.name
  document.getElementById("userAvatar").src = user.avatar
}

async function restoreUser() {
  const user = localStorage.getItem("fastx_user")
  if (user) {
    const userData = JSON.parse(user)
    applyUserUI(userData)
    await loadUserMemory(userData.id)
    startMemoryPolling(userData.id)
  }
}

function logout() {
  if (memoryCheckInterval) clearInterval(memoryCheckInterval)
  localStorage.removeItem("fastx_user")
  google.accounts.id.disableAutoSelect()
  location.reload()
}

async function loadUserMemory(userId) {
  try {
    const res = await fetch(`/api/memory/${userId}`)
    const data = await res.json()
    const oldMemory = JSON.stringify(userMemory)
    userMemory = data
    
    if (oldMemory !== JSON.stringify(userMemory)) {
      console.log("Memory Updated:", userMemory)
    }
  } catch (err) {
    console.error("Failed to load memory:", err)
  }
}

function startMemoryPolling(userId) {
  if (memoryCheckInterval) clearInterval(memoryCheckInterval)
  
  memoryCheckInterval = setInterval(async () => {
    await loadUserMemory(userId)
  }, 5000)
}

async function init() {
  setupEventListeners()
  await loadModels()
  await loadSystemPrompts()
  await loadChats()
}

function setupEventListeners() {
  btn?.addEventListener("click", () => {
    sidebar.classList.toggle("active")

    if (iconElement.classList.contains("fa-bars")) {
      iconElement.classList.remove("fa-bars")
      iconElement.classList.add("fa-xmark")
    } else {
      iconElement.classList.remove("fa-xmark")
      iconElement.classList.add("fa-bars")
    }
  })

  mobileBtn?.addEventListener("click", () => {
    mobileSidebar.classList.toggle("active")
    inputSection.classList.toggle("active")
    messagesArea.classList.toggle("active")

    if (mobileIconElement.classList.contains("fa-bars")) {
      mobileIconElement.classList.remove("fa-bars")
      mobileIconElement.classList.add("fa-xmark")
    } else {
      mobileIconElement.classList.remove("fa-xmark")
      mobileIconElement.classList.add("fa-bars")
    }
  })

  document.getElementById("messageForm")
    ?.addEventListener("submit", sendMessage)

  document.getElementById("newChatBtn")
    ?.addEventListener("click", async (e) => {
      e.preventDefault()
      await createNewChat()
    })

  document.querySelectorAll(".new-chat-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault()
      await createNewChat()
    })
  })
}

async function createNewChat() {
  const user = JSON.parse(localStorage.getItem("fastx_user"))

  const body = {
    model: currentModel,
    systemPrompt: currentSystemPrompt
  }

  if (user) {
    body.userId = user.id
    await loadUserMemory(user.id)
  }

  try {
    const res = await fetch("/api/conversations/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })

    if (!res.ok) throw new Error("Failed to create chat")

    const chat = await res.json()

    allChats.unshift(chat)
    currentChatId = chat._id

    renderChatList()
    renderMessages([])
    
    console.log("✅ New chat created with memory:", userMemory)
    
  } catch (err) {
    console.error("Error creating chat:", err)
    alert("Failed to create new chat")
  }
}

async function selectChat(chatId) {
  if (!chatId) return

  try {
    const res = await fetch(`/api/conversations/${chatId}`)
    if (!res.ok) return

    const chat = await res.json()

    currentChatId = chat._id
    currentModel = chat.model
    currentSystemPrompt = chat.systemPrompt

    modelSelector.value = currentModel
    promptSelector.value = currentSystemPrompt

    renderMessages(chat.messages)
    renderChatList()
    
    const user = JSON.parse(localStorage.getItem("fastx_user"))
    if (user) {
      await loadUserMemory(user.id)
      console.log("✅ Chat loaded with memory:", userMemory)
    }
    
  } catch (err) {
    console.error("Error selecting chat:", err)
  }
}

async function loadModels() {
  const res = await fetch("/api/models")
  const models = await res.json()
  modelSelector.innerHTML = ""
  models.forEach(m => {
    const o = document.createElement("option")
    o.value = m.id
    o.textContent = m.name
    modelSelector.appendChild(o)
  })
}

async function loadSystemPrompts() {
  const res = await fetch("/api/system-prompts")
  const prompts = await res.json()
  promptSelector.innerHTML = ""
  prompts.forEach(p => {
    const o = document.createElement("option")
    o.value = p.id
    o.textContent = p.name
    promptSelector.appendChild(o)
  })
}

async function loadChats() {
  const user = JSON.parse(localStorage.getItem("fastx_user"))
  if (!user) {
    allChats = []
    renderChatList()
    return
  }

  const res = await fetch(`/api/conversations?userId=${user.id}`)
  allChats = await res.json()
  renderChatList()
}

function cleanChatTitle(title) {
  if (!title) return "New Chat"

  return title
    .replace(/<[^>]*>/g, "")
    .replace(/\[(out|inst|system|assistant|user)\]/gi, "")
    .replace(/<\/?s>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}


function renderChatList() {
  const allChatLists = document.querySelectorAll(".chat-list, .mobile-chat-list")
  
  allChatLists.forEach(chatListEl => {
    chatListEl.innerHTML = ""

    if (!Array.isArray(allChats) || allChats.length === 0) {
      chatListEl.innerHTML = "<li class='empty' style='text-align: center;'>No chats yet</li>"
      return
    }

    allChats.forEach(chat => {
      const li = document.createElement("li")
      li.className = "chat-item"
      if (chat._id === currentChatId) li.classList.add("active")

      const row = document.createElement("div")
      row.className = "chat-row"

      const title = document.createElement("span")
      title.textContent = cleanChatTitle(chat.title)
      title.className = "chat-title"
      title.onclick = () => selectChat(chat._id) 

      const delBtn = document.createElement("button")
      delBtn.className = "chat-delete"
      delBtn.innerHTML = "<i class='fa fa-trash-can'></i>" 
      delBtn.title = "Delete chat"

      delBtn.onclick = async (e) => {
        e.stopPropagation()
        const ok = confirm("Delete this chat?")
        if (!ok) return
        await deleteChat(chat._id)
      }

      row.appendChild(title)
      row.appendChild(delBtn)
      li.appendChild(row)
      chatListEl.appendChild(li)
    })
  })
}

async function deleteChat(chatId) {
  if (!chatId) return

  try {
    const res = await fetch(`/api/conversations/${chatId}`, {
      method: "DELETE",
      headers: { 
        "Content-Type": "application/json"
      }
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error("Delete failed:", errorText)
      alert(`Failed to delete chat: ${res.status} ${res.statusText}`)
      return
    }

    allChats = allChats.filter(c => c._id !== chatId)

    if (currentChatId === chatId) {
      currentChatId = null
      messagesArea.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <h3>Start a Conversation</h3>
          <p>Type a message to begin</p>
        </div>
      `
    }

    renderChatList()
    
  } catch (err) {
    console.error("Error deleting chat:", err)
    alert("Failed to delete chat: " + err.message)
  }
}

async function sendMessage(e) {
  if (e) e.preventDefault()
  if (isSendingMessage) return

  const msg = messageInput.value.trim()
  if (!msg) return

  isSendingMessage = true
  sendBtn.disabled = true

  appendMessage("user", msg)
  messageInput.value = ""

  const thinkingEl = appendThinking()

  try {
    const user = JSON.parse(localStorage.getItem("fastx_user"))
    
    if (!currentChatId) {
      const body = {
        model: currentModel,
        systemPrompt: currentSystemPrompt,
        userId: user?.id || null
      }
      
      if (user) {
        await loadUserMemory(user.id)
      }
      
      const res = await fetch("/api/conversations/new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })

      const chat = await res.json()
      currentChatId = chat._id
      allChats.unshift(chat)
      renderChatList()
      
      console.log("✅ Auto-created chat with memory:", userMemory)
    }

    const res = await fetch(`/api/conversations/${currentChatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        model: currentModel
      })
    })

    if (!res.ok) throw new Error("AI error")

    const data = await res.json()

    thinkingEl.remove()

    const aiMsg = data.messages[data.messages.length - 1]
    appendMessage("assistant", aiMsg.content)

    if (data.title) {
      const chatIndex = allChats.findIndex(c => c._id === currentChatId)
      if (chatIndex !== -1) {
        allChats[chatIndex].title = data.title
        renderChatList()
      }
    }

  } catch (err) {
    console.error(err)
    thinkingEl.remove()
    appendMessage("assistant", "Error Occured.")
  }

  sendBtn.disabled = false
  isSendingMessage = false
}

function renderMessages(messages = []) {
  messagesArea.innerHTML = ""
  if (!Array.isArray(messages)) return

  if (messages.length === 0) {
    messagesArea.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="fa fa-message"></i></div>
        <h3>Start a Conversation</h3>
        <p>Type a message to begin</p>
      </div>
    `
    return
  }

  messages.forEach(m => {
    const d = document.createElement("div")
    d.className = `message ${m.role}`

    if (m.role === "assistant") {
      d.innerHTML = `
        <div class="message-bubble">
          ${formatAIMessage(m.content)}
        </div>
        <div class="message-actions-bottom">
          <button class="action-btn copy-message-btn" title="Copy message">
            <i class="fa fa-copy"></i>
          </button>
        </div>
      `
      
      const copyBtn = d.querySelector(".copy-message-btn")
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(m.content)
        const icon = copyBtn.querySelector("i")
        icon.className = "fa fa-check"
        copyBtn.style.color = "#28a745"
        setTimeout(() => {
          icon.className = "fa fa-copy"
          copyBtn.style.color = ""
        }, 2000)
      })
    } else {
      d.innerHTML = `
        <div class="message-bubble">
          ${escapeHtml(m.content)}
        </div>
      `
    }

    messagesArea.appendChild(d)
  })

  messagesArea.scrollTop = messagesArea.scrollHeight

  setTimeout(() => {
    document.querySelectorAll("pre code").forEach(block => {
      hljs.highlightElement(block)
    })
  }, 0)
}

function escapeHtml(text) {
  const d = document.createElement("div")
  d.textContent = text
  return d.innerHTML
}

document.addEventListener("DOMContentLoaded", () => {
  restoreUser()
  if (!localStorage.getItem("fastx_user")) initGoogleLogin()
  init()
})

function appendMessage(role, text) {
  const emptyState = messagesArea.querySelector('.empty-state')
  if (emptyState) {
    emptyState.remove()
  }

  const d = document.createElement("div")
  d.className = `message ${role}`

  if (role === "assistant") {
    d.innerHTML = `
      <div class="message-bubble">
        ${formatAIMessage(text)}
      </div>
      <div class="message-actions-bottom">
        <button class="action-btn copy-message-btn" title="Copy message">
          <i class="fa fa-copy"></i>
        </button>
      </div>
    `
    
    const copyBtn = d.querySelector(".copy-message-btn")
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(text)
      const icon = copyBtn.querySelector("i")
      icon.className = "fa fa-check"
      copyBtn.style.color = "#28a745"
      setTimeout(() => {
        icon.className = "fa fa-copy"
        copyBtn.style.color = ""
      }, 2000)
    })
  } else {
    d.innerHTML = `
      <div class="message-bubble">
        ${escapeHtml(text)}
      </div>
    `
  }

  messagesArea.appendChild(d)
  messagesArea.scrollTop = messagesArea.scrollHeight

  d.querySelectorAll("pre code").forEach(block => {
    hljs.highlightElement(block)
  })
}

function appendThinking() {
  const d = document.createElement("div")
  d.className = "message assistant thinking"
  d.innerHTML = `
    <div class="message-bubble">
      <span class="dot">Thinking</span>
    </div>
  `
  messagesArea.appendChild(d)
  messagesArea.scrollTop = messagesArea.scrollHeight
  return d
}

function formatAIMessage(text) {
  text = escapeHtml(text)

  text = text.replace(
    /```(\w+)?\n([\s\S]*?)```/g,
    (match, lang, code) => {
      return `
        <div class="code-box">
          <pre><code class="language-${lang || "plaintext"}">${code}</code></pre>
        </div>
      `
    }
  )

  text = text.replace(/### (.+)/g, '<h3>$1</h3>')
  text = text.replace(/## (.+)/g, '<h2>$1</h2>')
  text = text.replace(/# (.+)/g, '<h1>$1</h1>')

  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>')

  text = text.replace(/^- (.+)$/gm, '<li>$1</li>')
  text = text.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
  
  text = text.replace(/(<li>.*?<\/li>\n?)+/g, (match) => {
    const firstLi = match.match(/<li>/)
    if (firstLi) {
      const hasNumber = text.includes('1. ')
      return hasNumber ? '<ol>' + match + '</ol>' : '<ul>' + match + '</ul>'
    }
    return match
  })

  text = text.replace(/\n\n/g, '</p><p>')
  text = '<p>' + text + '</p>'

  text = text.replace(/<p><\/p>/g, '')
  text = text.replace(/<p>(<[uo]l>)/g, '$1')
  text = text.replace(/(<\/[uo]l>)<\/p>/g, '$1')
  text = text.replace(/<p>(<h[1-3]>)/g, '$1')
  text = text.replace(/(<\/h[1-3]>)<\/p>/g, '$1')
  text = text.replace(/<p>(<div)/g, '$1')
  text = text.replace(/(<\/div>)<\/p>/g, '$1')

  return text
}

document.addEventListener("click", e => {
  if (e.target.classList.contains("copy-btn")) {
    const code = e.target.previousElementSibling.innerText
    navigator.clipboard.writeText(code)
    e.target.textContent = "Copied!"
    setTimeout(() => (e.target.textContent = "Copy"), 1500)
  }
})