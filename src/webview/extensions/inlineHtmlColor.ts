/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Mark, isValidCSSStyleValue } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';

function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string' || !isValidCSSStyleValue(value)) return null;
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color || null;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export const HtmlColor = Mark.create({
  name: 'htmlColor',
  priority: 85,
  inclusive: false,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) => normalizeColor(element.style.color),
        renderHTML: (attributes: { color?: unknown }) => {
          const color = normalizeColor(attributes.color);
          return color ? { style: `color: ${color}` } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[style*="color"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },

  renderMarkdown: ((
    node: JSONContent,
    helpers: { renderChildren: (node: JSONContent) => string }
  ) => {
    const color = normalizeColor(node.attrs?.color);
    if (!color) return helpers.renderChildren(node);
    return `<span style="color: ${escapeAttribute(color)}">${helpers.renderChildren(node)}</span>`;
  }) as unknown as never,
});
