import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Complete React Chat Component with Markdown Table Support
 */
export default function ChatApp() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const chatRef = useRef(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  /**
   * Detect and convert HTML tables to markdown
   */
  function htmlToMarkdownTable(htmlContent) {
    try {
      if (!htmlContent.includes('<table') && !htmlContent.includes('</table>')) {
        return null;
      }

      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      const table = doc.querySelector('table');
      
      if (!table) return null;

      let markdown = '| ';
      
      // Extract headers
      const headers = table.querySelectorAll('thead th, tr:first-child th');
      if (headers.length === 0) return null;

      headers.forEach(th => {
        markdown += th.textContent.trim() + ' | ';
      });
      markdown += '\n|';
      
      // Add separator
      headers.forEach(() => {
        markdown += ' --- |';
      });
      markdown += '\n';

      // Extract body rows
      const tbody = table.querySelector('tbody');
      const rows = tbody ? tbody.querySelectorAll('tr') : table.querySelectorAll('tr:not(:first-child)');
      
      rows.forEach(row => {
        markdown += '| ';
        const cells = row.querySelectorAll('td');
        cells.forEach(cell => {
          markdown += cell.textContent.trim() + ' | ';
        });
        markdown += '\n';
      });

      return markdown;
    } catch (err) {
      console.error('Error converting HTML table:', err);
      return null;
    }
  }

  /**
   * Message Renderer Component
   */
  function MessageRenderer({ content }) {
    if (typeof content === 'string' && content.includes('<')) {
      const markdownTable = htmlToMarkdownTable(content);
      
      if (markdownTable) {
        return (
          <div className="markdown-table-container">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {markdownTable}
            </ReactMarkdown>
          </div>
        );
      }

      if (content.includes('|') && content.includes('---')) {
        return (
          <div className="markdown-table-container">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        );
      }
    }

    // Plain text or markdown
    return (
      <div className="message-text">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  /**
   * Send message to webhook
   */
  async function sendMessage() {
    if (!input.trim() && pendingFiles.length === 0) return;

    const userMessage = {
      type: 'user',
      text: input,
      images: pendingFiles.map(f => f.dataUrl),
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setPendingFiles([]);
    setBusy(true);

    // Add thinking state
    setMessages(prev => [...prev, { type: 'thinking' }]);

    try {
      // Call your webhook
      const response = await fetch('YOUR_WEBHOOK_URL', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          images: pendingFiles.map(f => f.dataUrl)
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      
      // Remove thinking message
      setMessages(prev => prev.filter(m => m.type !== 'thinking'));

      // Add AI response
      setMessages(prev => [...prev, {
        type: 'ai',
        text: data.text || data.message,
        images: data.images || []
      }]);

    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'thinking'));
      setMessages(prev => [...prev, {
        type: 'ai',
        text: `Error: ${err.message}`
      }]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Handle file uploads
   */
  function handleFileUpload(files) {
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPendingFiles(prev => [...prev, {
            id: Math.random(),
            dataUrl: e.target.result
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }

  return (
    <div className="chat-container">
      <div className="chat" ref={chatRef}>
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.type}`}>
            {msg.type === 'thinking' && (
              <div className="thinking">
                <span></span><span></span><span></span>
              </div>
            )}
            {msg.text && (
              <div className="bubble">
                <MessageRenderer content={msg.text} />
              </div>
            )}
            {msg.images && msg.images.length > 0 && (
              <div className="bubble-images">
                {msg.images.map((img, i) => (
                  <img key={i} src={img} alt="" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        {pendingFiles.length > 0 && (
          <div className="attachments">
            {pendingFiles.map(f => (
              <div key={f.id} className="attach-card">
                <img src={f.dataUrl} alt="" />
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => handleFileUpload(e.target.files)}
            style={{ display: 'none' }}
            id="fileInput"
          />
          <button onClick={() => document.getElementById('fileInput').click()}>
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Type your message..."
            disabled={busy}
          />
          <button
            onClick={sendMessage}
            disabled={busy || (!input.trim() && pendingFiles.length === 0)}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
