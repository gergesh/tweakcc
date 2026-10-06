// Please see the note about writing patches in ./index

/**
 * Stop clicked (expanded) messages from pushing the text below them down.
 *
 * In fullscreen mode, clicking a message toggles its expanded view. The
 * expanded message gets a grey `userMessageBackgroundHover` background and one
 * row of bottom padding, so everything below it jumps down a line. This patch
 * keeps the background and drops the padding.
 *
 * CC 2.1.292:
 * ```diff
 *  function rE({itemKey:l,msg:u,measureRef:m,expanded:p,...}){return e(s,{ref:m(l),
 *    flexDirection:"column",backgroundColor:p?"userMessageBackgroundHover":void 0,
 * -  paddingBottom:p?1:void 0,
 * +  paddingBottom:void 0,
 * ```
 */

const PADDING_PATTERN =
  /(,backgroundColor:[$\w]+\?"userMessageBackgroundHover":void 0,paddingBottom:)[$\w]+\?1:void 0,/;

/**
 * Patches one source. Returns null if the expanded message wrapper isn't in it.
 */
export const writeRemoveExpandedMessagePadding = (
  oldFile: string
): string | null => {
  const match = oldFile.match(PADDING_PATTERN);
  if (!match || match.index === undefined) return null;
  const replacement = `${match[1]}void 0,`;
  return (
    oldFile.slice(0, match.index) +
    replacement +
    oldFile.slice(match.index + match[0].length)
  );
};
