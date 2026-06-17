import React from 'react';
import MessageRenderer from './MessageRenderer';
import './professional-table.css'; // Make sure to import the CSS

/**
 * Example Usage - Professional Table Display
 */ 
export default function TableExample() {
  // Example 1: With title and emoji
  const exampleTable1 = `### 💎 Emotional Blueprint Table

| Fears | Frustrations | Dreams | Desires |
| :--- | :--- | :--- | :--- |
| Running out of money before the business works | No clear roadmap for building a coaching business | Building a profitable coaching business with freedom and flexibility | Clear step-by-step guidance for building the business |
| Being "too old" to start over successfully | Posting online with little or no engagement | Becoming recognized as a respected expert in their field | Confidence in pricing, selling, and marketing themselves |
| Looking inexperienced online despite years of expertise | Feeling invisible in a crowded coaching market | Creating meaningful work aligned with their purpose | A proven framework that removes guesswork |
| Fear of visibility and judgment online | Too many conflicting marketing strategies online | Replacing corporate income doing work they love | Emotional support and mentorship during transition |
| Choosing the wrong niche and limiting opportunities | Difficulty turning expertise into a clear offer | Speaking confidently on stages, podcasts, or online | Visibility without feeling fake or performative |
| Failing after investing in more programs | Fear stopping them from taking consistent action | Having clients consistently seek them out | A strong personal brand and signature methodology |
| Not getting clients consistently | Lack of structure and accountability | Writing a book or becoming a thought leader | Community and connection with like-minded women |
| Looking salesy, pushy, or inauthentic | Referrals drying up and no lead generation | Creating a business aligned with their values and lifestyle | Predictable lead generation and client attraction |
| Feeling overwhelmed by technology and marketing | Spending money on programs without real results | Feeling confident, empowered, and financially secure | Structure, accountability, and momentum |
| Losing confidence and returning to a corporate job | Feeling isolated and unsupported | Reinventing themselves powerfully in midlife | Feeling respected, relevant, and fulfilled again |`;

  // Example 2: Using in chat messages
  const chatMessages = [
    {
      type: 'user',
      text: 'Show me the coaching business buyer persona'
    },
    {
      type: 'ai',
      text: exampleTable1
    }
  ];

  return (
    <div className="example-container">
      <h1>Professional Table Example</h1>
      
      {/* Example rendering */}
      <div className="example-message">
        <MessageRenderer content={exampleTable1} />
      </div>

      {/* Chat simulation */}
      <div className="example-chat">
        <h2>In Chat Context</h2>
        {chatMessages.map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.type}`}>
            <MessageRenderer content={msg.text} />
          </div>
        ))}
      </div>

      {/* Integration Guide */}
      <div className="integration-guide">
        <h2>Integration Steps</h2>
        <ol>
          <li>Import CSS: <code>import './professional-table.css'</code></li>
          <li>Import component: <code>import MessageRenderer from './MessageRenderer'</code></li>
          <li>Use in render: <code>&lt;MessageRenderer content={message} /&gt;</code></li>
          <li>Webhook returns markdown with title and table</li>
        </ol>
      </div>
    </div>
  );
}

/* CSS for example styles */
const exampleStyles = `
.example-container {
  padding: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.example-message {
  margin: 20px 0;
}

.example-chat {
  margin: 30px 0;
}

.chat-message {
  margin: 16px 0;
  border-radius: 8px;
}

.chat-message.user {
  margin-left: 40px;
  padding: 12px 16px;
  background: #e2e8f0;
  border-radius: 8px;
  color: #0f172a;
}

.integration-guide {
  background: #f1f5f9;
  padding: 20px;
  border-radius: 8px;
  margin-top: 30px;
}

.integration-guide code {
  background: #e2e8f0;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}
`;
