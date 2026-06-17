import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ProfessionalTable from './ProfessionalTable';

/**
 * Extract title from markdown (### format)
 */
function extractTitle(content) {
  const titleMatch = content.match(/^#+\s+(.+?)(\n|$)/);
  return titleMatch ? titleMatch[1] : null;
}

/**
 * Remove title from markdown
 */
function removeTitle(content) {
  return content.replace(/^#+\s+.+?(\n|$)/, '').trim();
}

/**
 * Detects if content is HTML and extracts markdown table format
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
    console.error('Error converting HTML table to markdown:', err);
    return null;
  }
}

/**
 * MessageRenderer - Handles plain text, markdown, and professional tables
 */
export default function MessageRenderer({ content }) {
  if (!content || typeof content !== 'string') {
    return <div className="message-text">-</div>;
  }

  // Check if it's a markdown table with title
  if (content.includes('### ') && content.includes('|') && content.includes('---')) {
    const title = extractTitle(content);
    const tableMarkdown = removeTitle(content);
    
    if (title) {
      return (
        <ProfessionalTable 
          title={title} 
          markdown={tableMarkdown}
          content={content}
        />
      );
    }
  }

  // Check if content is HTML with table
  if (content.includes('<')) {
    const markdownTable = htmlToMarkdownTable(content);
    
    if (markdownTable) {
      return (
        <div className="professional-table-wrapper">
          <div className="professional-table-container">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {markdownTable}
            </ReactMarkdown>
          </div>
        </div>
      );
    }
  }

  // Check if it's markdown table format
  if (content.includes('|') && content.includes('---')) {
    return (
      <div className="professional-table-wrapper">
        <div className="professional-table-container">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // Plain text - render as is
  return <div className="message-text">{content}</div>;
}
