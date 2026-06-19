// Global localStorage quota fix - strips images before saving

import { AuthClient } from './auth-client.js';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp, Timestamp, collection, addDoc, getDocs, query, where, deleteField } from 'firebase/firestore';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

let app;
let auth;
let googleProvider;
// Firestore instance
let db = null;
let currentChatId = null;

// Firebase Config loaded from server endpoint (never in client bundle)
let firebaseConfig = {};
try {
  const configRes = await fetch('/api/config');
  firebaseConfig = await configRes.json();
} catch (err) {
  console.error('Failed to load Firebase config:', err);
}
const isFirebaseConfigured = !!firebaseConfig.apiKey;
if (isFirebaseConfigured) {
  try {
    const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    app = firebaseApp;
    auth = getAuth(firebaseApp);
    googleProvider = new GoogleAuthProvider();
    db = getFirestore(firebaseApp);
  } catch (err) {
    console.error('Firebase Init Error:', err);
  }
}

const _originalSetItem = localStorage.setItem.bind(localStorage);
localStorage.setItem = function(key, value) {
    try {
        // If value contains base64 image data, strip it before saving
        if (typeof value === 'string' && value.length > 100000) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    const sanitized = parsed.map(msg => ({
                        ...msg,
                        image: undefined,
                        styleImage: undefined,
                        imageBase64: undefined
                    }));
                    _originalSetItem(key, JSON.stringify(sanitized));
                    return;
                }
            } catch (parseErr) {
                // Not JSON, try saving as-is but smaller
            }
        }
        _originalSetItem(key, value);
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            try {
                // Last resort - save only last 5 messages text only
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    const minimal = parsed.slice(-5).map(msg => ({
                        role: msg.role,
                        message: msg.message || msg.content || ''
                    }));
                    _originalSetItem(key, JSON.stringify(minimal));
                }
            } catch (e2) {
                console.warn('localStorage save skipped - quota full:', key);
            }
        }
    }
};
import wizardImageUrl from './wizard-louis.png';

const appRoot = document.getElementById('app') || document.body;

(() => {
  'use strict';

  const ImageCache = {
    async saveImage(id, dataUrl) {
      if (!dataUrl) return null;
      try {
        const cache = await caches.open('chat-images');
        await cache.put(`/images/${id}`, new Response(dataUrl));
        console.log(`Saved image to Cache Storage: /images/${id}`);
        return `/images/${id}`;
      } catch (e) {
        console.error('Error saving image to Cache Storage:', e);
        return null;
      }
    },

    async loadImage(id) {
      if (!id) return null;
      try {
        const cache = await caches.open('chat-images');
        const response = await cache.match(`/images/${id}`);
        if (response) {
          return await response.text();
        }
      } catch (e) {
        console.error('Error loading image from Cache Storage:', e);
      }
      return null;
    }
  };

  function ensureDataUrlPrefix(str) {
    if (!str) return '';
    if (str.startsWith('data:') || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('blob:')) {
      return str;
    }
    return `data:image/png;base64,${str}`;
  }

  async function resolveMessagesImages(messages) {
    for (const msg of messages) {
      if (!msg.image && msg.imageRef) {
        const cachedData = await ImageCache.loadImage(msg.imageRef);
        if (cachedData) {
          msg.image = cachedData;
        }
      }
      if (msg.imageRefs && Array.isArray(msg.imageRefs)) {
        msg.images = [];
        for (const ref of msg.imageRefs) {
          const cachedData = await ImageCache.loadImage(ref);
          if (cachedData) {
            msg.images.push(cachedData);
          }
        }
        if (msg.images.length > 0 && !msg.image) {
          msg.image = msg.images[0];
        }
      }
    }
  }


  // ============================================================
  // FIREBASE AUTHENTICATION FLOW
  // ============================================================
  async function bootAuth() {
    console.log('[chat.js] bootAuth() started (Cache-First Optimistic).');
    const loader = document.getElementById('app-bootstrap-loader');
    const appContainer = document.getElementById('app');
    
    const token = AuthClient.getToken();
    const cachedUser = AuthClient.getUser();
    console.log('[chat.js] bootAuth() cache check. token:', token ? 'exists' : 'null', 'cachedUser:', cachedUser ? cachedUser.email : 'null');

    // Guard route: if no cached credentials, redirect to login immediately
    if (!token || !cachedUser) {
      console.log('[chat.js] bootAuth() failed cache check. Redirecting to login.');
      showLogin();
      return false;
    }

    try {
      // Optimistically initialize the UI with the cached user session
      console.log('[chat.js] bootAuth() cached session found. Initializing session optimistically.');
      await initializeUserSession(cachedUser);

      // Hide loading screen and reveal App UI smoothly
      if (loader) {
        loader.style.opacity = '0';
        loader.style.pointerEvents = 'none';
        setTimeout(() => loader.remove(), 400);
      }
      if (appContainer) {
        appContainer.style.opacity = '1';
      }

      // Perform silent background verification
      AuthClient.me().then((verifiedUser) => {
        console.log('[chat.js] Background AuthClient.me() complete. verifiedUser:', verifiedUser ? verifiedUser.email : 'null');
        if (!verifiedUser) {
          console.log('[chat.js] Background session verification failed. Clearing session and redirecting.');
          AuthClient.clearSession();
          showLogin();
        }
      }).catch((err) => {
        console.error('[chat.js] Background session verification error:', err);
      });

      return true;
    } catch (err) {
      console.error('[chat.js] bootAuth() Bootstrap error:', err);
      showRecoveryUI(err.message || 'Connection lost. Please try again.');
      return false;
    }
  }

  function showLogin() {
    window.location.replace('/login');
  }

  function showRecoveryUI(message) {
    const loader = document.getElementById('app-bootstrap-loader');
    if (loader) {
      loader.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; max-width: 400px; text-align: center; padding: 24px; margin: auto; height: 100%;">
          <div style="font-size: 48px;">⚠️</div>
          <div style="color: #ffffff; font-size: 18px; font-weight: 600;">Unable to restore session</div>
          <div style="color: #94a3b8; font-size: 14px; line-height: 1.5;">${message}</div>
          <div style="display: flex; gap: 12px; margin-top: 16px;">
            <button id="bootstrapRetryBtn" style="padding: 10px 20px; background: linear-gradient(135deg, #7c3aed, #0ea5e9); border: none; border-radius: 10px; color: white; font-weight: 600; cursor: pointer;">Retry Connection</button>
            <button id="bootstrapLogoutBtn" style="padding: 10px 20px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; color: white; font-weight: 600; cursor: pointer;">Go to Login</button>
          </div>
        </div>
      `;
      document.getElementById('bootstrapRetryBtn')?.addEventListener('click', () => {
        window.location.reload();
      });
      document.getElementById('bootstrapLogoutBtn')?.addEventListener('click', () => {
        AuthClient.logout();
      });
    } else {
      alert('Failed to connect: ' + message);
      AuthClient.logout();
    }
  }

  function showApp(user) {
    document.body.classList.remove('auth-active');
    const authRoot = document.getElementById('authRoot');
    if (authRoot) authRoot.remove();

    const app = document.querySelector('.app') || document.getElementById('app');
    if (app) app.classList.remove('app-locked');

    renderUserMenu(user);
    initializeUserSession(user);
  }

  function renderUserMenu(user) {
    let menu = document.getElementById('userMenu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'userMenu';
      menu.className = 'user-menu';
      menu.innerHTML = `
        <div class="user-menu-inner">
          <span class="user-menu-name"></span>
          <button type="button" class="user-menu-logout">Logout</button>
        </div>
      `;
      document.body.appendChild(menu);
      menu.querySelector('.user-menu-logout').addEventListener('click', () => {
        AuthClient.logout();
      });
    }
    const label = user?.name || user?.email || 'User';
    menu.querySelector('.user-menu-name').textContent = label;
  }

  function getFrontendUser() {
    const user = AuthClient.getUser();
    if (!user) {
      showLogin();
      return null;
    }
    return user;
  }

  // Hook sidebar profile avatar/name to logout
  const userChip = document.querySelector('.sidebar-footer .user-chip');
  if (userChip) {
    userChip.style.cursor = 'pointer';
    userChip.title = 'Click to logout';
    userChip.addEventListener('click', () => {
      if (window.confirm('Do you want to log out?')) {
        AuthClient.logout();
      }
    });
  }
  // Keyboard support for user chip (Accessibility)
  if (userChip) {
    userChip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (window.confirm('Do you want to log out?')) {
          AuthClient.logout();
        }
      }
    });
  }

  // Trigger login check on start
  bootAuth();

  // ============================================================
  // MEMORY SYSTEM
  // ============================================================
  const MemoryManager = {
    async getMemories(userId) {
      if (!db || !userId) return [];
      try {
        const q = query(collection(db, 'memories'), where('user_id', '==', userId));
        const snap = await getDocs(q);
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (err) {
        console.error('Error fetching memories:', err);
        return [];
      }
    },

    async saveMemory(userId, key, value, importance = 1) {
      if (!db || !userId) return;
      try {
        const q = query(
          collection(db, 'memories'), 
          where('user_id', '==', userId), 
          where('key', '==', key)
        );
        const snap = await getDocs(q);
        const now = serverTimestamp();
        if (!snap.empty) {
          const docId = snap.docs[0].id;
          await updateDoc(doc(db, 'memories', docId), {
            value,
            importance,
            updated_at: now
          });
          console.log(`Memory updated: ${key} = ${value}`);
        } else {
          const memoryId = generateUUID();
          await setDoc(doc(db, 'memories', memoryId), {
            user_id: userId,
            key,
            value,
            importance,
            created_at: now,
            updated_at: now
          });
          console.log(`Memory created: ${key} = ${value}`);
        }
      } catch (err) {
        console.error('Error saving memory:', err);
      }
    },

    async extractMemories(userId, userMessage, assistantReply) {
      if (!db || !userId || !userMessage || !assistantReply) return;
      
      const tempSessionId = 'memory-extraction-' + generateUUID();
      const prompt = `
You are an advanced memory extraction system. Analyze the following exchange between a User and an AI Assistant.
Identify any permanent, durable facts about the user (e.g. name, preferences, occupation, goals, projects, and recurring interests).
Do NOT extract temporary conversation details, greetings, or short-term requests.

Exchange:
User: "${userMessage}"
Assistant: "${assistantReply}"

If you find new or changed durable facts, output them as a raw JSON array of objects, where each object has "key", "value", and "importance" (1-10) fields.
Example output:
[
  {"key": "occupation", "value": "Content Creator", "importance": 8},
  {"key": "favorite_platform", "value": "TikTok", "importance": 5}
]
If no durable facts are found, output exactly: []
Do not write any markdown formatting, explanation, or code blocks. Return ONLY the raw JSON string.`;

      try {
        const payload = {
          message: prompt,
          sessionId: tempSessionId,
          chatId: 'memory-extraction'
        };
        
        const url = APP_CONFIG.apiMode === 'backend' ? APP_CONFIG.backendChatUrl : APP_CONFIG.n8nWebhookUrl;
        const headers = { 'Content-Type': 'application/json' };
        
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        
        if (!response.ok) return;
        const text = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = { reply: text };
        }
        if (Array.isArray(responseData) && responseData.length > 0) {
          responseData = responseData[0];
        }
        const textResponse = normalizeN8nResponse(responseData).output;
        
        const jsonStr = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        if (jsonStr === '[]' || !jsonStr) return;
        
        const facts = JSON.parse(jsonStr);
        if (Array.isArray(facts)) {
          for (const fact of facts) {
            if (fact.key && fact.value) {
              await this.saveMemory(userId, fact.key.trim(), fact.value.trim(), fact.importance || 1);
            }
          }
        }
      } catch (err) {
        console.warn('Memory extraction failed or returned no valid JSON:', err);
      }
    }
  };

  // ============================================================
  // EXPORT SYSTEM
  // ============================================================
  function getFilteredHistory(filter) {
    const history = ConversationManager.getHistory();
    if (!history || !history.length) return [];
    if (filter === 'ai') return history.filter(m => m.role !== 'user');
    if (filter === 'user') return history.filter(m => m.role === 'user');
    return history;
  }

  function historyToText(msgs) {
    return msgs.map(m => {
      const role = m.role === 'user' ? 'You' : 'Mate Louis Smart';
      return `${role}:\n${m.message || ''}`;
    }).join('\n\n---\n\n');
  }

  function exportCopy(filter) {
    const msgs = getFilteredHistory(filter);
    if (!msgs.length) return;
    const text = historyToText(msgs);
    navigator.clipboard.writeText(text).then(() => {
      showExportToast('Copied to clipboard!');
    });
  }

  function exportPDF(filter) {
    const msgs = getFilteredHistory(filter);
    if (!msgs.length) return;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toLocaleTimeString();
    const filterLabel = filter === 'ai' ? ' (AI Replies Only)' : filter === 'user' ? ' (Your Messages Only)' : '';

    let html = `<html><head><title>Louis Smart Conversation</title>
    <style>
      body { font-family: 'Segoe UI', system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
      .header { text-align: center; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #e5e7eb; }
      .header h1 { font-size: 20px; margin: 0 0 4px; color: #111; }
      .header p { font-size: 12px; color: #6b7280; margin: 0; }
      .msg { margin: 16px 0; padding: 12px 16px; border-radius: 12px; page-break-inside: avoid; }
      .msg.user { background: #f3f4f6; text-align: right; }
      .msg.ai { background: #fff; border: 1px solid #e5e7eb; }
      .role { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 4px; }
      .content { font-size: 14px; white-space: pre-wrap; }
      .footer { text-align: center; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; }
    </style></head><body>
    <div class="header">
      <h1>Mate Louis Smart — Conversation${filterLabel}</h1>
      <p>Exported on ${dateStr} at ${timeStr}</p>
    </div>`;

    msgs.forEach(msg => {
      const role = msg.role === 'user' ? 'You' : 'Mate Louis Smart';
      const cls = msg.role === 'user' ? 'user' : 'ai';
      const content = (msg.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html += `<div class="msg ${cls}"><div class="role">${role}</div><div class="content">${content}</div></div>`;
    });

    html += `<div class="footer">Generated by Mate Louis Smart</div></body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => { printWindow.print(); }, 500);
    }
  }

  function showExportToast(msg) {
    let toast = document.getElementById('exportToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'exportToast';
      toast.className = 'export-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  // ============================================================
  // REUSABLE ACTION BAR
  // ============================================================
  function createActionBar(text) {
    const actionsBar = document.createElement('div');
    actionsBar.className = 'response-actions';

    // ThumbsUp
    const thumbsUp = document.createElement('button');
    thumbsUp.className = 'response-action-btn feedback-btn';
    thumbsUp.setAttribute('aria-label', 'Helpful');
    thumbsUp.setAttribute('title', 'Helpful');
    thumbsUp.tabIndex = 0;
    thumbsUp.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88z"/></svg>';

    // ThumbsDown
    const thumbsDown = document.createElement('button');
    thumbsDown.className = 'response-action-btn feedback-btn';
    thumbsDown.setAttribute('aria-label', 'Not helpful');
    thumbsDown.setAttribute('title', 'Not helpful');
    thumbsDown.tabIndex = 0;
    thumbsDown.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88z"/></svg>';

    const handleFeedback = (vote, btn) => {
      actionsBar.querySelectorAll('.feedback-btn').forEach(b => b.disabled = true);
      btn.classList.add('voted');
    };
    thumbsUp.addEventListener('click', () => handleFeedback('up', thumbsUp));
    thumbsDown.addEventListener('click', () => handleFeedback('down', thumbsDown));

    // Copy this response
    const copyBtn = document.createElement('button');
    copyBtn.className = 'response-action-btn';
    copyBtn.setAttribute('aria-label', 'Copy');
    copyBtn.setAttribute('title', 'Copy');
    copyBtn.tabIndex = 0;
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
        copyBtn.setAttribute('title', 'Copied!');
        setTimeout(() => {
          copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
          copyBtn.setAttribute('title', 'Copy');
        }, 2000);
      });
    });

    actionsBar.appendChild(thumbsUp);
    actionsBar.appendChild(thumbsDown);
    actionsBar.appendChild(copyBtn);

    return actionsBar;
  }

  // ============================================================
  // CONTEXT ASSEMBLY PIPELINE
  // ============================================================
  const ContextAssembler = {
    async assemble(userId, chatId, currentMessageText) {
      const systemPrompt = `You are Mate Louis Smart, an elite AI copywriter, content strategist, and marketing assistant. Help the user create highly engaging content, hooks, and professional copy.

When generating tables, you MUST strictly adhere to the following rules:

TABLE GENERATION RULES:
1. NEVER use predefined templates (like Fears, Frustrations, Dreams, Desires) unless specifically asked.
2. Generate columns dynamically based on the user's request. (e.g. For social media posts, use columns like "Row", "Hook Style", "Viral Social Hook", "Content Story/Structure").
3. Make tables specific to the query. Never leak template columns.
4. Adapt column count and column headers to the requested data.

TABLE FORMATTING RULES:
5. Generate a standard markdown table including header separator rows (e.g., |---|---|).
6. Do not create unnecessary empty rows or placeholder rows.
7. Keep all related information inside the correct column; never split one idea across multiple columns.
8. If numbering is requested or useful, include a column named "Row" or "#" as the FIRST column. Otherwise, omit the row number column entirely.

EXPLANATION PLACEMENT RULES:
9. NEVER write any introductory text, filler text, or explanations before the table. Start your response directly with the table.
10. Place all explanations, summaries, instructions (e.g., "Want me to turn any of these into a powerful prompt? Just type the row number (e.g. '3') - I'll build a detailed prompt around that row's story."), recommendations, and observations AFTER the table. Do NOT ask the user to upload a photo.

ERROR HANDLING & QUALITY RULES:
11. Ensure every row has the exact same number of columns as the header row.
12. Never insert text paragraphs between table rows.`;
      
      const user = getFrontendUser();
      const userName = user?.name || user?.email?.split('@')[0] || 'User';
      const userEmail = user?.email || '';

      let memoriesStr = '';
      if (db && userId) {
        const memories = await MemoryManager.getMemories(userId);
        if (memories.length > 0) {
          // Identify core profile memories (importance >= 7, like names, job titles, primary goals)
          const coreMemories = memories.filter(m => m.importance >= 7);
          
          // Perform keyword matching for other memories
          const words = currentMessageText.toLowerCase().split(/\W+/);
          const relevantMemories = memories.filter(mem => {
            if (mem.importance >= 7) return false; // already in core
            const keyWords = mem.key.toLowerCase().split(/\W+/);
            const valWords = mem.value.toLowerCase().split(/\W+/);
            return keyWords.some(w => words.includes(w)) || valWords.some(w => words.includes(w));
          });

          // Deduplicate and combine
          const combinedMemories = [...coreMemories, ...relevantMemories].slice(0, 10);
          
          if (combinedMemories.length > 0) {
            memoriesStr = "\n[User Profile & Memories]:\n" + combinedMemories.map(m => `- ${m.key}: ${m.value}`).join('\n');
          }
        }
      }

      let prompt = `[System Instruction]\n${systemPrompt}\n`;
      prompt += `\n[Active User Information]\nName: ${userName}\nEmail: ${userEmail}\n`;
      if (memoriesStr) {
        prompt += `${memoriesStr}\n`;
      }

      // Explicitly override table formatting instructions if the user requests 'dream' or table
      const lowerText = String(currentMessageText || '').toLowerCase().trim();
      const isDreamRequest = /\bdreams?\b/i.test(lowerText) || (lowerText.includes('table') && !lowerText.includes('post') && !lowerText.includes('hook'));
      if (isDreamRequest) {
        prompt += `\n[Instruction Override] The user is requesting the 'Dream' table. You MUST output the Fears, Frustrations, Dreams, and Desires analysis strictly as a Markdown table (with columns: Row, Fears, Frustrations, Dreams, Desires). Do NOT output a bulleted list or plain text. Start your response directly with the markdown table.`;
      }

      prompt += `\nUser: ${currentMessageText}`;
      return prompt;
    }
  };

  // ============================================================
  // CONVERSATION SUMMARIZATION
  // ============================================================
  const Summarizer = {
    async summarizeChat(userId, chatId) {
      if (!db || !chatId) return;
      try {
        const q = query(
          collection(db, 'messages'), 
          where('chat_id', '==', chatId),
          where('user_id', '==', userId)
        );
        const snap = await getDocs(q);
        const msgs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        if (msgs.length < 8) return;

        msgs.sort((a, b) => {
          const tA = a.created_at?.toMillis ? a.created_at.toMillis() : (a.created_at || 0);
          const tB = b.created_at?.toMillis ? b.created_at.toMillis() : (b.created_at || 0);
          return tA - tB;
        });

        const messagesToSummarize = msgs.slice(0, -4);
        const historyText = messagesToSummarize.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

        const tempSessionId = 'summary-' + generateUUID();
        const prompt = `
You are a conversation summarizer. Provide a highly concise, bullet-point summary of the key topics discussed, user goals, and assistant responses in the following conversation history.
Do NOT include greetings or small talk. Keep it under 150 words.

Conversation History:
${historyText}

Concise Summary:`;

        const payload = {
          message: prompt,
          sessionId: tempSessionId,
          chatId: 'summary'
        };

        const url = APP_CONFIG.apiMode === 'backend' ? APP_CONFIG.backendChatUrl : APP_CONFIG.n8nWebhookUrl;
        const headers = { 'Content-Type': 'application/json' };

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (!response.ok) return;
        const text = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = { reply: text };
        }
        if (Array.isArray(responseData) && responseData.length > 0) {
          responseData = responseData[0];
        }
        const summaryText = normalizeN8nResponse(responseData).output;

        await updateDoc(doc(db, 'chats', chatId), {
          summary: summaryText.trim(),
          updatedAt: serverTimestamp()
        });
        console.log('Chat summary updated:', summaryText);
      } catch (err) {
        console.error('Error generating chat summary:', err);
      }
    }
  };

  // ============================================================
  // DATABASE SCHEMA MIGRATION
  // ============================================================
  async function migrateUserChats(userUid) {
    if (!db || !userUid) return;
    try {
      const chatsSnap = await getDocs(query(collection(db, 'chats'), where('uid', '==', userUid)));
      for (const chatDoc of chatsSnap.docs) {
        const chatData = chatDoc.data();
        if (Array.isArray(chatData.messages) && chatData.messages.length > 0) {
          console.log(`Migrating chat ${chatDoc.id}...`);
          for (const msg of chatData.messages) {
            const messageId = generateUUID();
            let msgTime = msg.timestamp;
            if (msgTime && typeof msgTime.toMillis === 'function') {
              msgTime = msgTime.toMillis();
            } else if (msgTime && typeof msgTime === 'string') {
              msgTime = Date.parse(msgTime);
            } else if (msgTime && msgTime.seconds) {
              msgTime = msgTime.seconds * 1000;
            } else {
              msgTime = Date.now();
            }
            
            await setDoc(doc(db, 'messages', messageId), {
              chat_id: chatDoc.id,
              user_id: userUid,
              role: msg.role,
              content: msg.content || msg.message || '',
              image: msg.image || null,
              imageRef: msg.imageRef || null,
              created_at: Timestamp.fromMillis(msgTime)
            });
          }
          await updateDoc(doc(db, 'chats', chatDoc.id), {
            messages: deleteField()
          });
          console.log(`Migrated chat ${chatDoc.id} successfully.`);
        }
      }
    } catch (err) {
      console.error('Migration error:', err);
    }
  }

  // ============================================================
  // CONVERSATION MANAGER - Memory-only Chat History
  // ============================================================
  const ConversationManager = {
    conversationHistory: [],
    pendingImage: null,
    pendingImageRef: null,

    /**
     * Initialize conversation manager on page load
     */
    init() {
      this.conversationHistory = [];
      this.pendingImage = null;
      console.log('ConversationManager initialized');
    },

    /**
     * Add a message directly to memory history without updating Firestore.
     * Used for loading existing conversations.
     */
    addMessageDirect(role, message, image = null, imageRef = null) {
      const messageObj = {
        role,
        message: String(message || '').trim(),
        ...(image && { image: ensureDataUrlPrefix(image) }),
        ...(imageRef && { imageRef })
      };
      this.conversationHistory.push(messageObj);
      console.log('Message added directly (no persist):', messageObj);
      return messageObj;
    },


    /**
     * Add a message to conversation history
     * @param {string} role - 'user' or 'assistant'
     * @param {string} message - Text content of the message
     * @param {string} image - Optional base64 image string
     */
    addMessage(role, message, image = null, chatId = currentChatId, addToMemory = true) {
      const messageObj = {
        role,
        message: String(message || '').trim(),
      };

      if (image) {
        if (image.startsWith('img_')) {
          messageObj.imageRef = image;
          if (ConversationManager.pendingImage && image === ConversationManager.pendingImageRef) {
            messageObj.image = ensureDataUrlPrefix(ConversationManager.pendingImage);
          }
        } else if (image.startsWith('data:')) {
          const imageId = 'img_' + generateUUID();
          messageObj.imageRef = imageId;
          messageObj.image = ensureDataUrlPrefix(image);
          ImageCache.saveImage(imageId, image);
        } else {
          messageObj.image = image;
        }
      }

      if (addToMemory) {
        this.conversationHistory.push(messageObj);
      }
      console.log('Message added to history:', messageObj);
      // Persist to Firestore if available
      if (db && chatId) {
        const messageId = generateUUID();
        const messageRef = doc(db, 'messages', messageId);
        const user = getFrontendUser();
        const userUid = user?.uid || user?.id || null;
        
        setDoc(messageRef, {
          chat_id: chatId,
          user_id: userUid,
          role: role,
          content: messageObj.message,
          image: messageObj.image && !messageObj.image.startsWith('data:') ? messageObj.image : null,
          imageRef: messageObj.imageRef || null,
          created_at: serverTimestamp()
        })
        .then(() => {
          console.log(`Firestore: saved ${role} message separately`);
          updateDoc(doc(db, 'chats', chatId), {
            updatedAt: serverTimestamp()
          });
        })
        .catch(err => console.error('Firestore message save error:', err));
      }
      return messageObj;
    },

    /**
     * Set pending image as base64 string
     * @param {string} base64String - Base64 encoded image
     */
    setPendingImage(base64String, imageRef = null) {
      this.pendingImage = base64String;
      this.pendingImageRef = imageRef;
      console.log('Pending image set:', base64String ? base64String.substring(0, 50) + '...' : null, 'Ref:', imageRef);
    },

    clearPendingImage() {
      this.pendingImage = null;
      this.pendingImageRef = null;
      console.log('Pending image cleared');
    },

    getPendingImage() {
      return this.pendingImage;
    },

    /**
     * Build payload for webhook request
     * @param {string} messageText - User's message text
     * @returns {object} Payload object
     */
    buildPayload(messageText, requestSessionId = getChatRuntimeSession()) {
      const payload = {
        message: String(messageText || '').trim(),
        sessionId: requestSessionId,
        chatId: currentSessionId
      };
      const pendingImage = this.getPendingImage();
      if (pendingImage) {
        const hasPrefix = pendingImage.startsWith('data:');
        const fullDataUrl = hasPrefix ? pendingImage : `data:image/png;base64,${pendingImage}`;
        const rawBase64 = hasPrefix ? pendingImage.split(',')[1] : pendingImage;

        payload.image = rawBase64;
        payload.imageBase64 = rawBase64;
        payload.images = [fullDataUrl];
      }
      return payload;
    },

    /**
     * Send message to webhook and handle response
     * @param {string} messageText - User's message
     * @param {string} webhookUrl - Webhook endpoint URL
     * @returns {Promise<object>} Response data
     */
    async sendToWebhook(messageText, requestSessionId) {
      const payload = this.buildPayload(messageText, requestSessionId);

      const url = APP_CONFIG.apiMode === 'backend'
        ? APP_CONFIG.backendChatUrl
        : APP_CONFIG.n8nWebhookUrl;

      const headers = {
        'Content-Type': 'application/json'
      };

      // Later, when backend auth exists, send token only to backend
      if (APP_CONFIG.apiMode === 'backend') {
        const token = localStorage.getItem('mls.auth_token');
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }

      console.log('Sending chat request to:', url);
      console.log('Payload: message=%s, hasImage=%s, sessionId=%s', payload.message?.substring(0, 50), !!payload.image, payload.sessionId);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';

        let responseData;

        if (contentType.includes('application/json')) {
          try {
            const text = await response.text();
            responseData = text ? JSON.parse(text) : { reply: 'No response received from server.' };
          } catch (parseErr) {
            console.warn('Failed to parse JSON response:', parseErr);
            responseData = { reply: 'Sorry — the server returned an invalid response. Please try again.' };
          }
        } else {
          const text = await response.text();
          responseData = text ? { reply: text } : { reply: 'No response received from server.' };
        }

        if (Array.isArray(responseData) && responseData.length > 0) {
          responseData = responseData[0];
        }

        console.log('Raw response:', responseData);

        const normalized = normalizeN8nResponse(responseData);
        normalized.sessionId = extractResponseSessionId(responseData) || normalized.sessionId || requestSessionId;
        return normalized;
      } catch (error) {
        console.error('Chat request error:', error);
        throw error;
      }
    },

    /**
     * Process webhook response and add to history
     * @param {string} userMessage - Original user message
     * @param {object} response - Webhook response object with isImage, isTable, output fields
     */
    processResponse(userMessage, response, options = {}) {
      const chatId = options.chatId || currentChatId;
      const addToMemory = options.addToMemory ?? true;
      // Clear pending image after sending
      this.clearPendingImage();

      // Process assistant response - handle both image and text
      if (response && response.isImage === true && response.output) {
        // Image response - store both message and image reference
        const messageObj = this.addMessage('assistant', response.output, response.output, chatId, addToMemory);
        rememberMessage('assistant', '', messageObj.imageRef || response.output);
      } else if (response && response.output) {
        // Text response — preserve isTable flag from webhook
        const msgObj = this.addMessage('assistant', response.output, null, chatId, addToMemory);
        if (response.isTable === true) msgObj.isTable = true;
        rememberMessage('assistant', response.output);
      }

      // Render updated conversation
      // renderAllMessages(); // Removed to fix duplicate replies
      scrollToBottom();

      return {
        userMessage: this.conversationHistory[this.conversationHistory.length - 2],
        assistantMessage: this.conversationHistory[this.conversationHistory.length - 1]
      };
    },


    getHistory() {
      return [...this.conversationHistory];
    },

    /**
     * Clear conversation history (for new chat)
     */
    clearHistory() {
      this.conversationHistory = [];
      this.pendingImage = null;
      console.log('Conversation history cleared');
    },


  };

  // Initialize on startup
  ConversationManager.init();

  const APP_CONFIG = {
    apiMode: 'n8n', 
    n8nWebhookUrl: '/api/chat',
    backendChatUrl: '/api/chat'
  };

  // Define currentSessionId state variable
  let currentSessionId = '';
  const pendingSessions = new Map();
  const chatRuntimeSessions = new Map();

  marked.setOptions({
    breaks: true,
    gfm: true
  });


  
  /**
   * Read image file as base64 and set as pending image
   * @param {File} file - Image file to read
   * @returns {Promise<string>} Base64 string
   */
  const MAX_IMAGE_SIZE_MB = 10;
  const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

  async function readImageAsBase64(file) {
    // AF-4: Image size validation
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${MAX_IMAGE_SIZE_MB}MB. Please compress or resize the image.`);
    }
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      throw new Error(`Unsupported image format: ${file.type}. Please use PNG, JPEG, WebP, or GIF.`);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result;
        ConversationManager.setPendingImage(base64);
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read image file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Create and display image thumbnail preview
   * @param {string} base64String - Base64 encoded image
   * @param {HTMLElement} container - Container to display preview
   * @returns {HTMLElement} Thumbnail element
   */
  function createImageThumbnail(base64String, container = null) {
    const thumb = document.createElement('div');
    thumb.className = 'image-thumbnail-preview';
    thumb.style.cssText = `
      display: inline-block;
      position: relative;
      margin: 8px 0;
      border-radius: 8px;
      overflow: hidden;
      background: var(--muted, #f5f5f5);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    `;

    const img = document.createElement('img');
    img.src = base64String;
    img.style.cssText = `
      display: block;
      max-width: 200px;
      max-height: 150px;
      object-fit: contain;
    `;
    img.alt = 'Attached image preview';

    const badge = document.createElement('div');
    badge.style.cssText = `
      position: absolute;
      top: 4px;
      right: 4px;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    `;
    badge.textContent = '📎 Attached';

    thumb.appendChild(img);
    thumb.appendChild(badge);

    if (container) {
      container.appendChild(thumb);
    }

    return thumb;
  }

  /**
   * Render assistant response (image or text)
   * @param {object} response - Response object with isImage and output fields
   * @returns {HTMLElement} Rendered element
   */
  function renderResponse(response) {
    const messageEl = document.createElement('div');
    messageEl.className = 'message assistant';

    if (response.isImage && response.output) {
      // Render as image
      const imgContainer = document.createElement('div');
      imgContainer.className = 'message-image-container';
      imgContainer.style.cssText = `
        border-radius: 8px;
        overflow: hidden;
        background: var(--muted, #f5f5f5);
        max-width: 100%;
      `;

      const img = document.createElement('img');
      img.src = response.output;
      img.alt = 'AI generated image';
      img.style.cssText = `
        display: block;
        max-width: 100%;
        height: auto;
        cursor: pointer;
      `;

      // Add click to zoom
      img.addEventListener('click', () => {
        openImageLightbox(response.output, 0);
      });

      imgContainer.appendChild(img);
      messageEl.appendChild(imgContainer);
    } else if (response.output) {
      // Render as text
      const textEl = document.createElement('div');
      textEl.className = 'message-text';
      setAssistantMarkdown(textEl, response.output);
      messageEl.appendChild(textEl);
    }

    return messageEl;
  }

  const IMAGE_REQUEST_RE = /\b(generate|create|make|draw|illustrate|visuali[sz]e|render|design)\b[\s\S]{0,80}\b(image|visual|picture|illustration|graphic|thumbnail|poster|asset)\b|\b(image|visual|picture|illustration|graphic|thumbnail|poster|asset)\b[\s\S]{0,80}\b(for|of|from|based on)\b/i;
  const HISTORY_LIMIT = 100;

  function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function openChatRuntimeSession(chatId = currentSessionId) {
    if (!chatId) return generateUUID();
    
    if (chatRuntimeSessions.has(chatId)) {
      return chatRuntimeSessions.get(chatId);
    }
    
    const savedSessionsStr = localStorage.getItem('mls.runtimeSessions');
    let savedSessions = {};
    if (savedSessionsStr) {
      try {
        savedSessions = JSON.parse(savedSessionsStr);
      } catch (e) {
        console.warn('Failed to parse runtime sessions:', e);
      }
    }
    
    if (savedSessions[chatId]) {
      chatRuntimeSessions.set(chatId, savedSessions[chatId]);
      return savedSessions[chatId];
    }
    
    const sessionId = generateUUID();
    chatRuntimeSessions.set(chatId, sessionId);
    
    savedSessions[chatId] = sessionId;
    localStorage.setItem('mls.runtimeSessions', JSON.stringify(savedSessions));
    
    return sessionId;
  }

  function getChatRuntimeSession(chatId = currentSessionId) {
    if (!chatRuntimeSessions.has(chatId)) {
      return openChatRuntimeSession(chatId);
    }
    return chatRuntimeSessions.get(chatId);
  }

  function extractResponseSessionId(data) {
    if (!data || typeof data !== 'object') return null;
    return data.sessionId || data.requestSessionId || data.chatSessionId || data?.body?.sessionId || data?.data?.sessionId || null;
  }

  function renderMarkdownHtml(markdown) {
    let preprocessed = String(markdown || '');
    
    // 1. Convert headers like "Top 10 Dreams" or "Dreams:" to h3 markdown headers
    preprocessed = preprocessed.replace(/^(\s*)(Top\s+\d+\s+[^#\n]{1,50}):?\.?\s*$/gmi, '$1### $2');
    preprocessed = preprocessed.replace(/^(\s*)(Fears|Frustrations|Dreams|Desires|Hooks|Scripts):?\s*$/gmi, '$1### $2');
    
    // 2. Convert literal bullet points (•, ·, etc.) at the start of a line to standard markdown list items (- )
    preprocessed = preprocessed.replace(/^(\s*)[•\u2022·\u00b7]\s*/gm, '$1- ');

    // 3. Bold follow-up action prompts (e.g. "Want me to...", "Would you like...", "If you'd like...", "Type 'Hook'...")
    preprocessed = preprocessed.replace(/^((?:Want me to|Would you like|If you(?:'d| would) like|Ready to|Shall I|Let me know|Just type|Type ')[^\n]{10,})$/gmi, '**$1**');

    // 4. Convert markdown tables to formatted lists — but SKIP the Fears/Dreams table (that uses professional renderer)
    preprocessed = preprocessed.replace(
      /(?:^|\n)(\|[^\n]+\|\s*\n\|[\s|:\-]+\|\s*\n(?:\|[^\n]+\|\s*\n?)*)/gm,
      (match, tableBlock) => {
        // If this table has Fears/Frustrations/Dreams/Desires columns, leave it alone for professional renderer
        const headerLine = tableBlock.trim().split('\n')[0] || '';
        if (/Fears/i.test(headerLine) && /Dreams/i.test(headerLine)) return match;
        
        const lines = tableBlock.trim().split('\n').filter(l => l.trim());
        if (lines.length < 3) return match;
        const parseRow = (line) => line.split('|').map(c => c.trim()).filter(c => c !== '');
        const headers = parseRow(lines[0]);
        if (headers.length === 0) return match;
        // lines[1] is the separator (| --- | --- |), skip it
        let result = '\n';
        for (let i = 2; i < lines.length; i++) {
          const cells = parseRow(lines[i]);
          if (cells.length === 0 || cells.every(c => /^[-:]+$/.test(c))) continue;
          const parts = [];
          for (let j = 0; j < Math.min(headers.length, cells.length); j++) {
            const h = headers[j].toLowerCase();
            const v = cells[j];
            if (h === 'row' || h === '#' || h === 'no' || h === 'no.') continue;
            if (v === '--' || v === '-' || v === '') continue;
            parts.push({ header: headers[j], value: v });
          }
          if (parts.length === 0) continue;
          // First meaningful column = bold title, rest = details
          let entry = `- **${parts[0].value}**`;
          if (parts.length > 1) {
            const details = parts.slice(1).map(p => `**${p.header}:** ${p.value}`).join(' · ');
            entry += `\n  ${details}`;
          }
          result += entry + '\n';
        }
        return '\n' + (result.trim() || match) + '\n';
      }
    );

    const rawHtml = marked.parse(preprocessed);
    const safeHtml = DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel']
    });
    const template = document.createElement('template');
    template.innerHTML = safeHtml;
    template.content.querySelectorAll('h1,h2,h4,h5,h6').forEach((heading) => {
      const h3 = document.createElement('h3');
      h3.innerHTML = heading.innerHTML;
      h3.className = heading.className;
      heading.replaceWith(h3);
    });
    template.content.querySelectorAll('ol').forEach((list) => {
      const ul = document.createElement('ul');
      ul.innerHTML = list.innerHTML;
      ul.className = list.className;
      list.replaceWith(ul);
    });
    // Wrap tables in a scrollable container to prevent horizontal overflow
    template.content.querySelectorAll('table').forEach((table) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'md-table-wrap';
      table.replaceWith(wrapper);
      wrapper.appendChild(table);
    });
    return template.innerHTML;
  }

  function setAssistantMarkdown(el, markdown) {
    el.innerHTML = renderMarkdownHtml(markdown);
    el.querySelectorAll('a[href]').forEach((link) => {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    });
  }
  
  const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
  const STILL_WORKING_MS = 12 * 1000;

  const RECENTS_KEY = 'mls.recents';
  const HISTORY_KEY_PREFIX = 'mls.history.';
 
  const EMPTY_VANISH_MS = 580;

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const chat = $('chat');
  const empty = $('empty');
  const input = $('input');
  const sendBtn = $('sendBtn');
  const attachBtn = $('attachBtn');
  const fileInput = $('fileInput');
  const cameraInput = $('cameraInput');
  const attachMenu = $('attachMenu');
  const attachGalleryBtn = $('attachGalleryBtn');
  const attachCameraBtn = $('attachCameraBtn');
  const attachments = $('attachments');
  const newChatBtn = $('newChatBtn');
  const topbarExportBtn = $('topbarExportBtn');
  const topbarExportDropdown = $('topbarExportDropdown');
  const menuToggle = $('menuToggle');
  const sidebarScrim = $('sidebarScrim');
  const recentList = $('recentList');
  const clearAllBtn = $('clearAllBtn');
  

  let pendingFiles = [];
  let busy = false;
  let chatInner = null;
  let sidebarOpen = false;
  let wizardQuipTimer = null;
  let wizardQuipHideTimer = null;
  let wizardQuipStartTimer = null;
  let cachedUserSessions = [];
  let cachedSessionsUserUid = null;

  function historyKey(id = currentSessionId) {
    return `${HISTORY_KEY_PREFIX}${id}`;
  }

  function loadConversationHistory(id = currentSessionId) {
    if (db) return [];

    try {
      const parsed = JSON.parse(localStorage.getItem(historyKey(id)) || '[]');
      return Array.isArray(parsed) ? parsed.slice(-HISTORY_LIMIT) : [];
    } catch {
      return [];
    }
  }

  function saveConversationHistory(history, id = currentSessionId) {
    if (db) return;

    localStorage.setItem(historyKey(id), JSON.stringify(history.slice(-HISTORY_LIMIT)));
  }

  function rememberMessage(role, content, image = null) {
    if (db) return;

    const cleanContent = String(content || '').trim();
    if (!cleanContent && !image) return;
    const history = loadConversationHistory();
    
    const messageObj = {
      role,
      content: cleanContent,
      timestamp: new Date().toISOString()
    };

    if (image) {
      if (image.startsWith('data:')) {
        const imageId = 'img_' + generateUUID();
        ImageCache.saveImage(imageId, image);
        messageObj.imageRef = imageId;
      } else if (image.startsWith('img_')) {
        messageObj.imageRef = image;
      } else {
        messageObj.image = image;
      }
    }

    history.push(messageObj);
    saveConversationHistory(history);
  }

  function isImageGenerationRequest(text) {
    return IMAGE_REQUEST_RE.test(text || '');
  }

  function openSidebar() {
    sidebarOpen = true;
    if (window.innerWidth > 860) {
      app.classList.remove('sidebar-collapsed');
    } else {
      app.classList.add('sidebar-open');
    }
  }

  function closeSidebar() {
    sidebarOpen = false;
    if (window.innerWidth > 860) {
      app.classList.add('sidebar-collapsed');
    } else {
      app.classList.remove('sidebar-open');
    }
  }

  function toggleSidebar() {
    if (sidebarOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  menuToggle.addEventListener('click', toggleSidebar);
  sidebarScrim.addEventListener('click', closeSidebar);

  const SESSIONS_KEY_PREFIX = 'mls.sessions.';

  function userSessionsKey(userUid) {
    return `${SESSIONS_KEY_PREFIX}${userUid}`;
  }

  function makeChatTitle(title) {
    const clean = String(title || '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'New Chat';
    return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
  }

  function timestampMillis(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    return 0;
  }

  function titleFromMessages(messages) {
    if (!Array.isArray(messages)) return 'New Chat';
    const firstUser = messages.find(msg => msg?.role === 'user' && String(msg.content || msg.message || '').trim());
    return makeChatTitle(firstUser?.content || firstUser?.message || 'New Chat');
  }

  function sessionFromChatDoc(docSnap) {
    const data = docSnap.data() || {};
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const lastMessage = messages[messages.length - 1] || {};
    return {
      sessionId: docSnap.id,
      title: makeChatTitle(data.title || titleFromMessages(messages)),
      timestamp: timestampMillis(data.updatedAt || lastMessage.timestamp || data.createdAt),
      pinned: !!data.pinned,
      customTitle: !!data.customTitle
    };
  }

  async function fetchFirebaseUserSessions(userUid) {
    if (!db || !userUid) return [];
    const snap = await getDocs(query(collection(db, 'chats'), where('uid', '==', userUid)));
    return snap.docs
      .map(sessionFromChatDoc)
      .sort(sortSessions);
  }

  function sortSessions(a, b) {
    const aPinned = a.pinned ? 1 : 0;
    const bPinned = b.pinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    return (b.timestamp || 0) - (a.timestamp || 0);
  }

  function loadUserSessions(userUid) {
    if (db) {
      return cachedSessionsUserUid === userUid ? cachedUserSessions : [];
    }

    try {
      return JSON.parse(localStorage.getItem(userSessionsKey(userUid)) || '[]');
    } catch {
      return [];
    }
  }

  function saveUserSessions(userUid, sessions) {
    if (db) {
      cachedSessionsUserUid = userUid;
      cachedUserSessions = sessions.slice(0, 50).sort(sortSessions);
      return;
    }

    localStorage.setItem(userSessionsKey(userUid), JSON.stringify(sessions.slice(0, 50)));
  }

  async function refreshUserSessions(userUid = null) {
    const user = getFrontendUser();
    const uid = userUid || user?.uid || user?.id;
    if (!uid) return [];

    if (db) {
      try {
        cachedUserSessions = await fetchFirebaseUserSessions(uid);
        cachedSessionsUserUid = uid;
      } catch (err) {
        console.error('Firestore recents load error:', err);
        cachedUserSessions = [];
        cachedSessionsUserUid = uid;
      }
    } else {
      cachedUserSessions = loadUserSessions(uid).sort(sortSessions);
      cachedSessionsUserUid = uid;
    }

    renderRecents();
    return cachedUserSessions;
  }

  const WIZARD_COMMANDS = [
    'generate 6 months of content',
    'make my picture looks professional',
    'generate a catchy hooks',
    'create a story about trending topics'
  ];

  function isWizardCommand(title) {
    const clean = String(title || '').toLowerCase().trim();
    return WIZARD_COMMANDS.some(cmd => clean.includes(cmd));
  }

  async function touchUserSession(userUid, sessionId, title) {
    const cleanTitle = makeChatTitle(title);

    if (db && sessionId) {
      const idx = cachedUserSessions.findIndex(s => s.sessionId === sessionId);
      const existing = idx >= 0 ? cachedUserSessions[idx] : null;
      
      const existingIsDefault = !existing || !existing.title || existing.title === 'New Chat' || isWizardCommand(existing.title);
      const nextIsWizard = isWizardCommand(cleanTitle);
      
      const shouldSetTitle = cleanTitle && !nextIsWizard && (!existing || !existing.customTitle) && existingIsDefault;
      
      const updateData = {
        updatedAt: serverTimestamp()
      };

      if (shouldSetTitle) {
        updateData.title = cleanTitle;
        updateData.customTitle = false;
      } else if (!existing) {
        updateData.title = 'New Chat';
        updateData.customTitle = false;
      }

      try {
        await updateDoc(doc(db, 'chats', sessionId), updateData);
      } catch (err) {
        console.error('Firestore chat touch error:', err);
      }

      const nextSession = {
        ...(existing || {}),
        sessionId,
        title: shouldSetTitle ? cleanTitle : (existing?.title || (nextIsWizard ? 'New Chat' : cleanTitle) || 'New Chat'),
        timestamp: Date.now(),
        pinned: !!existing?.pinned,
        customTitle: !!existing?.customTitle
      };

      if (idx >= 0) {
        cachedUserSessions[idx] = nextSession;
      } else {
        cachedUserSessions.unshift(nextSession);
      }
      cachedSessionsUserUid = userUid;
      cachedUserSessions.sort(sortSessions);
      renderRecents();
      return;
    }

    const sessions = loadUserSessions(userUid);
    const idx = sessions.findIndex(s => s.sessionId === sessionId);
    const existing = idx >= 0 ? sessions[idx] : null;
    const existingIsDefault = !existing || !existing.title || existing.title === 'New Chat' || isWizardCommand(existing.title);
    const nextIsWizard = isWizardCommand(cleanTitle);
    const shouldSetTitle = cleanTitle && !nextIsWizard && (!existing || !existing.customTitle) && existingIsDefault;

    if (idx >= 0) {
      if (shouldSetTitle) {
        sessions[idx].title = cleanTitle;
      }
      sessions[idx].timestamp = Date.now();
    } else {
      sessions.unshift({ 
        sessionId, 
        title: shouldSetTitle ? cleanTitle : 'New Chat', 
        timestamp: Date.now() 
      });
    }
    saveUserSessions(userUid, sessions);
    renderRecents();
  }

  async function renameUserChat(userUid, sessionId, currentTitle) {
    const rawTitle = prompt('Rename chat', currentTitle || 'New Chat');
    if (rawTitle === null) return;

    const nextTitle = makeChatTitle(rawTitle);
    if (!nextTitle || nextTitle === makeChatTitle(currentTitle)) return;

    if (db) {
      try {
        await updateDoc(doc(db, 'chats', sessionId), {
          title: nextTitle,
          customTitle: true,
          updatedAt: serverTimestamp()
        });
      } catch (err) {
        console.error('Firestore rename error:', err);
        alert('Could not rename this chat. Please try again.');
        return;
      }
    }

    const sessions = loadUserSessions(userUid);
    const idx = sessions.findIndex(s => s.sessionId === sessionId);
    if (idx >= 0) {
      sessions[idx].title = nextTitle;
      sessions[idx].customTitle = true;
      sessions[idx].timestamp = Date.now();
    } else {
      sessions.unshift({ sessionId, title: nextTitle, customTitle: true, timestamp: Date.now() });
    }
    saveUserSessions(userUid, sessions);
    renderRecents();
  }

  function renderRecents() {
    const user = getFrontendUser();
    if (!user) return;
    const userUid = user.uid || user.id;
    const list = loadUserSessions(userUid);
    recentList.innerHTML = '';
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'recent-empty';
      e.textContent = 'No chats yet';
      recentList.appendChild(e);
      return;
    }
    
    // Sort pinned chats first, then sort by timestamp descending
    list.sort((a, b) => {
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      return (b.timestamp || 0) - (a.timestamp || 0);
    });

    for (const r of list) {
      const wrapper = document.createElement('div');
      wrapper.className = 'recent-item-wrapper' + (r.sessionId === currentSessionId ? ' active' : '');
      
      const b = document.createElement('button');
      b.className = 'recent-item-btn';
      b.textContent = r.title;
      b.title = r.title;
      b.addEventListener('click', () => {
        switchSession(r.sessionId);
      });
      
      const optionsBtn = document.createElement('button');
      optionsBtn.className = 'recent-item-options-btn';
      optionsBtn.type = 'button';
      optionsBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="1.5"></circle>
          <circle cx="12" cy="5" r="1.5"></circle>
          <circle cx="12" cy="19" r="1.5"></circle>
        </svg>
      `;
      
      const dropdown = document.createElement('div');
      dropdown.className = 'recent-menu-dropdown';

      const renameBtn = document.createElement('button');
      renameBtn.className = 'recent-menu-item rename';
      renameBtn.type = 'button';
      renameBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
        </svg>
        Rename
      `;

      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
        optionsBtn.classList.remove('menu-open');
        await renameUserChat(userUid, r.sessionId, r.title);
      });
      
      const pinBtn = document.createElement('button');
      pinBtn.className = 'recent-menu-item pin';
      pinBtn.type = 'button';
      pinBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="17" x2="12" y2="22"></line>
          <path d="M5 17h14v-1.76a2 2 0 0 0-.44-1.24l-2.78-3.5A2 2 0 0 1 15 9.25V5a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4.25c0 .4-.12.8-.38 1.1l-2.78 3.5a2 2 0 0 0-.44 1.24z"></path>
        </svg>
        ${r.pinned ? 'Unpin' : 'Pin'}
      `;
      
      pinBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await togglePinUserChat(userUid, r.sessionId);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'recent-menu-item delete';
      deleteBtn.type = 'button';
      deleteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
        Delete
      `;
      
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        dropdown.classList.remove('show');
        optionsBtn.classList.remove('menu-open');
        if (window.confirm(`Are you sure you want to delete the chat "${r.title}"?`)) {
          await deleteUserChat(userUid, r.sessionId);
        }
      });
      
      dropdown.appendChild(renameBtn);
      dropdown.appendChild(pinBtn);
      dropdown.appendChild(deleteBtn);
      
      optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.recent-menu-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('show');
        });
        document.querySelectorAll('.recent-item-options-btn').forEach(btn => {
          if (btn !== optionsBtn) btn.classList.remove('menu-open');
        });
        
        dropdown.classList.toggle('show');
        optionsBtn.classList.toggle('menu-open');
      });
      
      wrapper.appendChild(b);
      
      if (r.pinned) {
        const pinIndicator = document.createElement('span');
        pinIndicator.className = 'recent-item-pin-indicator';
        pinIndicator.innerHTML = `
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2z"></path>
          </svg>
        `;
        wrapper.appendChild(pinIndicator);
      }
      
      wrapper.appendChild(optionsBtn);
      wrapper.appendChild(dropdown);
      recentList.appendChild(wrapper);
    }
  }

  async function togglePinUserChat(userUid, sessionId) {
    const sessions = loadUserSessions(userUid);
    const idx = sessions.findIndex(s => s.sessionId === sessionId);
    if (idx >= 0) {
      const pinned = !sessions[idx].pinned;
      sessions[idx].pinned = pinned;
      sessions[idx].timestamp = Date.now();

      if (db) {
        try {
          await updateDoc(doc(db, 'chats', sessionId), {
            pinned,
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          console.error('Firestore pin error:', err);
        }
      }

      saveUserSessions(userUid, sessions);
      renderRecents();
    }
  }

  async function deleteUserChat(userUid, sessionId) {
    if (db) {
      try {
        // Delete all associated messages in Firestore first (dependencies)
        const msgsSnap = await getDocs(query(
          collection(db, 'messages'), 
          where('chat_id', '==', sessionId), 
          where('user_id', '==', userUid)
        ));
        for (const msgDoc of msgsSnap.docs) {
          await deleteDoc(doc(db, 'messages', msgDoc.id));
        }
        console.log('Firestore: deleted all messages associated with chat', sessionId);

        // Delete the main chat document after messages are gone
        await deleteDoc(doc(db, 'chats', sessionId));
        console.log('Firestore: deleted chat document', sessionId);
      } catch (err) {
        console.error('Firestore delete error:', err);
        alert('Failed to delete chat: ' + err.message);
        return;
      }
    }
    
    const sessions = loadUserSessions(userUid);
    const updated = sessions.filter(s => s.sessionId !== sessionId);
    saveUserSessions(userUid, updated);
    
    // If the deleted session was the current one, switch session or create a new one
    if (currentSessionId === sessionId) {
      if (updated.length > 0) {
        await switchSession(updated[0].sessionId);
      } else {
        if (db) {
          currentChatId = null;
          localStorage.removeItem('mls.chatId');
        }
        await newChat();
      }
    } else {
      renderRecents();
    }
  }

  async function deleteAllChats() {
    const user = getFrontendUser();
    const userUid = user?.uid || user?.id;
    if (!userUid) return;

    if (window.confirm('Are you sure you want to delete all your conversations? This cannot be undone.')) {
      if (db) {
        try {
          // Fetch all chats in Firestore for this user
          const chatsSnap = await getDocs(query(collection(db, 'chats'), where('uid', '==', userUid)));
          for (const chatDoc of chatsSnap.docs) {
            // Delete messages associated with this chat first
            const msgsSnap = await getDocs(query(collection(db, 'messages'), where('chat_id', '==', chatDoc.id), where('user_id', '==', userUid)));
            for (const msgDoc of msgsSnap.docs) {
              await deleteDoc(doc(db, 'messages', msgDoc.id));
            }

            // Then delete the chat document
            await deleteDoc(doc(db, 'chats', chatDoc.id));
          }
          console.log('Firestore: deleted all chats and messages for user');
        } catch (err) {
          console.error('Firestore clear all error:', err);
        }
      }

      // Clear local cache
      saveUserSessions(userUid, []);
      
      // Start a fresh draft chat
      await newChat();
    }
  }

  clearAllBtn?.addEventListener('click', deleteAllChats);

  // Close recent menus on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.recent-menu-dropdown').forEach(d => d.classList.remove('show'));
    document.querySelectorAll('.recent-item-options-btn').forEach(b => b.classList.remove('menu-open'));
  });

  async function switchSession(newSessionId, skipPushState = false) {
    if (currentSessionId === newSessionId) return;
    currentSessionId = newSessionId;
    openChatRuntimeSession(currentSessionId);
    
    if (db) {
      currentChatId = newSessionId;
      localStorage.setItem('mls.chatId', currentChatId);
    }
    
    if (!skipPushState) {
      window.history.pushState(null, '', `/chat/${newSessionId}`);
    }
    
    pendingFiles = [];
    renderAttachments();
    restoreDraft();
    
    ConversationManager.clearHistory();
    
    let loadedMessages = [];
    let loadedFromFirestore = false;
    
    if (db && currentChatId) {
      try {
        const user = getFrontendUser();
        const userUid = user?.uid || user?.id || null;
        const q = query(
          collection(db, 'messages'), 
          where('chat_id', '==', currentChatId),
          where('user_id', '==', userUid)
        );
        const querySnapshot = await getDocs(q);
        const msgs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        msgs.sort((a, b) => {
          const tA = a.created_at?.toMillis ? a.created_at.toMillis() : (a.created_at || 0);
          const tB = b.created_at?.toMillis ? b.created_at.toMillis() : (b.created_at || 0);
          return tA - tB;
        });

        if (msgs.length > 0) {
          loadedMessages = msgs.map(msg => ({
            role: msg.role,
            message: msg.content,
            image: msg.image || null,
            imageRef: msg.imageRef || null
          }));
          loadedFromFirestore = true;
        }
      } catch (e) {
        console.error('Error fetching chat history from Firestore in switchSession:', e);
      }
    }
    
    if (!db && !loadedFromFirestore) {
      const savedHistory = loadConversationHistory(currentSessionId);
      if (savedHistory && savedHistory.length > 0) {
        loadedMessages = savedHistory.map(msg => {
          const image = msg.images && msg.images[0] ? msg.images[0] : (msg.image || undefined);
          return {
            role: msg.role,
            message: msg.content || msg.message,
            image: image || null,
            imageRef: msg.imageRef || null,
            imageRefs: msg.imageRefs || null
          };
        });
      }
    }
    
    // Always dismiss the empty state and clear old chat UI
    dismissEmptyStateImmediate();
    if (chatInner) {
      chatInner.remove();
      chatInner = null;
    }

    await resolveMessagesImages(loadedMessages);
    
    if (loadedMessages.length > 0) {
      loadedMessages.forEach(msg => {
        ConversationManager.addMessageDirect(msg.role, msg.message, msg.image, msg.imageRef);
      });
      renderAllMessages();
    } else {
      showEmptyState();
    }
    
    renderRecents();
    closeSidebar();
  }

  async function initializeUserSession(user) {
  const userUid = user.uid || user.id;
  
  // Run data migration for old formats
  migrateUserChats(userUid);

  // Update user profile chip in sidebar
  const userChipName = document.querySelector('.sidebar-footer .user-name');
  const userChipSub = document.querySelector('.sidebar-footer .user-sub');
  const avatar = document.querySelector('.sidebar-footer .avatar');

  if (userChipName) userChipName.textContent = user.name || user.email.split('@')[0];
  if (userChipSub) userChipSub.textContent = user.email;
  if (avatar) avatar.textContent = (user.name || user.email || 'U')[0].toUpperCase();

  // Register popstate listener for back/forward routing
  if (!window._popstateBound) {
    window.addEventListener('popstate', () => {
      const pathParts = window.location.pathname.split('/');
      if (pathParts[1] === 'chat' && pathParts[2]) {
        switchSession(pathParts[2], true);
      }
    });
    window._popstateBound = true;
  }

  // Load Firestore chats first, then choose the current chat from Firebase.
  if (db) {
    const firebaseSessions = await refreshUserSessions(userUid);
    
    // Determine active chatId:
    // 1. From URL if path starts with /chat/{chatId}
    // 2. From localStorage
    // 3. Most recent session from firebase
    const pathParts = window.location.pathname.split('/');
    let urlChatId = null;
    if (pathParts[1] === 'chat' && pathParts[2]) {
      urlChatId = pathParts[2];
    }

    let targetChatId = null;
    if (urlChatId) {
      const exists = firebaseSessions.some(session => session.sessionId === urlChatId);
      if (exists) {
        targetChatId = urlChatId;
      } else {
        // Invalid chat ID! Fall back to last active or most recent
        alert('The requested conversation was not found.');
        const storedChatId = localStorage.getItem('mls.chatId');
        const storedSession = firebaseSessions.find(session => session.sessionId === storedChatId);
        if (storedSession) {
          targetChatId = storedSession.sessionId;
        } else if (firebaseSessions.length > 0) {
          targetChatId = firebaseSessions[0].sessionId;
        }
      }
    } else {
      const storedChatId = localStorage.getItem('mls.chatId');
      const storedSession = firebaseSessions.find(session => session.sessionId === storedChatId);
      if (storedSession) {
        targetChatId = storedSession.sessionId;
      } else if (firebaseSessions.length > 0) {
        targetChatId = firebaseSessions[0].sessionId;
      }
    }

    if (targetChatId) {
      currentChatId = targetChatId;
      localStorage.setItem('mls.chatId', currentChatId);
      if (window.location.pathname !== `/chat/${currentChatId}`) {
        window.history.replaceState(null, '', `/chat/${currentChatId}`);
      }
    } else {
      // Lazy creation: start in a new draft chat state
      currentChatId = null;
      localStorage.removeItem('mls.chatId');
      if (window.location.pathname !== '/chat') {
        window.history.replaceState(null, '', '/chat');
      }
    }
  } else {
    if (window.location.pathname === '/chat') {
      currentChatId = null;
      localStorage.removeItem('mls.chatId');
    } else {
      const localSessions = loadUserSessions(userUid).sort(sortSessions);
      currentChatId = localSessions[0]?.sessionId || null;
      if (currentChatId) {
        localStorage.setItem('mls.chatId', currentChatId);
        if (window.location.pathname !== `/chat/${currentChatId}`) {
          window.history.replaceState(null, '', `/chat/${currentChatId}`);
        }
      } else {
        if (window.location.pathname !== '/chat') {
          window.history.replaceState(null, '', '/chat');
        }
      }
    }
  }

  // After we have a valid chat document, use its ID as the session identifier
  currentSessionId = currentChatId;
  openChatRuntimeSession(currentSessionId);
  // Clear history and load history for current session
  ConversationManager.clearHistory();
  
  let loadedMessages = [];
  let loadedFromFirestore = false;

  if (db && currentChatId) {
    try {
      const q = query(
        collection(db, 'messages'), 
        where('chat_id', '==', currentChatId),
        where('user_id', '==', userUid)
      );
      const querySnapshot = await getDocs(q);
      const msgs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      msgs.sort((a, b) => {
        const tA = a.created_at?.toMillis ? a.created_at.toMillis() : (a.created_at || 0);
        const tB = b.created_at?.toMillis ? b.created_at.toMillis() : (b.created_at || 0);
        return tA - tB;
      });

      if (msgs.length > 0) {
        loadedMessages = msgs.map(msg => ({
          role: msg.role,
          message: msg.content,
          image: msg.image || null,
          imageRef: msg.imageRef || null
        }));
        loadedFromFirestore = true;
      }
    } catch (e) {
      console.error('Error fetching chat history from Firestore on init:', e);
    }
  }

  if (!db && !loadedFromFirestore) {
    const savedHistory = loadConversationHistory(currentSessionId);
    if (savedHistory && savedHistory.length > 0) {
      loadedMessages = savedHistory.map(msg => {
        const image = msg.images && msg.images[0] ? msg.images[0] : (msg.image || undefined);
        return {
          role: msg.role,
          message: msg.content || msg.message,
          image: image || null,
          imageRef: msg.imageRef || null,
          imageRefs: msg.imageRefs || null
        };
      });
    }
  }

  await resolveMessagesImages(loadedMessages);

  if (loadedMessages.length > 0) {
    loadedMessages.forEach(msg => {
      ConversationManager.addMessageDirect(msg.role, msg.message, msg.image, msg.imageRef);
    });
    dismissEmptyStateImmediate();
    renderAllMessages();
  } else {
    showEmptyState();
  }

  renderRecents();
  restoreDraft();
}

  function renderAllMessages() {
    if (chatInner) {
      chatInner.remove();
      chatInner = null;
    }
    const inner = ensureInner();
    const history = ConversationManager.getHistory();
    history.forEach(msg => {
      const row = document.createElement('div');
      row.className = 'msg-row ' + (msg.role === 'user' ? 'user' : 'ai');
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      row.appendChild(bubble);
      
      if (msg.image) {
        const gal = document.createElement('div');
        gal.className = 'bubble-images' + (msg.role !== 'user' ? ' ai-images' : '');
        const img = document.createElement('img');
        img.src = ensureDataUrlPrefix(msg.image);
        img.alt = '';
        if (msg.role !== 'user') {
          img.loading = 'lazy';
        }
        gal.appendChild(img);
        bubble.appendChild(gal);
        bindImagePreview(img, ensureDataUrlPrefix(msg.image), 0);
      }
      
      if (msg.message) {
        const textEl = document.createElement('div');
        textEl.className = msg.role === 'user' ? '' : 'ai-text';
        
        const text = msg.message;
        // Render as professional table only for Fears/Dreams content
        if (msg.role !== 'user' && isTableContent(text)) {
          renderProfessionalTable(textEl, text, () => {});
        } else if (msg.role !== 'user') {
          setAssistantMarkdown(textEl, text);
        } else {
          textEl.textContent = text;
        }
        bubble.appendChild(textEl);
      }

      // Add action bar to AI messages in history
      if (msg.role !== 'user' && msg.message) {
        bubble.appendChild(createActionBar(msg.message));
      }
      
      inner.appendChild(row);
    });
    scrollToBottom();
  }

  function showEmptyState() {
    if (chatInner) {
      chatInner.remove();
      chatInner = null;
    }
    const existingEmpty = document.getElementById('empty');
    if (!existingEmpty) {
      const e = buildEmpty();
      chat.appendChild(e);
      setupEmptyState(e);
    }
  }

  function dismissEmptyStateImmediate() {
    const emptyEl = document.getElementById('empty');
    if (emptyEl) {
      stopWizardStage();
      emptyEl.remove();
    }
  }

  function ensureInner() {
    if (chatInner) return chatInner;
    const emptyEl = document.getElementById('empty');
    if (emptyEl?.parentNode) emptyEl.remove();
    chatInner = document.createElement('div');
    chatInner.className = 'chat-inner';
    chat.appendChild(chatInner);
    return chatInner;
  }

  function scrollToBottom(force = false) {
    requestAnimationFrame(() => {
      // Only auto-scroll if user is near the bottom or force is true
      const isNearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 150;
      if (!force && !isNearBottom) return;
      const target = chatInner?.lastElementChild || chat.lastElementChild;
      if (target?.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'end' });
      } else {
        chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
      }
    });
  }

  function imageExtensionFromSrc(src) {
    if (/^data:image\/jpe?g/i.test(src)) return 'jpg';
    if (/^data:image\/webp/i.test(src)) return 'webp';
    if (/^data:image\/gif/i.test(src)) return 'gif';
    const m = src.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i);
    if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
    return 'png';
  }

  const imageLightbox = $('imageLightbox');
  const imageLightboxBackdrop = $('imageLightboxBackdrop');
  const imageLightboxClose = $('imageLightboxClose');
  const imageLightboxImg = $('imageLightboxImg');
  const imageLightboxDownload = $('imageLightboxDownload');
  let lightboxSrc = '';
  let lightboxIndex = 0;

  async function downloadImage(src, index) {
    const ext = imageExtensionFromSrc(src);
    const filename = `mate-louis-${Date.now()}-${index + 1}.${ext}`;
    try {
      if (src.startsWith('data:')) {
        const a = document.createElement('a');
        a.href = src;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, '_blank', 'noopener');
    }
  }

  // Focus trap utility for modals (Accessibility)
  function trapFocus(modalEl) {
    const sel = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';
    const focusable = Array.from(modalEl.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    function handleTab(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    modalEl._trapHandler = handleTab;
    modalEl.addEventListener('keydown', handleTab);
    first.focus();
  }
  function releaseFocus(modalEl) {
    if (modalEl._trapHandler) {
      modalEl.removeEventListener('keydown', modalEl._trapHandler);
      delete modalEl._trapHandler;
    }
  }

  function closeImageLightbox() {
    if (!imageLightbox) return;
    imageLightbox.hidden = true;
    imageLightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
    lightboxSrc = '';
    releaseFocus(imageLightbox);
  }

  function openImageLightbox(src, index) {
    if (!imageLightbox || !imageLightboxImg) return;
    lightboxSrc = src;
    lightboxIndex = index;
    imageLightboxImg.src = src;
    imageLightbox.hidden = false;
    imageLightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-open');
    trapFocus(imageLightbox);
  }

  imageLightboxBackdrop?.addEventListener('click', closeImageLightbox);
  imageLightboxClose?.addEventListener('click', closeImageLightbox);
  imageLightboxDownload?.addEventListener('click', () => {
    if (lightboxSrc) downloadImage(lightboxSrc, lightboxIndex);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageLightbox && !imageLightbox.hidden) closeImageLightbox();
  });



  function bindImagePreview(el, src, index) {
    el.classList.add('img-downloadable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('title', 'Click to view');
    el.setAttribute('aria-label', 'View image');
    const trigger = (e) => {
      e.preventDefault();
      openImageLightbox(src, index);
    };
    el.addEventListener('click', trigger);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') trigger(e);
    });
  }

  function addUserMessage(text, images) {
    const inner = ensureInner();
    const row = document.createElement('div');
    row.className = 'msg-row user';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (images && images.length) {
      const gal = document.createElement('div');
      gal.className = 'bubble-images';
      images.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        bindImagePreview(img, src, i);
        gal.appendChild(img);
      });
      bubble.appendChild(gal);
    }
    if (text) {
      const t = document.createElement('div');
      t.textContent = text;
      bubble.appendChild(t);
    }
    row.appendChild(bubble);
    inner.appendChild(row);
    scrollToBottom();
  }

  function addThinking() {
    const inner = ensureInner();
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    row.dataset.thinking = '1';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<div class="thinking"><span></span><span></span><span></span></div>';
    row.appendChild(bubble);
    inner.appendChild(row);
    scrollToBottom();
    return row;
  }

  function addSkeletonMessage(kind = 'text', sessionId = '') {
    const inner = ensureInner();
    const row = document.createElement('div');
    row.className = 'msg-row ai skeleton-row';
    row.dataset.sessionId = sessionId;

    const bubble = document.createElement('div');
    bubble.className = 'bubble skeleton-bubble';

    if (kind === 'image') {
      bubble.classList.add('image-bubble');
      const box = document.createElement('div');
      box.className = 'skeleton skeleton-image';
      bubble.appendChild(box);
    } else {
      for (let i = 0; i < 3; i += 1) {
        const line = document.createElement('div');
        line.className = `skeleton skeleton-line skeleton-line-${i + 1}`;
        bubble.appendChild(line);
      }
    }

    row.appendChild(bubble);
    inner.appendChild(row);
    scrollToBottom();
    return row;
  }

  function clearPendingSession(sessionId) {
    const pending = pendingSessions.get(sessionId);
    if (pending?.poller) {
      clearInterval(pending.poller);
    }
    pendingSessions.delete(sessionId);
  }

  function renderResponseIntoSkeleton(pending, response) {
    if (!pending?.row || !pending.row.isConnected) return;
    const bubble = pending.row.querySelector('.bubble');
    if (!bubble) return;

    bubble.innerHTML = '';
    bubble.classList.remove('skeleton-bubble');

    if (response && response.isImage === true && response.output) {
      bubble.classList.add('image-bubble');
      const gal = document.createElement('div');
      gal.className = 'bubble-images ai-images';
      const ph = document.createElement('div');
      ph.className = 'img-placeholder loaded';
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = response.output;
      ph.appendChild(img);
      bindImagePreview(ph, response.output, 0);
      gal.appendChild(ph);
      bubble.appendChild(gal);
      scrollToBottom();
      return;
    }

    const text = response?.output || 'No response received';
    const textEl = document.createElement('div');
    textEl.className = 'ai-text';
    bubble.appendChild(textEl);

    if (isTableContent(text)) {
      renderProfessionalTable(textEl, text, () => {});
    } else {
      setAssistantMarkdown(textEl, text);
      scrollToBottom();
    }

    // Add action bar to live AI responses
    bubble.appendChild(createActionBar(text));
  }

  function addAIMessage(text, images, questions) {
    const inner = ensureInner();
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(bubble);
    inner.appendChild(row);

    if (images && images.length) {
      bubble.classList.add('image-bubble');
      const gal = document.createElement('div');
      gal.className = 'bubble-images ai-images';
      images.forEach((src, i) => {
        const ph = document.createElement('div');
        ph.className = 'img-placeholder';
        ph.innerHTML = '<div class="img-shimmer"></div>';
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('load', () => { ph.classList.add('loaded'); });
        img.addEventListener('error', () => { ph.classList.add('error'); });
        img.src = src;
        ph.appendChild(img);
        bindImagePreview(ph, src, i);
        gal.appendChild(ph);
      });
      bubble.appendChild(gal);
    }

    const showQuestions = () => {
      if (questions && questions.length) {
        const qContainer = document.createElement('div');
        qContainer.className = 'suggested-questions';
        questions.forEach((q) => {
          const qText = typeof q === 'string' ? q : (q.question || q.text || '');
          if (!qText) return;
          const btn = document.createElement('button');
          btn.className = 'suggested-question-btn';
          btn.textContent = qText;
          btn.addEventListener('click', () => {
            if (busy) return;
            input.value = qText;
            autoSize();
            updateSendState();
            send();
          });
          qContainer.appendChild(btn);
        });
        bubble.appendChild(qContainer);
        scrollToBottom();
      }
    };

    if (text) {
      const t = document.createElement('div');
      t.className = 'ai-text';
      bubble.appendChild(t);
      
      // Render as professional table only for Fears/Dreams content
      const isTable = isTableContent(text);
      
      if (isTable) {
        // Render professional table
        renderProfessionalTable(t, text, showQuestions);
      } else {
        setAssistantMarkdown(t, text);
        scrollToBottom();
        showQuestions();
      }
    } else {
      showQuestions();
      scrollToBottom();
    }

    // Action bar for AI responses
    if (text) {
      bubble.appendChild(createActionBar(text));
    }
  }

  function isTableContent(text) {
    if (typeof text !== 'string') return false;
    const value = text.trim();
    if (!value) return false;

    // Only match the Fears/Frustrations/Dreams/Desires table — nothing else
    const hasFears = /Fears/i.test(value);
    const hasDreams = /Dreams/i.test(value);
    const hasFrustrations = /Frustrations/i.test(value);
    const hasDesires = /Desires/i.test(value);
    if (!hasFears || !hasDreams) return false;

    // Must have pipe-delimited rows with at least 2 of these keywords in a header-like line
    const lines = value.split('\n').map(line => line.trim()).filter(Boolean);
    const headerLine = lines.find(line =>
      line.includes('|') && /Fears/i.test(line) && /Dreams/i.test(line)
    );
    if (!headerLine) return false;

    // Must have at least 2 data rows with pipes
    const pipeRows = lines.filter(line =>
      line.includes('|') && (line.startsWith('|') || /^\d+\s*\|/.test(line))
    );
    return pipeRows.length >= 3; // header + separator + at least 1 data row
  }

  function stripTableLabel(cell) {
    return String(cell || '')
      .replace(/^(Fears|Frustrations|Dreams|Desires)\s*:\s*/i, '')
      .trim();
  }

  function normalizeTableHeaders(headers) {
    const trimmed = headers.map(header => String(header || '').trim());
    const withoutNumber = trimmed.filter(header => {
      const value = header.toLowerCase();
      return value !== '#' && value !== 'no' && value !== 'number' && value !== 'row';
    });

    if (withoutNumber.length === 4 && /fears/i.test(withoutNumber[0])) {
      return ['Fears', 'Frustrations', 'Dreams', 'Desires'];
    }

    return trimmed;
  }

  function normalizeTableCells(cells, headers) {
    let normalized = cells.map(stripTableLabel);
    const firstCell = String(normalized[0] || '').trim();

    if (/^#?\d+\.?$/.test(firstCell) && normalized.length > headers.length) {
      normalized = normalized.slice(1);
    }

    return normalized.slice(0, headers.length);
  }

  function modelFromHtmlTable(content) {
    if (!/<table[\s>]/i.test(content)) return null;

    try {
      const doc = new DOMParser().parseFromString(content, 'text/html');
      const table = doc.querySelector('table');
      if (!table) return null;

      const headerCells = Array.from(table.querySelectorAll('thead th'));
      const firstRow = table.querySelector('tr');
      const fallbackHeaders = firstRow ? Array.from(firstRow.querySelectorAll('th')) : [];
      const rawHeaders = (headerCells.length ? headerCells : fallbackHeaders).map(cell => cell.textContent.trim());
      const headers = normalizeTableHeaders(rawHeaders.length ? rawHeaders : ['Fears', 'Frustrations', 'Dreams', 'Desires']);
      if (!headers.length) return null;

      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      const fallbackRows = Array.from(table.querySelectorAll('tr')).filter(row => row.querySelectorAll('td').length);
      const rows = (bodyRows.length ? bodyRows : fallbackRows)
        .map(row => normalizeTableCells(Array.from(row.querySelectorAll('td')).map(cell => cell.textContent.trim()), headers))
        .filter(row => row.length);

      return rows.length ? { headers, rows, intro: getTableIntro(content) } : null;
    } catch (err) {
      console.error('Error parsing saved HTML table:', err);
      return null;
    }
  }

  function getTableIntro(content) {
    const withoutHtml = String(content || '').replace(/<table[\s\S]*<\/table>/i, '').replace(/<[^>]+>/g, ' ');
    const introLines = withoutHtml
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.includes('|') && !/^#+\s*/.test(line));
    return introLines.join(' ').trim();
  }

  function isRowNumberHeader(headerText) {
    if (!headerText) return false;
    const clean = headerText.trim().toLowerCase();
    return clean === '#' || clean === 'no' || clean === 'number' || clean === 'row';
  }

  function modelFromTextTable(content) {
    const lines = String(content || '').split('\n').map(line => line.trim()).filter(Boolean);
    const tableLines = lines.filter(line => line.includes('|') && (
      line.startsWith('|') ||
      /^#?\d+\s*\|/.test(line) ||
      /Fears\s*:|Frustrations\s*:|Dreams\s*:|Desires\s*:/i.test(line)
    ));

    if (!tableLines.length) return null;

    const splitRow = line => {
      let cells = line.split('|').map(cell => cell.trim());
      if (cells[0] === '') cells.shift();
      if (cells[cells.length - 1] === '') cells.pop();
      return cells;
    };

    const separatorRegex = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/;
    const nonSeparatorLines = tableLines.filter(line => !separatorRegex.test(line));
    if (!nonSeparatorLines.length) return null;

    const firstCells = splitRow(nonSeparatorLines[0]);
    const hasSeparator = tableLines.some(line => separatorRegex.test(line));
    
    // A first line is a header if we have a separator row OR it has text cells and first cell is not a pure number
    const firstLineLooksLikeHeader = hasSeparator || (firstCells.some(cell => !/^#?\d+$/.test(cell)) && !/^#?\d+/.test(firstCells[0] || ''));
    
    const headers = firstLineLooksLikeHeader
      ? normalizeTableHeaders(firstCells)
      : ['Fears', 'Frustrations', 'Dreams', 'Desires'];

    const rowLines = firstLineLooksLikeHeader ? nonSeparatorLines.slice(1) : nonSeparatorLines;
    const rows = rowLines
      .map(line => normalizeTableCells(splitRow(line), headers))
      .filter(row => row.length === headers.length);

    const intro = lines
      .filter(line => !tableLines.includes(line) && !/^#+\s*/.test(line))
      .join(' ')
      .trim();

    return rows.length ? { headers, rows, intro } : null;
  }

  function renderTableModel(container, model, callback) {
    const wrapper = document.createElement('div');
    wrapper.className = 'professional-table-wrapper';

    const tableContainer = document.createElement('div');
    tableContainer.className = 'professional-table-container';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    model.headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      if (isRowNumberHeader(header)) {
        th.style.width = '60px';
        th.style.minWidth = '60px';
        th.style.textAlign = 'center';
        th.classList.add('row-number-col');
      }
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    model.rows.forEach(cells => {
      const row = document.createElement('tr');
      cells.forEach((cell, cellIdx) => {
        const td = document.createElement('td');
        td.textContent = cell;
        
        const header = model.headers[cellIdx];
        if (isRowNumberHeader(header)) {
          td.style.width = '60px';
          td.style.minWidth = '60px';
          td.style.textAlign = 'center';
          td.style.color = '#94a3b8';
          td.style.fontWeight = '600';
          td.classList.add('row-number-col');
        }
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
    wrapper.appendChild(tableContainer);

    if (model.intro) {
      const intro = document.createElement('p');
      intro.className = 'table-intro';
      intro.textContent = model.intro;
      intro.style.marginTop = '18px';
      intro.style.color = 'var(--text)';
      intro.style.fontWeight = '600';
      intro.style.fontSize = '0.95rem';
      intro.style.lineHeight = '1.6';
      wrapper.appendChild(intro);
    }

    container.innerHTML = '';
    container.appendChild(wrapper);
    scrollToBottom();

    if (callback) callback();
  }

  function renderProfessionalTable(container, content, callback) {
    const tableModel = modelFromHtmlTable(content) || modelFromTextTable(content);
    if (tableModel) {
      renderTableModel(container, tableModel, callback);
      return;
    }

    // Extract title if present
    const titleMatch = content.match(/^#+\s+(.+?)(\n|$)/);
    const title = titleMatch ? titleMatch[1] : null;
    const tableContent = titleMatch ? content.replace(/^#+\s+.+?(\n|$)/, '').trim() : content;

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'professional-table-wrapper';

    // Add header with title and copy button
    if (title) {
      const header = document.createElement('div');
      header.className = 'table-header';
      header.innerHTML = `
        <h3 class="table-title"></h3>
        <button class="copy-button" title="Copy table">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
          Copy
        </button>
      `;
      header.querySelector('.table-title').textContent = title;
      
      // Copy button functionality
      const copyBtn = header.querySelector('.copy-button');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(tableContent).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg> Copy`;
          }, 2000);
        });
      });
      
      wrapper.appendChild(header);
    }

    // Create table container
    const tableContainer = document.createElement('div');
    tableContainer.className = 'professional-table-container';

    // Parse only markdown table rows so intro text is not treated as a table cell.
    const lines = tableContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('|') && line.includes('|'));
    if (lines.length < 2) {
      setAssistantMarkdown(container, content);
      callback();
      return;
    }

    // Create table element
    const table = document.createElement('table');

    // Parse headers
    const headerLine = lines[0];
    const rawHeaders = headerLine.split('|').map(h => h.trim()).filter(h => h);
    const headers = rawHeaders;

    // Create thead
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      if (isRowNumberHeader(header)) {
        th.style.width = '60px';
        th.style.minWidth = '60px';
        th.style.textAlign = 'center';
        th.classList.add('row-number-col');
      }
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create tbody
    const tbody = document.createElement('tbody');
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('|') || line.includes('---')) continue;

      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length === 0) continue;

      const row = document.createElement('tr');
      cells.forEach((cell, cellIdx) => {
        const td = document.createElement('td');
        td.textContent = cell;
        
        const header = headers[cellIdx];
        if (isRowNumberHeader(header)) {
          td.style.width = '60px';
          td.style.minWidth = '60px';
          td.style.textAlign = 'center';
          td.style.color = '#94a3b8';
          td.style.fontWeight = '600';
          td.classList.add('row-number-col');
        }
        row.appendChild(td);
      });
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    tableContainer.appendChild(table);
    wrapper.appendChild(tableContainer);

    // Append to container and scroll
    container.innerHTML = '';
    container.appendChild(wrapper);
    scrollToBottom();
    
    if (callback) callback();
  }

  function renderAttachments() {
    attachments.innerHTML = '';
    for (const f of pendingFiles) {
      const card = document.createElement('div');
      card.className = 'attach-card';
      const img = document.createElement('img');
      img.src = f.dataUrl;
      img.alt = 'Attachment';
      const removeBtn = document.createElement('button');
      removeBtn.className = 'attach-remove';
      removeBtn.dataset.id = f.id;
      removeBtn.setAttribute('aria-label', 'Remove');
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';
      card.appendChild(img);
      card.appendChild(removeBtn);
      attachments.appendChild(card);
    }
    updateSendState();
  }

  attachments.addEventListener('click', (e) => {
    const btn = e.target.closest('.attach-remove');
    if (!btn) return;
    pendingFiles = pendingFiles.filter(f => f.id !== btn.dataset.id);
    renderAttachments();
  });

  function addFiles(files) {
    const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
    for (const file of imgs) {
      const reader = new FileReader();
      reader.onload = () => {
        pendingFiles.push({ id: generateUUID(), file, dataUrl: reader.result });
        renderAttachments();
      };
      reader.readAsDataURL(file);
    }
  }

  // Attach button — show popup menu with Gallery / Selfie options
  attachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (attachMenu) {
      attachMenu.hidden = !attachMenu.hidden;
    }
  });

  // Close attach menu when clicking outside
  document.addEventListener('click', (e) => {
    if (attachMenu && !attachMenu.hidden && !attachMenu.contains(e.target) && e.target !== attachBtn) {
      attachMenu.hidden = true;
    }
  });

  // Gallery option
  attachGalleryBtn?.addEventListener('click', () => {
    attachMenu.hidden = true;
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    for (const file of imageFiles) {
      await readImageAsBase64(file);
      createImageThumbnail(ConversationManager.getPendingImage(), attachments);
    }
    
    addFiles(files);
    fileInput.value = '';
  });

  // Camera / Selfie — open WebRTC camera modal
  const cameraModal = $('cameraModal');
  const cameraBackdrop = $('cameraBackdrop');
  const cameraCloseBtn = $('cameraCloseBtn');
  const cameraVideo = $('cameraVideo');
  const cameraCanvas = $('cameraCanvas');
  const cameraPreview = $('cameraPreview');
  const cameraPlaceholder = $('cameraPlaceholder');
  const cameraCaptureBtn = $('cameraCaptureBtn');
  const cameraRetakeBtn = $('cameraRetakeBtn');
  const cameraUseBtn = $('cameraUseBtn');
  const cameraActions = $('cameraActions');
  const cameraReviewActions = $('cameraReviewActions');
  const cameraViewfinder = $('cameraViewfinder');
  let cameraStream = null;
  let capturedBlob = null;

  attachCameraBtn?.addEventListener('click', () => {
    attachMenu.hidden = true;
    // On mobile, try native camera first (faster experience)
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile && cameraInput) {
      cameraInput.click();
      return;
    }
    // Desktop — open WebRTC camera modal
    openCameraModal();
  });

  async function openCameraModal() {
    if (!cameraModal) return;
    cameraModal.hidden = false;
    cameraModal.setAttribute('aria-hidden', 'false');
    // Reset to capture mode
    cameraPreview.hidden = true;
    cameraVideo.hidden = false;
    cameraPlaceholder.hidden = false;
    cameraActions.hidden = false;
    cameraReviewActions.hidden = true;
    capturedBlob = null;

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false
      });
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
      cameraPlaceholder.hidden = true;
    } catch (err) {
      console.error('Camera access denied:', err);
      cameraPlaceholder.querySelector('span').textContent = 'Camera access denied. Please allow camera permission.';
    }
  }

  function closeCameraModal() {
    if (!cameraModal) return;
    // Stop all camera tracks
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    cameraVideo.srcObject = null;
    cameraModal.hidden = true;
    cameraModal.setAttribute('aria-hidden', 'true');
    capturedBlob = null;
  }

  cameraCloseBtn?.addEventListener('click', closeCameraModal);
  cameraBackdrop?.addEventListener('click', closeCameraModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cameraModal && !cameraModal.hidden) closeCameraModal();
  });

  // Capture photo
  cameraCaptureBtn?.addEventListener('click', () => {
    if (!cameraVideo.srcObject) return;
    const w = cameraVideo.videoWidth;
    const h = cameraVideo.videoHeight;
    cameraCanvas.width = w;
    cameraCanvas.height = h;
    const ctx = cameraCanvas.getContext('2d');
    // Mirror the capture to match the preview
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cameraVideo, 0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Flash effect
    const flash = document.createElement('div');
    flash.className = 'camera-flash';
    cameraViewfinder.appendChild(flash);
    setTimeout(() => flash.remove(), 400);

    // Convert to blob
    cameraCanvas.toBlob((blob) => {
      capturedBlob = blob;
      const url = URL.createObjectURL(blob);
      cameraPreview.src = url;
      cameraPreview.hidden = false;
      cameraVideo.hidden = true;
      // Switch to review mode
      cameraActions.hidden = true;
      cameraReviewActions.hidden = false;
    }, 'image/jpeg', 0.92);
  });

  // Retake
  cameraRetakeBtn?.addEventListener('click', () => {
    cameraPreview.hidden = true;
    cameraVideo.hidden = false;
    cameraActions.hidden = false;
    cameraReviewActions.hidden = true;
    capturedBlob = null;
  });

  // Use photo — add to pending files
  cameraUseBtn?.addEventListener('click', async () => {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `selfie_${Date.now()}.jpg`, { type: 'image/jpeg' });
    await readImageAsBase64(file);
    createImageThumbnail(ConversationManager.getPendingImage(), attachments);
    addFiles([file]);
    closeCameraModal();
    input.focus();
  });

  // Mobile camera fallback input handler
  cameraInput?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    for (const file of imageFiles) {
      await readImageAsBase64(file);
      createImageThumbnail(ConversationManager.getPendingImage(), attachments);
    }
    
    addFiles(files);
    cameraInput.value = '';
    input.focus();
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    dragDepth++;
    app.classList.add('dragging');
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) app.classList.remove('dragging');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    app.classList.remove('dragging');
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  const DRAFT_KEY_PREFIX = 'mls.draft.';

  function saveDraft() {
    const chatId = currentChatId || 'draft_new_chat';
    const text = input.value;
    if (text.trim()) {
      localStorage.setItem(`${DRAFT_KEY_PREFIX}${chatId}`, text);
    } else {
      localStorage.removeItem(`${DRAFT_KEY_PREFIX}${chatId}`);
    }
  }

  function restoreDraft() {
    const chatId = currentChatId || 'draft_new_chat';
    const saved = localStorage.getItem(`${DRAFT_KEY_PREFIX}${chatId}`);
    input.value = saved || '';
    autoSize();
    updateSendState();
  }

  function clearDraft(chatId) {
    const id = chatId || currentChatId || 'draft_new_chat';
    localStorage.removeItem(`${DRAFT_KEY_PREFIX}${id}`);
  }

  function autoSize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }

  function updateSendState() {
    const hasContent = input.value.trim().length > 0 || pendingFiles.length > 0;
    sendBtn.disabled = busy || !hasContent;
  }

  input.addEventListener('input', () => {
    autoSize();
    updateSendState();
    saveDraft();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener('click', send);
  const stopGenerationBtn = document.getElementById('stopGenerationBtn');
  if (stopGenerationBtn) {
    stopGenerationBtn.addEventListener('click', stopGeneration);
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function formatFetchError(err, res) {
    if (err?.name === 'AbortError') {
      const mins = Math.round(REQUEST_TIMEOUT_MS / 60000);
      return `Request timed out after ${mins} minute${mins === 1 ? '' : 's'}. Your workflow may still be running on the server — wait and try again, or raise REQUEST_TIMEOUT_MS in chat.js.`;
    }
    if (res && !res.ok) {
      if ([408, 502, 504, 524].includes(res.status)) {
        return 'The connection timed out before the workflow finished (gateway timeout). Increase proxy/workflow timeouts on your server (nginx, n8n, etc.), then try again.';
      }
      return `Server error (${res.status}${res.statusText ? ` ${res.statusText}` : ''}). Please try again.`;
    }
    return 'Sorry — I couldn\u2019t reach the server. Check your connection and webhook URL, then try again.';
  }

  function showStillWorking(thinkingRow) {
    const bubble = thinkingRow?.querySelector('.bubble');
    if (!bubble || bubble.querySelector('.thinking-note')) return;
    const note = document.createElement('div');
    note.className = 'thinking-note';
    
    // Create animated loading container
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'loading-container';
    loadingContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: center;
      padding: 8px 0;
    `;
    
    // Create animated circle
    const circle = document.createElement('div');
    circle.style.cssText = `
      width: 20px;
      height: 20px;
      border: 3px solid transparent;
      border-top: 3px solid #6366f1;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    `;
    
    // Create text
    const text = document.createElement('span');
    text.textContent = 'Still working';
    text.style.cssText = `
      font-size: 14px;
      color: #666;
      animation: pulse 1.5s ease-in-out infinite;
    `;
    
    // Add animation styles to document if not exists
    if (!document.querySelector('style[data-loading-animation]')) {
      const styleSheet = document.createElement('style');
      styleSheet.setAttribute('data-loading-animation', 'true');
      styleSheet.textContent = `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `;
      document.head.appendChild(styleSheet);
    }
    
    loadingContainer.appendChild(circle);
    loadingContainer.appendChild(text);
    note.appendChild(loadingContainer);
    bubble.appendChild(note);
    scrollToBottom();
  }

  function stopWizardStage() {
    clearInterval(wizardQuipTimer);
    clearTimeout(wizardQuipHideTimer);
    clearTimeout(wizardQuipStartTimer);
    wizardQuipTimer = null;
    wizardQuipHideTimer = null;
    wizardQuipStartTimer = null;
  }

  function showWizardQuip(emptyEl) {
    const bubble = emptyEl.querySelector('#wizardBubble');
    const wrap = emptyEl.querySelector('.wizard-quip-wrap');
    if (!bubble || emptyEl.classList.contains('is-vanishing')) return;
    bubble.textContent = WIZARD_QUIPS[Math.floor(Math.random() * WIZARD_QUIPS.length)];
    bubble.classList.add('is-visible');
    wrap?.classList.add('is-live');
    clearTimeout(wizardQuipHideTimer);
    wizardQuipHideTimer = setTimeout(() => {
      bubble.classList.remove('is-visible');
      wrap?.classList.remove('is-live');
    }, 3200);
  }

  function initWizardStage(emptyEl) {
    if (!emptyEl) return;
    stopWizardStage();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    wizardQuipStartTimer = setTimeout(() => {
      showWizardQuip(emptyEl);
      wizardQuipTimer = setInterval(() => showWizardQuip(emptyEl), 9000);
    }, 1800);
  }

  function dismissEmptyState() {
    const emptyEl = document.getElementById('empty');
    if (!emptyEl || emptyEl.classList.contains('is-vanishing')) {
      return Promise.resolve();
    }
    stopWizardStage();
    return new Promise((resolve) => {
      emptyEl.classList.add('is-vanishing');
      setTimeout(() => {
        emptyEl.remove();
        resolve();
      }, EMPTY_VANISH_MS);
    });
  }

  function bindWizardReactions(container) {
    const stage = container.closest('#empty')?.querySelector('#wizardStage')
      || document.getElementById('wizardStage');
    if (!stage) return;

    container.querySelectorAll('.float-chip, .suggestion').forEach((btn) => {
      btn.addEventListener('mouseenter', () => {
        if (!/fill up my hair/i.test(btn.textContent)) return;
        stage.classList.remove('');
        void stage.offsetWidth;
        stage.classList.add('is-shaking', 'is-error');
        setTimeout(() => stage.classList.remove('is-shaking', 'is-error'), 520);
      });
    });
  }

  function bindSuggestionClicks(container) {
    container.querySelectorAll('.float-chip, .suggestion').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (busy) return;
        input.value = btn.textContent.trim();
        autoSize();
        updateSendState();
        send();
      });
    });
    bindWizardReactions(container);
  }

  function initFloatChips(stage) {
    const floats = stage?.querySelector('#wizardFloats') || stage?.querySelector('.wizard-floats');
    if (!floats || floats.dataset.floatInit) return;
    floats.dataset.floatInit = '1';
    bindSuggestionClicks(floats);

    const chips = [...floats.querySelectorAll('.float-chip')];
    chips.forEach((chip, i) => {
      setTimeout(() => chip.classList.add('is-visible'), 120 + i * 140);
    });

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      chips.forEach((c) => c.classList.add('is-visible'));
      return;
    }

    let index = 0;
    let timer = null;
    let paused = false;

    function highlight(i) {
      chips.forEach((c, j) => c.classList.toggle('is-hot', j === i));
    }

    function tick() {
      if (paused || !chips.length) return;
      index = (index + 1) % chips.length;
      highlight(index);
    }

    highlight(0);
    timer = setInterval(tick, 2800);
    floats.addEventListener('mouseenter', () => { paused = true; });
    floats.addEventListener('mouseleave', () => { paused = false; });
    chips.forEach((chip, i) => {
      chip.addEventListener('mouseenter', () => highlight(i));
    });
  }

  function setupFloatChips(root = document) {
    const stage = root.querySelector?.('#wizardStage') || (root.id === 'wizardStage' ? root : null);
    if (stage) initFloatChips(stage);
  }

  function setupEmptyState(root = document) {
    const emptyEl = root.id === 'empty' ? root : root.querySelector?.('#empty');
    if (emptyEl) initWizardStage(emptyEl);
    setupFloatChips(emptyEl || root);
  }

  setupEmptyState();

  async function newChat() {
    const user = getFrontendUser();
    const userUid = user?.uid || user?.id || 'anonymous';
    
    currentChatId = null;
    currentSessionId = 'new';
    localStorage.removeItem('mls.chatId');
    
    window.history.pushState(null, '', '/chat');
    openChatRuntimeSession(currentSessionId);
    
    ConversationManager.clearHistory();
    
    if (chatInner) {
      chatInner.remove();
      chatInner = null;
    }
    if (!document.getElementById('empty')) {
      const e = buildEmpty();
      chat.appendChild(e);
      setupEmptyState(e);
    }
    
    pendingFiles = [];
    renderAttachments();
    restoreDraft();
    closeSidebar();
    
    renderRecents();
  }

  function buildEmpty() {
    const wrap = document.createElement('div');
    wrap.className = 'empty';
    wrap.id = 'empty';
    wrap.innerHTML = `
      <div class="wizard-arena">
        <div class="wizard-quip-wrap">
          <div class="wizard-bubble" id="wizardBubble" aria-hidden="true"></div>
          <div class="wizard-quip-beam" aria-hidden="true"></div>
        </div>
        <div class="wizard-stage" id="wizardStage">
          <div class="wizard-glow" aria-hidden="true"></div>
          <div class="wizard-smoke" aria-hidden="true"></div>
          <div class="wizard-floats" id="wizardFloats">
            <button type="button" class="float-chip premium-content-chip" data-slot="0">
              <span class="premium-chip-text">Generate 6 months of content</span>
              <img class="premium-crown" src="/premium-crown.png" alt="" aria-hidden="true" />
            </button>
            <button type="button" class="float-chip" data-slot="1">Make my Picture Looks Professional</button>
            <button type="button" class="float-chip" data-slot="2">Generate a catchy Hooks</button>
            <button type="button" class="float-chip" data-slot="3">Create a story about trending topics</button>
          </div>
          <img class="wizard-img" src="${wizardImageUrl}" alt="Mate Louis wizard" width="280" height="320" />
        </div>
      </div>
      <div class="empty-copy">
        <h1 class="empty-title">So smart it probably ignores your bad ideas.</h1>
        <p class="empty-sub">How can I help today?</p>
      </div>`;
    return wrap;
  }

  newChatBtn.addEventListener('click', newChat);

  // Topbar export dropdown
  if (topbarExportBtn && topbarExportDropdown) {
    topbarExportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      topbarExportDropdown.classList.toggle('open');
    });
    topbarExportDropdown.querySelectorAll('.export-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        topbarExportDropdown.classList.remove('open');
        const action = item.dataset.action;
        const filter = item.dataset.filter;
        if (action === 'copy') exportCopy(filter);
        else if (action === 'pdf') exportPDF(filter);
      });
    });
    document.addEventListener('click', () => topbarExportDropdown.classList.remove('open'));
  }

  function normalizeN8nResponse(data) {
    if (!data) {
      return {
        output: 'No response received',
        isImage: false
      };
    }

    // If backend/n8n already returns the expected format, keep it
    if (typeof data.output === 'string') {
      return data;
    }

    // Your n8n text response: { reply, stage }
    if (typeof data.reply === 'string') {
      return {
        ...data,
        output: data.reply,
        isImage: false
      };
    }

    // Some branches may return { message }
    if (typeof data.message === 'string') {
      return {
        ...data,
        output: data.message,
        isImage: false
      };
    }

    // Your n8n image response: { images: [{ type, base64 }] }
    if (Array.isArray(data.images) && data.images.length > 0) {
      const firstImage = data.images.find(img => img?.base64) || data.images[0];

      if (firstImage?.base64) {
        const imageSrc = firstImage.base64.startsWith('data:')
          ? firstImage.base64
          : `data:image/png;base64,${firstImage.base64}`;

        return {
          ...data,
          output: imageSrc,
          isImage: true
        };
      }
    }

    // Your n8n thumbnail-only image response
    if (typeof data.thumbnail_only === 'string' && data.thumbnail_only.length > 100) {
      const imageSrc = data.thumbnail_only.startsWith('data:')
        ? data.thumbnail_only
        : `data:image/png;base64,${data.thumbnail_only}`;

      return {
        ...data,
        output: imageSrc,
        isImage: true
      };
    }

    // Fallback
    return {
      ...data,
      output: JSON.stringify(data, null, 2),
      isImage: false
    };
  }

  let lastSendTime = 0;
  const SEND_RATE_LIMIT_MS = 1500;

  async function send() {
    if (busy) return;
    // Rate limiting: prevent spamming
    const now = Date.now();
    if (now - lastSendTime < SEND_RATE_LIMIT_MS) return;
    lastSendTime = now;
    const text = input.value.trim();
    if (!text && !pendingFiles.length) return;

    await dismissEmptyState();

    const images = pendingFiles.map(f => f.dataUrl);
    
    let imageRef = null;
    if (pendingFiles.length > 0) {
      const firstDataUrl = pendingFiles[0].dataUrl;
      imageRef = 'img_' + generateUUID();
      ImageCache.saveImage(imageRef, firstDataUrl);
      ConversationManager.setPendingImage(firstDataUrl, imageRef);
    }
    
    let chatId = currentChatId;
    const user = getFrontendUser();
    const userUid = user?.uid || user?.id || 'anonymous';

    // Lazy creation: generate chat ID and create document in Firestore on the first message
    if (!chatId) {
      chatId = generateUUID();
      currentChatId = chatId;
      currentSessionId = chatId;
      localStorage.setItem('mls.chatId', chatId);
      window.history.replaceState(null, '', `/chat/${chatId}`);
      openChatRuntimeSession(currentSessionId);
      
      if (db) {
        try {
          await setDoc(doc(db, 'chats', chatId), {
            uid: userUid,
            user_id: userUid,
            title: 'New Chat',
            pinned: false,
            customTitle: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
          console.log('Firestore: lazily created chat document on first message');
        } catch (err) {
          console.error('Error creating chat lazily in Firestore:', err);
        }
      }
    }

    const requestSessionId = chatId;
    const requestImageGen = isImageGenerationRequest(text);
    addUserMessage(text, images);
    ConversationManager.addMessage('user', text, imageRef || ConversationManager.pendingImageRef || ConversationManager.pendingImage || null, chatId, true);
    await touchUserSession(userUid, chatId, text || 'Image message');

    const skeletonRow = addSkeletonMessage(requestImageGen || pendingFiles.length ? 'image' : 'text', requestSessionId);

    clearDraft('draft_new_chat');
    clearDraft(chatId);
    input.value = '';
    pendingFiles = [];
    renderAttachments();
    autoSize();

    busy = true;
    sendBtn.classList.add('loading');
    updateSendState();

    // Show stop generation button
    const stopBtn = document.getElementById('stopGenerationBtn');
    if (stopBtn) stopBtn.classList.add('visible');

    const pending = {
      chatId,
      row: skeletonRow,
      response: null,
      error: null,
      poller: null
    };
    pendingSessions.set(requestSessionId, pending);

    pending.poller = setInterval(() => {
      const currentPending = pendingSessions.get(requestSessionId);
      if (!currentPending) return;
      if (!currentPending.response && !currentPending.error) return;

      clearPendingSession(requestSessionId);
      busy = false;
      sendBtn.classList.remove('loading');
      const stopBtn2 = document.getElementById('stopGenerationBtn');
      if (stopBtn2) stopBtn2.classList.remove('visible');
      updateSendState();
      input.focus();

      if (currentPending.error) {
        ConversationManager.clearPendingImage();
        if (currentPending.row?.isConnected && currentSessionId === currentPending.chatId) {
          renderResponseIntoSkeleton(currentPending, {
            output: `Error: ${currentPending.error.message || 'Failed to send message'}`,
            isImage: false,
            sessionId: requestSessionId
          });
        } else {
          currentPending.row?.remove();
        }
        console.error(currentPending.error);
        return;
      }

      const responseSessionId = extractResponseSessionId(currentPending.response) || requestSessionId;
      if (responseSessionId !== requestSessionId) {
        ConversationManager.clearPendingImage();
        currentPending.row?.remove();
        return;
      }

      const addToMemory = currentSessionId === currentPending.chatId;
      ConversationManager.processResponse(text, currentPending.response, {
        chatId: currentPending.chatId,
        addToMemory
      });

      if (!addToMemory) {
        currentPending.row?.remove();
        return;
      }

      renderResponseIntoSkeleton(currentPending, currentPending.response);

      // Trigger background memory extraction and summarization on successful assistant reply
      if (currentPending.response && currentPending.response.output) {
        MemoryManager.extractMemories(userUid, text, currentPending.response.output);
        Summarizer.summarizeChat(userUid, currentPending.chatId);
      }
    }, 1000);

    // Assemble the complete context prompt before sending to the webhook
    ContextAssembler.assemble(userUid, chatId, text)
      .then((assembledPrompt) => {
        return ConversationManager.sendToWebhook(assembledPrompt, requestSessionId);
      })
      .then((response) => {
        const currentPending = pendingSessions.get(requestSessionId);
        if (currentPending) {
          currentPending.response = response;
        }
      })
      .catch((err) => {
        const currentPending = pendingSessions.get(requestSessionId);
        if (currentPending) {
          currentPending.error = err;
        }
      });
  }

  // Current AbortController for the active request
  let currentAbortController = null;

  function stopGeneration() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    // Clear all pending sessions
    pendingSessions.forEach((pending, key) => {
      if (pending.poller) clearInterval(pending.poller);
      if (pending.row?.isConnected) {
        const bubble = pending.row.querySelector('.bubble');
        if (bubble) {
          bubble.innerHTML = '';
          bubble.classList.remove('skeleton-bubble');
          const textEl = document.createElement('div');
          textEl.className = 'ai-text';
          textEl.textContent = pending.response?.output || '';
          bubble.appendChild(textEl);
        }
      }
    });
    pendingSessions.clear();
    busy = false;
    sendBtn.classList.remove('loading');
    updateSendState();
    // Add system notice
    const inner = ensureInner();
    const notice = document.createElement('div');
    notice.className = 'system-notice';
    notice.innerHTML = '<span class="system-notice-text">Response generation stopped.</span>';
    inner.appendChild(notice);
    scrollToBottom();
    // Hide stop button
    const stopBtn = document.getElementById('stopGenerationBtn');
    if (stopBtn) stopBtn.classList.remove('visible');
    input.focus();
  }

  function setupMobileViewport() {
    const setVvh = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--vvh', `${h}px`);
    };
    setVvh();
    window.addEventListener('resize', setVvh);
    window.visualViewport?.addEventListener('resize', setVvh);
    window.visualViewport?.addEventListener('scroll', setVvh);
  }

  function setupMobileKeyboard() {
    const composerWrap = document.querySelector('.composer-wrap');
    if (!composerWrap || !window.visualViewport) return;
    const onViewportChange = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const keyboardLikelyOpen = vv.height < window.innerHeight * 0.82;
      if (keyboardLikelyOpen && document.activeElement === input) {
        requestAnimationFrame(() => {
          composerWrap.scrollIntoView({ block: 'end', behavior: 'smooth' });
        });
      }
    };
    window.visualViewport.addEventListener('resize', onViewportChange);
    input.addEventListener('focus', onViewportChange);
  }

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // Global error handlers for unhandled errors
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection:', e.reason);
  });
  window.addEventListener('error', (e) => {
    console.error('Unhandled error:', e.error);
  });

  // Offline/online detection
  window.addEventListener('offline', () => {
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#ef4444;color:#fff;text-align:center;padding:8px;font-size:13px;font-weight:500;';
    banner.textContent = 'You are offline. Messages will not be sent.';
    document.body.appendChild(banner);
  });
  window.addEventListener('online', () => {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.remove();
  });

  setupMobileViewport();
  setupMobileKeyboard();
  setupServiceWorker();

  // Onboarding tour for first-time users
  function showOnboarding() {
    if (localStorage.getItem('mls.onboarded')) return;
    const steps = [
      { selector: '.wizard-floats', text: 'Click any suggestion to start a conversation!', position: 'bottom' },
      { selector: '#attachBtn', text: 'Attach images for AI to analyze or enhance.', position: 'top' },
      { selector: '#menuToggle', text: 'Open the sidebar to see your chat history.', position: 'right' }
    ];
    let currentStep = 0;
    function showStep(idx) {
      document.querySelectorAll('.onboarding-tooltip').forEach(t => t.remove());
      if (idx >= steps.length) {
        localStorage.setItem('mls.onboarded', 'true');
        return;
      }
      const step = steps[idx];
      const target = document.querySelector(step.selector);
      if (!target) { showStep(idx + 1); return; }
      const tooltip = document.createElement('div');
      tooltip.className = 'onboarding-tooltip';
      tooltip.innerHTML = `
        <div class="onboarding-text">${step.text}</div>
        <div class="onboarding-actions">
          <span class="onboarding-counter">${idx + 1}/${steps.length}</span>
          <button class="onboarding-skip">Skip</button>
          <button class="onboarding-next">${idx === steps.length - 1 ? 'Done' : 'Next'}</button>
        </div>
      `;
      const rect = target.getBoundingClientRect();
      tooltip.style.position = 'fixed';
      tooltip.style.zIndex = '10000';
      if (step.position === 'bottom') {
        tooltip.style.top = (rect.bottom + 12) + 'px';
        tooltip.style.left = Math.max(12, rect.left) + 'px';
      } else if (step.position === 'top') {
        tooltip.style.bottom = (window.innerHeight - rect.top + 12) + 'px';
        tooltip.style.left = Math.max(12, rect.left) + 'px';
      } else {
        tooltip.style.top = rect.top + 'px';
        tooltip.style.left = (rect.right + 12) + 'px';
      }
      document.body.appendChild(tooltip);
      tooltip.querySelector('.onboarding-next').addEventListener('click', () => showStep(idx + 1));
      tooltip.querySelector('.onboarding-skip').addEventListener('click', () => {
        localStorage.setItem('mls.onboarded', 'true');
        document.querySelectorAll('.onboarding-tooltip').forEach(t => t.remove());
      });
    }
    setTimeout(() => showStep(0), 1500);
  }
  showOnboarding();

  // Session expiration listener
  window.addEventListener('session-expired', () => {
    if (confirm('Your session has expired. Would you like to sign in again?')) {
      window.location.href = '/login';
    }
  });

  autoSize();
  updateSendState();
})();
