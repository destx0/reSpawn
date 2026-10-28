import styled from '@emotion/styled';
import type { Theme } from '@redux-devtools/ui';

const th = (props: object) => (props as { theme: Theme }).theme;

export const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 100%;
  padding: 14px 16px 28px;
  box-sizing: border-box;
  font-family: ${(p) => th(p).fontFamily};
  font-size: 12px;
  color: ${(p) => th(p).base05};
  background: ${(p) => th(p).base00};
`;

export const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

export const SectionTitle = styled.h2`
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: ${(p) => th(p).base07};
`;

export const Hint = styled.p`
  margin: 0;
  max-width: 760px;
  line-height: 1.45;
  color: ${(p) => th(p).base04};
`;

export const Card = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid ${(p) => th(p).base02};
  border-radius: 8px;
  background: ${(p) => th(p).base01};
`;

export const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const TextInput = styled.input`
  min-width: 0;
  box-sizing: border-box;
  padding: 5px 7px;
  border: 1px solid ${(p) => th(p).base02};
  border-radius: 5px;
  outline: none;
  font-family: ${(p) => th(p).fontFamily};
  font-size: 12px;
  color: ${(p) => th(p).base05};
  background: ${(p) => th(p).base00};
  &:focus {
    border-color: ${(p) => th(p).base0D};
  }
  &::placeholder {
    color: ${(p) => th(p).base03};
  }
`;

export const NameInput = styled(TextInput)`
  flex: 1;
  font-weight: 600;
  color: ${(p) => th(p).base07};
`;

export const EnvironmentName = styled(TextInput)`
  width: 112px;
  flex: none;
`;

export const BaseInput = styled(TextInput)`
  flex: 1;
  font-family: ${(p) => th(p).codeFontFamily};
  font-size: 11px;
`;

export const Button = styled.button<{
  primary?: boolean;
  danger?: boolean;
}>`
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  padding: 5px 9px;
  border-radius: 6px;
  cursor: pointer;
  font-family: ${(p) => th(p).fontFamily};
  font-size: 11px;
  color: ${(p) =>
    p.danger ? th(p).base08 : p.primary ? th(p).base00 : th(p).base04};
  background: ${(p) =>
    p.primary ? th(p).base0D : p.danger ? 'transparent' : th(p).base02};
  &:hover:not(:disabled) {
    color: ${(p) =>
      p.danger ? th(p).base08 : p.primary ? th(p).base00 : th(p).base07};
    filter: ${(p) => (p.primary ? 'brightness(1.08)' : 'none')};
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

export const IconButton = styled(Button)`
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  justify-content: center;
  background: transparent;
  font-size: 14px;
  color: ${(p) => (p.danger ? th(p).base08 : th(p).base04)};
`;

export const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid ${(p) => th(p).base02};
  color: ${(p) => th(p).base04};
`;

export const Status = styled.div<{ kind: 'error' | 'success' }>`
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${(p) => (p.kind === 'error' ? th(p).base08 : th(p).base0B)};
`;

export const ErrorList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 8px 10px 8px 26px;
  border: 1px solid ${(p) => th(p).base08};
  border-radius: 6px;
  color: ${(p) => th(p).base08};
  line-height: 1.4;
`;

export const Suggestion = styled(Card)`
  flex-direction: row;
  align-items: center;
  gap: 12px;
`;

export const SuggestionMain = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
`;

export const SuggestionTitle = styled.span`
  font-weight: 600;
  color: ${(p) => th(p).base07};
`;

export const SuggestionBases = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-family: ${(p) => th(p).codeFontFamily};
  font-size: 11px;
  color: ${(p) => th(p).base04};
`;

export const Warning = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${(p) => th(p).base09};
  font-size: 11px;
`;

export const Empty = styled.div`
  padding: 18px 12px;
  border: 1px dashed ${(p) => th(p).base02};
  border-radius: 8px;
  text-align: center;
  color: ${(p) => th(p).base04};
`;
