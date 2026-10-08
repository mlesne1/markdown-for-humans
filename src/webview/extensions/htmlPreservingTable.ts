/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import type { JSONContent, MarkdownRendererHelpers, RenderContext } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';

type RenderMarkdownFn = (
  node: JSONContent,
  helpers: MarkdownRendererHelpers,
  ctx: RenderContext
) => string;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Flatten a cell to HTML text, emitting real `<br>` for hardBreaks.
 *
 * WHY: A literal `\n` inside `<td>` is collapsible whitespace in HTML/CSS, so
 * Enter→hardBreak would silently lose the visible line break on save/reload.
 * Escaping must apply only to text nodes — never to the `<br>` we insert.
 */
function renderCellInnerHtml(node: JSONContent): string {
  if (!node || typeof node !== 'object') {
    return '';
  }

  if (node.type === 'text') {
    const text = escapeHtml(typeof node.text === 'string' ? node.text : '');
    const colorMark = node.marks?.find(mark => mark.type === 'htmlColor');
    const color = colorMark?.attrs?.color;
    if (
      typeof color === 'string' &&
      /^(#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\)|[a-z]+)$/i.test(color)
    ) {
      return `<span style="color: ${escapeHtml(color)}">${text}</span>`;
    }
    return text;
  }

  if (node.type === 'hardBreak' || node.type === 'hard_break') {
    return '<br>';
  }

  if (node.type === 'bulletList') {
    return `<ul>${(node.content ?? []).map(renderCellInnerHtml).join('')}</ul>`;
  }

  if (node.type === 'orderedList') {
    const start = Number.isSafeInteger(node.attrs?.start) ? (node.attrs?.start as number) : 1;
    const startAttribute = start > 1 ? ` start="${start}"` : '';
    return `<ol${startAttribute}>${(node.content ?? []).map(renderCellInnerHtml).join('')}</ol>`;
  }

  if (node.type === 'listItem') {
    return `<li>${(node.content ?? []).map(renderCellInnerHtml).join('')}</li>`;
  }

  if (!Array.isArray(node.content)) {
    return '';
  }

  return node.content.map(renderCellInnerHtml).join('');
}

/** Keep literal cell pipes from becoming GFM column delimiters on the next parse. */
function escapeUnescapedTablePipes(value: string): string {
  let escaped = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '|') {
      escaped += character;
      continue;
    }

    let precedingBackslashes = 0;
    for (
      let precedingIndex = index - 1;
      precedingIndex >= 0 && value[precedingIndex] === '\\';
      precedingIndex -= 1
    ) {
      precedingBackslashes += 1;
    }
    escaped += precedingBackslashes % 2 === 0 ? '\\|' : '|';
  }

  return escaped;
}

function renderTableCellSpanAttributes(cell: JSONContent): string {
  const attributes: string[] = [];
  const colspan = cell.attrs?.colspan;
  const rowspan = cell.attrs?.rowspan;

  if (Number.isSafeInteger(colspan) && (colspan as number) > 1) {
    attributes.push(`colspan="${colspan as number}"`);
  }
  if (Number.isSafeInteger(rowspan) && (rowspan as number) > 1) {
    attributes.push(`rowspan="${rowspan as number}"`);
  }

  return attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
}

function getTableColumnWidths(rows: JSONContent[]): Array<number | null> {
  const widths: Array<number | null> = [];

  for (const row of rows) {
    const cells = Array.isArray(row.content) ? row.content : [];
    let columnIndex = 0;

    for (const cell of cells) {
      const colspan =
        Number.isSafeInteger(cell.attrs?.colspan) && (cell.attrs?.colspan as number) > 1
          ? (cell.attrs?.colspan as number)
          : 1;
      const cellWidths = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : [];

      for (let spanIndex = 0; spanIndex < colspan; spanIndex += 1) {
        const width = cellWidths[spanIndex];
        if (widths[columnIndex + spanIndex] == null && Number.isSafeInteger(width) && width > 0) {
          widths[columnIndex + spanIndex] = width;
        }
      }

      columnIndex += colspan;
    }
  }

  return widths;
}

function containsBlockList(node: JSONContent): boolean {
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return true;
  }
  return Array.isArray(node.content) && node.content.some(containsBlockList);
}

function renderTableColumnGroup(widths: Array<number | null>): string {
  if (!widths.some(width => width !== null)) return '';
  const columns = widths
    .map(width => (width === null ? '<col>' : `<col width="${width}">`))
    .join('');
  return `<colgroup>${columns}</colgroup>`;
}

function renderTableCell(cell: JSONContent, tagName: 'th' | 'td'): string {
  // Trim only leading/trailing spaces and tabs so edge hardBreaks (`<br>`) stay.
  const innerHtml = renderCellInnerHtml(cell).replace(/^[ \t]+|[ \t]+$/g, '');
  const spanAttributes = renderTableCellSpanAttributes(cell);
  return `<${tagName}${spanAttributes}>${innerHtml}</${tagName}>`;
}

export const HtmlPreservingTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      htmlClass: {
        default: null,
        rendered: false,
        parseHTML: element => element.getAttribute('class'),
      },
      htmlOrigin: {
        default: false,
        rendered: false,
        // Any table built from DOM came from HTML — except one markdown-it
        // rendered from pipe syntax, which the paste pipeline tags. Without
        // that exemption a pasted markdown table (or one converted from HTML
        // at the user's request) would be saved back as `<table>` markup.
        parseHTML: element => element.getAttribute('data-markdown-table') !== 'true',
      },
    };
  },

  // Must be a regular function (not an arrow function) so that TipTap's
  // getExtensionField correctly binds `this.parent` to the base Table extension's
  // GFM renderMarkdown. Arrow functions ignore .bind(), so this.parent would be
  // undefined and GFM tables would be silently dropped on serialization.
  renderMarkdown: function (
    this: { parent?: RenderMarkdownFn | null },
    node: JSONContent,
    helpers: MarkdownRendererHelpers,
    context: RenderContext
  ): string {
    const htmlOrigin = Boolean(node.attrs?.htmlOrigin);
    const rows = Array.isArray(node.content) ? node.content : [];
    const columnWidths = getTableColumnWidths(rows);
    const hasColumnWidths = columnWidths.some(width => width !== null);
    const hasBlockLists = rows.some(
      row => Array.isArray(row.content) && row.content.some(containsBlockList)
    );

    if (!htmlOrigin && !hasColumnWidths && !hasBlockLists) {
      // TipTap 3.30.5 did not escape literal pipes returned by renderChildren,
      // so its table output could create extra columns. 3.31.4 escapes them
      // too and leaves already-escaped pipes alone, so this stays a safe guard.
      const pipeSafeHelpers: MarkdownRendererHelpers = {
        ...helpers,
        renderChildren: (children, separator) =>
          escapeUnescapedTablePipes(helpers.renderChildren(children, separator)),
      };
      return this.parent ? this.parent.call(this, node, pipeSafeHelpers, context) : '';
    }

    const className =
      typeof node.attrs?.htmlClass === 'string' && node.attrs.htmlClass.trim().length > 0
        ? node.attrs.htmlClass.trim()
        : null;

    const rowHtml = rows
      .map(row => {
        const cells = Array.isArray(row.content) ? row.content : [];
        const cellsHtml = cells
          .map(cell => renderTableCell(cell, cell.type === 'tableHeader' ? 'th' : 'td'))
          .join('');
        return `  <tr>${cellsHtml}</tr>`;
      })
      .join('\n');

    const tableOpenTag = className ? `<table class="${escapeHtml(className)}">` : '<table>';
    const columnGroup = renderTableColumnGroup(columnWidths);

    return `${tableOpenTag}\n${columnGroup ? `  ${columnGroup}\n` : ''}${rowHtml}\n</table>`;
  },
});
