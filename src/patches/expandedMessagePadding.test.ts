import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  writeRemoveExpandedMessagePadding,
  writeRemoveExpandedMessagePaddingModules,
} from './expandedMessagePadding';

// Excerpt of the message list chunk in Claude Code 2.1.292.
const MESSAGE_LIST_CHUNK =
  'function rE({itemKey:l,msg:u,measureRef:m,expanded:p,hovered:h,clickable:R,children:E}){' +
  'return e(s,{ref:m(l),flexDirection:"column",backgroundColor:p?"userMessageBackgroundHover":void 0,' +
  'paddingBottom:p?1:void 0,hoverIgnoresBlankCells:!p,children:E})}';
const OTHER_CHUNK = 'const je=he?"userMessageBackgroundHover":void 0;let Qe;';

describe('writeRemoveExpandedMessagePadding', () => {
  it('drops the padding and keeps the background', () => {
    expect(writeRemoveExpandedMessagePadding(MESSAGE_LIST_CHUNK)).toContain(
      'backgroundColor:p?"userMessageBackgroundHover":void 0,paddingBottom:void 0,hoverIgnoresBlankCells:!p'
    );
  });

  it('returns null when the wrapper is missing', () => {
    expect(writeRemoveExpandedMessagePadding(OTHER_CHUNK)).toBeNull();
  });
});

describe('writeRemoveExpandedMessagePaddingModules', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('patches only the module holding the wrapper', () => {
    const patched = writeRemoveExpandedMessagePaddingModules([
      OTHER_CHUNK,
      MESSAGE_LIST_CHUNK,
    ])!;
    expect(patched[0]).toBe(OTHER_CHUNK);
    expect(patched[1]).toContain('paddingBottom:void 0,');
  });

  it('fails when no module holds the wrapper', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(writeRemoveExpandedMessagePaddingModules([OTHER_CHUNK])).toBeNull();
  });
});
