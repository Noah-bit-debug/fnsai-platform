/**
 * Small, safe markdown renderer for AI chat bubbles.
 *
 * Design:
 *   1. HTML-escape the raw AI output FIRST. Any prompt-injection like
 *      <script> or <img onerror=...> is neutralized before we do anything.
 *   2. Strip the internal {"needs_clarification": ...} JSON block — that's
 *      a backend protocol for logging knowledge gaps, not user-facing content.
 *   3. Apply markdown regex to the escaped string. Only the tags we emit
 *      ourselves survive, so the output is safe for dangerouslySetInnerHTML.
 *
 * Supported subset (sufficient for AI responses we see in practice):
 *   - # / ## / ### headers
 *   - **bold** and *italic*
 *   - `inline code` and ```code blocks```
 *   - - bullet lists and 1. numbered lists
 *   - --- horizontal rules
 *   - Paragraphs and line breaks
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The AI Brain system prompt instructs Claude to end responses with a
// JSON block like {"needs_clarification": true, ...} when it doesn't know
// something. The backend parses that and logs a clarification record;
// showing it in the chat bubble is noise. Strip any trailing JSON block
// that starts with "needs_clarification".
function stripClarificationJson(s: string): string {
  // Match an optional ```json fence, a {...} object containing needs_clarification,
  // and any trailing newlines / closing fence. Non-greedy inside {}.
  return s.replace(
    /\n*```?json?\s*\{[^}]*"needs_clarification"[\s\S]*?\}\s*```?\s*$/i,
    ''
  ).replace(
    /\n*\{[^}]*"needs_clarification"[\s\S]*?\}\s*$/i,
    ''
  ).trim();
}

export function renderMarkdown(raw: string): string {
  if (!raw) return '';

  // 1. Strip backend-protocol JSON
  const cleaned = stripClarificationJson(raw);

  // 2. Escape HTML
  let html = escapeHtml(cleaned);

  // 3. Code blocks (```...```) — protect them from other regexes by
  //    replacing with placeholders, then restoring at the end.
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(code);
    return `§§CODE${i}§§`;
  });

  // 4. Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');

  // 5. Headers (must come before bold because # is at line start)
  html = html
    .replace(/^### (.+)$/gm, '<h4 class="md-h3">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 class="md-h2">$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2 class="md-h1">$1</h2>');

  // 6. Horizontal rule
  html = html.replace(/^---$/gm, '<hr class="md-hr" />');

  // 7. Bold and italic (bold first so ** doesn't get mistaken for two *'s)
  html = html
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*([^*\n]+)\*(?!\w)/g, '<em>$1</em>');

  // 8. Bullet lists — gather consecutive "- " lines into a <ul>
  html = html.replace(
    /(^|\n)((?:- .+(?:\n|$))+)/g,
    (_, pre: string, block: string) => {
      const items = block
        .trim()
        .split('\n')
        .map(line => `<li>${line.replace(/^- /, '')}</li>`)
        .join('');
      return `${pre}<ul class="md-ul">${items}</ul>`;
    }
  );

  // 9. Numbered lists
  html = html.replace(
    /(^|\n)((?:\d+\. .+(?:\n|$))+)/g,
    (_, pre: string, block: string) => {
      const items = block
        .trim()
        .split('\n')
        .map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`)
        .join('');
      return `${pre}<ol class="md-ol">${items}</ol>`;
    }
  );

  // 10. Paragraphs / line breaks (after block-level handling)
  //     Two newlines -> paragraph break; single newline -> <br/>
  html = html.replace(/\n\n+/g, '</p><p class="md-p">');
  html = html.replace(/\n/g, '<br/>');
  html = `<p class="md-p">${html}</p>`;

  // 11. Restore code blocks
  html = html.replace(/§§CODE(\d+)§§/g, (_, i: string) =>
    `<pre class="md-pre"><code>${codeBlocks[Number(i)]}</code></pre>`
  );

  return html;
}
