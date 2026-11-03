import { describe, expect, it } from 'vitest';

import { escapeHtml } from '../packages/web/src/escape';

describe('escapeHtml', () => {
  it('转义标签，防止昵称注入 HTML', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('转义引号，防止属性逃逸', () => {
    expect(escapeHtml('" onclick="alert(1)')).toBe('&quot; onclick=&quot;alert(1)');
    expect(escapeHtml("' onmouseover='alert(1)")).toBe('&#39; onmouseover=&#39;alert(1)');
  });

  it('& 只转义一次，不会二次编码', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('普通昵称与非字符串输入都安全', () => {
    expect(escapeHtml('玩家')).toBe('玩家');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});