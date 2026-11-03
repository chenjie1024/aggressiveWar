/**
 * 把任意字符串转成可安全放进 innerHTML 的文本。
 *
 * 用途：任何来自对端（联机昵称、远端排行榜、URL 参数）的字符串，插入 HTML 前都要过一遍。
 * 我们宁可多转义几个字符，也不想因为一个昵称丢掉整个 XSS 面。
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
