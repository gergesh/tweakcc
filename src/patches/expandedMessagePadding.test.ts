import { describe, expect, it } from 'vitest';

import { writeRemoveExpandedMessagePadding } from './expandedMessagePadding';

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
