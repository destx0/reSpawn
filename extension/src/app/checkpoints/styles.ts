import styled from '@emotion/styled';
import type { Theme } from '@redux-devtools/ui';

// Emotion's ThemeProvider (from @redux-devtools/ui's Container) supplies the theme.
const th = (props: object) => (props as { theme: Theme }).theme;

export const Page = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  font-family: ${(p) => th(p).fontFamily};
  font-size: 12px;
  color: ${(p) => th(p).base05};
  background: ${(p) => th(p).base00};
`;

export const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: ${(p) => th(p).base01};
  border-bottom: 1px solid ${(p) => th(p).base02};
`;

export const Bar = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
`;

export const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
`;

export const SectionTitle = styled.div`
  font-weight: 600;
  font-size: 13px;
  color: ${(p) => th(p).base07};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const Hint = styled.span`
  display: block;
  color: ${(p) => th(p).base04};
  font-family: ${(p) => th(p).codeFontFamily};
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const InlineHint = styled.span`
  color: ${(p) => th(p).base04};
  font-weight: 400;
`;

export const Input = styled.input`
  box-sizing: border-box;
  width: 100%;
  height: 26px;
  padding: 0 8px;
  border: 1px solid ${(p) => th(p).base02};
  border-radius: 4px;
  background: ${(p) => th(p).base00};
  color: ${(p) => th(p).base05};
  font-family: ${(p) => th(p).codeFontFamily};
  font-size: 12px;
  outline: none;
  &:focus {
    border-color: ${(p) => th(p).base0D};
  }
  &::placeholder {
    color: ${(p) => th(p).base03};
  }
  &:disabled {
    opacity: 0.6;
  }
`;

export const PillButton = styled.button<{
  primary?: boolean;
  danger?: boolean;
}>`
  flex: none;
  height: 26px;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid
    ${(p) =>
      p.danger ? th(p).base08 : p.primary ? th(p).base0D : th(p).base02};
  background: ${(p) => (p.primary ? th(p).base0D : th(p).base00)};
  color: ${(p) =>
    p.primary ? th(p).base00 : p.danger ? th(p).base08 : th(p).base05};
  font-family: ${(p) => th(p).fontFamily};
  font-size: 12px;
  font-weight: ${({ primary }) => (primary ? 600 : 400)};
  cursor: pointer;
  white-space: nowrap;
  &:hover:not(:disabled) {
    filter: brightness(1.08);
    border-color: ${(p) => (p.danger ? th(p).base08 : th(p).base0D)};
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

export const SmallButton = styled(PillButton)`
  height: 22px;
  padding: 0 7px;
  font-size: 11px;
`;

export const Toggle = styled.label`
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  white-space: nowrap;
  color: ${(p) => th(p).base04};
  cursor: pointer;
`;

export const Banner = styled.div<{ kind: 'error' | 'success' }>`
  padding: 6px 10px;
  font-size: 12px;
  color: ${(p) => (p.kind === 'error' ? th(p).base08 : th(p).base0B)};
  border-bottom: 1px solid ${(p) => th(p).base02};
  background: ${(p) => th(p).base01};
`;

export const List = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid ${(p) => th(p).base02};
  &:hover {
    background: ${(p) => th(p).base01};
  }
`;

export const RowMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

export const RowName = styled.button`
  all: unset;
  font-weight: 600;
  color: ${(p) => th(p).base07};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
`;

export const RowMeta = styled.span`
  flex: none;
  color: ${(p) => th(p).base04};
  font-size: 11px;
  white-space: nowrap;
`;

export const RowActions = styled.div`
  display: flex;
  gap: 4px;
  flex: none;
`;
