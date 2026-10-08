/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import type { Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';

export const MIN_TABLE_COLUMN_WIDTH = 40;
export const MAX_TABLE_COLUMN_WIDTH = 2000;

export function setSelectedTableColumnWidth(editor: Editor, width: number): boolean {
  if (
    !Number.isSafeInteger(width) ||
    width < MIN_TABLE_COLUMN_WIDTH ||
    width > MAX_TABLE_COLUMN_WIDTH
  ) {
    return false;
  }

  const { state, view } = editor;
  const { $from } = state.selection;
  let tableDepth = -1;
  let cellDepth = -1;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole;
    if (cellDepth === -1 && (role === 'cell' || role === 'header_cell')) cellDepth = depth;
    if (role === 'table') {
      tableDepth = depth;
      break;
    }
  }

  if (tableDepth === -1 || cellDepth === -1) return false;

  const tablePos = $from.before(tableDepth);
  const table = $from.node(tableDepth);
  const map = TableMap.get(table);
  const cellOffset = $from.before(cellDepth) - tablePos - 1;
  const column = map.findCell(cellOffset).left;
  const transaction = state.tr;

  for (let row = 0; row < map.height; row += 1) {
    const cellPosition = tablePos + 1 + map.map[row * map.width + column];
    const cell = transaction.doc.nodeAt(cellPosition);
    if (!cell) continue;
    const colspan = Number.isSafeInteger(cell.attrs.colspan) ? cell.attrs.colspan : 1;
    transaction.setNodeMarkup(cellPosition, undefined, {
      ...cell.attrs,
      colwidth: Array.from({ length: colspan }, () => width),
    });
  }

  if (!transaction.docChanged) return false;
  view.dispatch(transaction);
  return true;
}
