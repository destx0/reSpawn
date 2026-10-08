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

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid ${(p) => th(p).base02};
`;

export const Location = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
  overflow: hidden;
`;

export const Host = styled.span`
  flex: none;
  font-weight: 600;
  color: ${(p) => th(p).base07};
`;

export const Mono = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: ${(p) => th(p).base04};
  font-family: ${(p) => th(p).codeFontFamily};
  font-size: 11px;
`;

export const IconButton = styled.button<{
  primary?: boolean;
  danger?: boolean;
  active?: boolean;
}>`
  all: unset;
  flex: none;
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: ${(p) =>
    p.danger
      ? th(p).base08
      : p.primary || p.active
        ? th(p).base0D
        : th(p).base04};
  transition:
    background 120ms,
    color 120ms;
  &:hover:not(:disabled),
  &:focus-visible {
    background: ${(p) => th(p).base02};
    color: ${(p) =>
      p.danger ? th(p).base08 : p.primary ? th(p).base0D : th(p).base07};
  }
  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
`;

export const Badge = styled.span`
  position: absolute;
  top: 1px;
  right: 0;
  min-width: 12px;
  padding: 0 3px;
  border-radius: 6px;
  box-sizing: border-box;
  font-size: 9px;
  font-weight: 600;
  line-height: 12px;
  text-align: center;
  color: ${(p) => th(p).base00};
  background: ${(p) => th(p).base04};
`;

export const SearchBox = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid ${(p) => th(p).base02};
  color: ${(p) => th(p).base04};
  font-size: 13px;
  &:focus-within {
    color: ${(p) => th(p).base0D};
  }
`;

export const Input = styled.input`
  all: unset;
  flex: 1;
  min-width: 0;
  color: ${(p) => th(p).base05};
  font-family: ${(p) => th(p).fontFamily};
  font-size: 12px;
  &::placeholder {
    color: ${(p) => th(p).base03};
  }
`;

export const Status = styled.div<{ kind: 'error' | 'success' }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 11px;
  cursor: pointer;
  color: ${(p) => (p.kind === 'error' ? th(p).base08 : th(p).base0B)};
  border-bottom: 1px solid ${(p) => th(p).base02};
`;

export const List = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 4px;
`;

export const Actions = styled.div`
  display: flex;
  flex: none;
  opacity: 0;
  transition: opacity 120ms;
`;

export const Row = styled.div<{ accent?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 3px 4px 3px 8px;
  border-radius: 6px;
  cursor: default;
  &:hover {
    background: ${(p) => th(p).base01};
  }
  &:hover .actions,
  &:focus-within .actions {
    opacity: 1;
  }
  & > svg {
    flex: none;
    font-size: 14px;
    color: ${(p) => (p.accent ? th(p).base0D : th(p).base03)};
  }
`;

export const RowMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

export const RowName = styled.span`
  font-weight: 500;
  color: ${(p) => th(p).base07};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const RenameInput = styled.input`
  all: unset;
  font-weight: 500;
  color: ${(p) => th(p).base07};
  border-bottom: 1px solid ${(p) => th(p).base0D};
`;

export const RowMeta = styled.span`
  flex: none;
  color: ${(p) => th(p).base03};
  font-size: 11px;
  white-space: nowrap;
`;

export const Empty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  color: ${(p) => th(p).base03};
  font-size: 12px;
  & > svg {
    font-size: 22px;
  }
`;

export const Kbd = styled.kbd`
  font-family: ${(p) => th(p).codeFontFamily};
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid ${(p) => th(p).base02};
`;
